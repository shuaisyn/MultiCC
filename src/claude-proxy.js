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
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Temporary diagnostic capture: dump the exact outbound body+headers for a
// live request so a failing turn can be replayed byte-for-byte (direct vs
// via-proxy) to isolate whether the proxy or the upstream is at fault.
// Enable with CCFW_CAPTURE=1 in the multicc env; writes to /tmp/ccfw-capture/.
const CAPTURE_DIR = '/tmp/ccfw-capture';
function maybeCapture(meta, headers, bodyBuf) {
  if (process.env.CCFW_CAPTURE !== '1') return;
  try {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    const fname = path.join(CAPTURE_DIR, `${meta.sessionId || 'nosess'}-${meta.stamp}.json`);
    let body;
    try { body = JSON.parse(bodyBuf.toString('utf8')); } catch (_) { body = bodyBuf.toString('utf8'); }
    fs.writeFileSync(fname, JSON.stringify({ ...meta, headers, body }, null, 2));
  } catch (e) { console.log(`[ccfw] capture failed: ${e.message}`); }
}

const CCFW_PREFIX = 'ccfw:';
const TIERS = ['sonnet', 'opus', 'haiku', 'fable'];

// ── claude-official OAuth passthrough (opt-in via CLAUDE_OFFICIAL_VIA_PROXY) ──
// A "Claude Official" provider has no baseUrl/token in the store — it relies on
// the CLI's built-in claude.ai OAuth subscription, whose token lives in the
// macOS Keychain. To route such a session through this proxy (so its subagents
// can be sent to cheap providers), we replay that Keychain OAuth token to
// api.anthropic.com. v1 is READ-ONLY on the Keychain (no refresh / writeback):
// if the token has expired the request fails with guidance to run `claude` once
// to refresh it. This deliberately avoids racing the CLI over the shared entry.
const OAUTH_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const OFFICIAL_PROVIDER_ID = 'claude-official';   // canonical "use the CLI's own login" entry
const OFFICIAL_BASE_URL = 'https://api.anthropic.com';
const OAUTH_BETA = 'oauth-2025-04-20';
// Anthropic's OAuth gate requires the first system block to assert this identity.
const CLAUDE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

