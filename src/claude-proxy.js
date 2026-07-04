'use strict';
// Claude Code per-session + per-role routing proxy.
//
// Why: claude subagents run IN-PROCESS (sidechain) and share the single
// Anthropic client, so you cannot give a subagent a different upstream/provider
// via native config (env/hooks/agent-defs all bind once at process start, and
// the compiled Bun binary refuses in-process JS injection). This proxy sits in
// front of claude as its ANTHROPIC_BASE_URL and routes each /v1/messages
// request by inspecting the `model` field — the one signal that differs between
// the main loop and a CLAUDE_CODE_SUBAGENT_MODEL-forced subagent.
//
// Routing (stateless — no session lookup needed):
//   URL path  :  /claude-proxy/:providerId/:sessionId/<apiPath>
//                → providerId is the MAIN provider. claude preserves this path
//                  prefix (verified on 2.1.199): a base URL of
//                  http://127.0.0.1:PORT/claude-proxy/<pid>/<sid> makes claude
//                  POST .../<pid>/<sid>/v1/messages and HEAD .../<pid>/<sid>.
//   body.model:  "ccfw:<subProviderId>:<realModel>"  → subagent route.
//                anything else                         → main route (providerId).
//                multicc sets CLAUDE_CODE_SUBAGENT_MODEL to that combined string,
//                so the subagent request carries both the target provider AND the
//                real model in the one field claude lets us control. The proxy
//                rewrites `model` back to <realModel> before forwarding.
//
//   Tier aliases (sonnet/opus/haiku/fable) are mapped to the resolved provider's
//   ANTHROPIC_DEFAULT_<TIER>_MODEL when present (defensive — multicc already
//   injects real ids, so this is a no-op in normal operation).
//
// Body params (model, max_tokens, effort, messages, tools, …) are forwarded
// untouched otherwise; SSE responses are piped through byte-for-byte.
//
// Creds are resolved live from multicc's provider store via getProvider() at
// request time — nothing is cached or written to disk.

const https = require('https');
const http = require('http');
const { URL } = require('url');

const CCFW_PREFIX = 'ccfw:';
const TIERS = ['sonnet', 'opus', 'haiku', 'fable'];

/** Flatten a stored provider into {baseUrl, token, aliasMap}. */
function resolveCreds(provider) {
  if (!provider) return null;
  let cfg = provider.settingsConfig;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (_) { cfg = {}; } }
  cfg = cfg || {};
  const env = cfg.env || {};
  const aliasMap = {};
  for (const tier of TIERS) {
    const m = env[`ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`];
    if (m) aliasMap[tier] = m;
  }
  return {
    baseUrl: env.ANTHROPIC_BASE_URL || '',
    token: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '',
    aliasMap,
    name: provider.name,
  };
}

/** Parse the proxy path into {providerId, sessionId, apiPath, query}. */
function parseProxyUrl(rawUrl) {
  const qIdx = rawUrl.indexOf('?');
  const path = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  const query = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  let rest = path.startsWith('/claude-proxy') ? path.slice('/claude-proxy'.length) : path;
  rest = rest.replace(/^\/+/, '');
  const segs = rest.split('/').filter(Boolean);
  return {
    providerId: segs[0] || '',
    sessionId: segs[1] || '',
    apiPath: '/' + segs.slice(2).join('/'),
    query,
  };
}

/**
 * Decode a `ccfw:<providerId>:<realModel>` model value, or null if not encoded.
 * model ids and uuid provider ids do not contain ':', so split is safe; the
 * realModel is everything after the second ':' (rejoined) in case it contains ':'.
 */
function decodeCcfwModel(model) {
  if (typeof model !== 'string' || !model.startsWith(CCFW_PREFIX)) return null;
  const body = model.slice(CCFW_PREFIX.length);
  const i = body.indexOf(':');
  if (i < 0) return null;
  return { providerId: body.slice(0, i), realModel: body.slice(i + 1) };
}

function rewriteModel(bodyBuf, newModel) {
  try {
    const obj = JSON.parse(bodyBuf.toString('utf8'));
    obj.model = newModel;
    return Buffer.from(JSON.stringify(obj), 'utf8');
  } catch (_) { return bodyBuf; }
}

/**
 * Build a request handler. Works mounted on express (`app.use('/claude-proxy', h)`)
 * or on a plain http server — it normalizes the /claude-proxy prefix itself.
 * @param {{ getProvider:(appType:string,id:string)=>any }} opts
 */
function createHandler({ getProvider }) {
  return async (req, res) => {
    const { providerId, sessionId, apiPath, query } = parseProxyUrl(req.url || '');

    // claude's connectivity probe: HEAD /claude-proxy/<pid>/<sid> (no body, no auth)
    if (req.method === 'HEAD' && apiPath === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end();
    }

    if (!providerId) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'ccfw: missing providerId in path' }));
    }

    // buffer the request body (JSON; small enough to read fully)
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyBuf = Buffer.concat(chunks);

    let model = '';
    try { model = JSON.parse(bodyBuf.toString('utf8')).model || ''; } catch (_) {}

    // decide route: encoded subagent model → sub provider, else main provider from path
    const ccfw = decodeCcfwModel(model);
    let routeProviderId = providerId;
    let outBody = bodyBuf;
    let role = 'main';
    if (ccfw) {
      routeProviderId = ccfw.providerId;
      outBody = rewriteModel(bodyBuf, ccfw.realModel);
      role = 'sub';
    }

    const provider = getProvider('claude', routeProviderId);
    const creds = resolveCreds(provider);
    if (!creds || !creds.baseUrl) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: `ccfw: provider '${routeProviderId}' has no baseUrl` }));
    }

    // tier alias → real model for this provider (defensive)
    if (!ccfw && TIERS.includes(String(model).toLowerCase()) && creds.aliasMap[String(model).toLowerCase()]) {
      outBody = rewriteModel(outBody, creds.aliasMap[String(model).toLowerCase()]);
    }

    // forward
    const base = new URL(creds.baseUrl);
    const basepath = base.pathname.replace(/\/+$/, '');
    const fullPath = basepath + apiPath + query;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    if (creds.token) {
      headers['x-api-key'] = creds.token;
      headers['authorization'] = 'Bearer ' + creds.token;
    }
    const lib = base.protocol === 'https:' ? https : http;
    console.log(`[ccfw] sess=${sessionId || '-'} role=${role} provider=${creds.name || routeProviderId} model=${ccfw ? ccfw.realModel : (model || '(n/a)')} -> ${base.origin}${fullPath}`);

    const up = lib.request({
      method: req.method,
      hostname: base.hostname,
      port: base.port || (base.protocol === 'https:' ? 443 : 80),
      path: fullPath,
      headers,
    }, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    });
    up.on('error', (e) => {
      console.log(`[ccfw] upstream error: ${e.message}`);
      try { res.writeHead(502, { 'content-type': 'application/json' }); } catch (_) {}
      res.end(JSON.stringify({ error: { type: 'ccfw_upstream_error', message: e.message } }));
    });
    up.write(outBody);
    up.end();
  };
}

/** Mount on an express app: app.use('/claude-proxy', handler). */
function mountClaudeProxy(app, { getProvider }) {
  app.use('/claude-proxy', createHandler({ getProvider }));
}

module.exports = { mountClaudeProxy, createHandler, parseProxyUrl, decodeCcfwModel, resolveCreds, CCFW_PREFIX };