function readKeychainOAuth() {
  try {
    const raw = execFileSync('security',
      ['find-generic-password', '-s', OAUTH_KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', timeout: 8000 });
    const d = JSON.parse(raw.trim());
    return d && d.claudeAiOauth ? d.claudeAiOauth : null;
  } catch (_) { return null; }
}

/** Read a currently-valid official OAuth access token, or {token:null,reason}. */
function readOfficialOAuthToken() {
  const o = readKeychainOAuth();
  if (!o || !o.accessToken) return { token: null, reason: 'no OAuth token in Keychain' };
  if (o.expiresAt && o.expiresAt < Date.now()) {
    return { token: null, reason: 'OAuth token expired — run `claude` once to refresh the Keychain' };
  }
  return { token: o.accessToken };
}

/** Ensure the request body's first system block is the Claude Code identity
 *  assertion (required when authenticating with a subscription OAuth token). */
function ensureClaudeIdentity(bodyBuf) {
  try {
    const obj = JSON.parse(bodyBuf.toString('utf8'));
    const startsWithId = (s) => typeof s === 'string' && s.startsWith(CLAUDE_IDENTITY);
    const sys = obj.system;
    if (typeof sys === 'string') {
      if (startsWithId(sys)) return bodyBuf;
      obj.system = [{ type: 'text', text: CLAUDE_IDENTITY }, { type: 'text', text: sys }];
    } else if (Array.isArray(sys) && sys.length) {
      const f = sys[0];
      const ft = typeof f === 'string' ? f : (f && f.text);
      if (startsWithId(ft)) return bodyBuf;
      obj.system = [{ type: 'text', text: CLAUDE_IDENTITY }, ...sys];
    } else {
      obj.system = [{ type: 'text', text: CLAUDE_IDENTITY }];
    }
    return Buffer.from(JSON.stringify(obj), 'utf8');
  } catch (_) { return bodyBuf; }
}

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
    authToken: env.ANTHROPIC_AUTH_TOKEN || '',
    apiKey: env.ANTHROPIC_API_KEY || '',
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

    // buffer the request body. Mounted before express.json(), so the stream is
    // intact; fall back to req.body if a caller mounted us after a body parser.
    let bodyBuf;
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      bodyBuf = Buffer.from(JSON.stringify(req.body), 'utf8');
    } else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      bodyBuf = Buffer.concat(chunks);
    }

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
    let creds = resolveCreds(provider);
    // Official (claude.ai OAuth subscription) route: ONLY the canonical
    // `claude-official` provider, and only when it has no stored baseUrl (a user
    // could instead configure it with a real API key, which the normal path
    // handles). When the opt-in toggle is on, replay the Keychain OAuth token to
    // api.anthropic.com. Scoped to this exact id so other empty-baseUrl providers
    // still 502 rather than wrongly borrowing the subscription token.
    let officialOAuthToken = null;
    if (routeProviderId === OFFICIAL_PROVIDER_ID && (!creds || !creds.baseUrl)
        && process.env.CLAUDE_OFFICIAL_VIA_PROXY === '1') {
      const r = readOfficialOAuthToken();
      if (r.token) {
        officialOAuthToken = r.token;
        creds = { baseUrl: OFFICIAL_BASE_URL, authToken: null, apiKey: null,
                  aliasMap: {}, name: (creds && creds.name) || 'Claude Official', isOfficialOAuth: true };
      } else {
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: `ccfw: official OAuth unavailable — ${r.reason}` }));
      }
    }
    if (!creds || !creds.baseUrl) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: `ccfw: provider '${routeProviderId}' has no baseUrl` }));
    }

    // tier alias → real model for the routed provider. The main route rarely
    // needs this (the CLI usually resolves tiers via ANTHROPIC_DEFAULT_*_MODEL
    // before sending), but the subagent/ccfw route carries the tier UNRESOLVED
    // — the CLI only ever sees the opaque `ccfw:<pid>:opus` string — so map it
    // here for both, otherwise an alias-mapped relay gets 'opus' and rejects it.
    const tierKey = String(ccfw ? ccfw.realModel : model).toLowerCase();
    if (TIERS.includes(tierKey) && creds.aliasMap[tierKey]) {
      outBody = rewriteModel(outBody, creds.aliasMap[tierKey]);
    }

    // forward
    const base = new URL(creds.baseUrl);
    const basepath = base.pathname.replace(/\/+$/, '');
    const fullPath = basepath + apiPath + query;
    // Forward auth matching how the provider expects it: AUTH_TOKEN →
    // Authorization: Bearer only (e.g. Zhipu GLM 401s if x-api-key is also set),
    // API_KEY → x-api-key only. Strip the incoming virtual token first.
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    delete headers['x-api-key'];
    delete headers['authorization'];
    // Hop-by-hop headers (RFC 7230 §6.1) describe THIS connection, not the
    // next one — a proxy must not forward them onto the new upstream
    // connection it opens. Only 'connection' has actually shown up from the
    // claude CLI in practice; the rest are stripped defensively.
    delete headers.connection;
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];
    delete headers.te;
    delete headers.trailer;
    delete headers.upgrade;
    if (creds.isOfficialOAuth) {
      // Replay the subscription OAuth token + the OAuth beta, and DO NOT touch the
      // body: UA / x-stainless / x-app / system prompt pass through untouched, so
      // the forwarded request stays a genuine CLI request (same machine/IP) with
      // only the credential swapped. Live-tested 2026-07-05: api.anthropic.com
      // accepts the bare Bearer oat token even WITHOUT an identity system block,
      // so rewriting the body is unnecessary — and injecting a system block would
      // bust the CLI's prompt-cache prefix (wasting subscription quota).
      // ensureClaudeIdentity() stays as a fallback if the identity gate is ever
      // enforced.
      headers['authorization'] = 'Bearer ' + officialOAuthToken;
      const betas = new Set(String(headers['anthropic-beta'] || '').split(',').map((s) => s.trim()).filter(Boolean));
      betas.add(OAUTH_BETA);
      headers['anthropic-beta'] = Array.from(betas).join(',');
      delete headers['x-api-key'];
    } else if (creds.authToken) {
      headers['authorization'] = 'Bearer ' + creds.authToken;
    }
    if (creds.apiKey) headers['x-api-key'] = creds.apiKey;
    // Recompute Content-Length for the (possibly rewritten) outBody. Without
    // this, Node has no length to send and falls back to chunked
    // Transfer-Encoding — which Zhipu's Anthropic-compat gateway cannot
    // reliably handle for large bodies (confirmed 2026-07-05: identical
    // requests to open.bigmodel.cn succeed with Content-Length set and fail
    // with garbled 500/400 when sent chunked). Every provider gets this, not
    // just Zhipu, since no upstream should be relying on chunked here.
    headers['content-length'] = String(Buffer.byteLength(outBody));
    const lib = base.protocol === 'https:' ? https : http;
    console.log(`[ccfw] sess=${sessionId || '-'} role=${role} provider=${creds.name || routeProviderId} model=${ccfw ? ccfw.realModel : (model || '(n/a)')} -> ${base.origin}${fullPath}`);
    // Redact secrets before any diagnostic dump (never write the real Bearer /
    // API key to logs or /tmp capture — matters especially for the OAuth token).
    const safeHeaders = { ...headers };
    if (safeHeaders.authorization) safeHeaders.authorization = 'Bearer ***';
    if (safeHeaders['x-api-key']) safeHeaders['x-api-key'] = '***';
    if (process.env.CCFW_CAPTURE === '1') console.log(`[ccfw] outbound-headers sess=${sessionId || '-'} ${JSON.stringify(safeHeaders)}`);
    maybeCapture({ sessionId, role, provider: creds.name || routeProviderId, url: `${base.origin}${fullPath}`, stamp: Date.now() }, safeHeaders, outBody);

    const up = lib.request({
      method: req.method,
      hostname: base.hostname,
      port: base.port || (base.protocol === 'https:' ? 443 : 80),
      path: fullPath,
      headers,
    }, (upRes) => {
      const statusCode = upRes.statusCode || 0;
      const ok = statusCode >= 200 && statusCode < 300;
      console.log(`[ccfw] <- sess=${sessionId || '-'} role=${role} provider=${creds.name || routeProviderId} status=${statusCode}`);
      res.writeHead(statusCode || 502, upRes.headers);
      if (!ok) {
        // Non-2xx responses are small JSON (not SSE), so buffering a short
        // snippet for diagnostics is cheap and doesn't touch the 2xx/SSE path.
        let snippet = '';
        upRes.on('data', (chunk) => {
          if (snippet.length < 500) snippet += chunk.toString('utf8', 0, Math.min(chunk.length, 500 - snippet.length));
        });
        upRes.on('end', () => {
          if (snippet) console.log(`[ccfw] !! sess=${sessionId || '-'} role=${role} status=${statusCode} body=${snippet.replace(/\s+/g, ' ')}`);
        });
      }
      upRes.pipe(res);
    });
    up.on('error', (e) => {
      console.log(`[ccfw] upstream error: ${e.message}`);
      // If we already flushed a 2xx and started piping (e.g. the upstream
      // socket dies mid-SSE-stream), headers are sent and res may already be
      // ending — writing a fresh JSON error body onto that stream would
      // corrupt whatever partial SSE the client already received. Just end it.
      if (res.headersSent) { try { res.end(); } catch (_) {} return; }
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

module.exports = { mountClaudeProxy, createHandler, parseProxyUrl, decodeCcfwModel, resolveCreds, CCFW_PREFIX, ensureClaudeIdentity, readOfficialOAuthToken };
