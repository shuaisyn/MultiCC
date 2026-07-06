'use strict';
// Codex Responses↔Chat 协议转换代理 — 端点层（模块 C）。
// 契约：docs/codex-proxy-contract.md
// 转换核心 src/codex-proxy-transform.js 由另一会话实现，这里只 require。

const { responsesToChat, chatStreamToResponses } = require('./codex-proxy-transform');
const { StringDecoder } = require('string_decoder');

/**
 * 在 express app 上挂载 codex 协议转换代理端点。
 *   POST /codex-proxy/:providerId/responses
 * @param {import('express').Express} app
 * @param {{ getProvider:(appType:string,id:string)=>any, getPort:()=>number }} opts
 */
function mountCodexProxy(app, { getProvider, getPort }) {
  app.post('/codex-proxy/:providerId/responses', async (req, res) => {
    const providerId = req.params.providerId;

    // ① 查 provider 配置
    const provider = getProvider('codex', providerId);
    if (!provider) {
      return res.status(404).json({ error: `codex provider not found: ${providerId}` });
    }
    const cfg = (provider.settingsConfig && typeof provider.settingsConfig === 'object')
      ? provider.settingsConfig
      : {};
    const proxyTarget = cfg.proxyTarget;
    if (!proxyTarget || !proxyTarget.baseUrl || !proxyTarget.apiKey) {
      return res.status(400).json({
        error: 'provider has no proxyTarget (baseUrl/apiKey) — not a proxied domestic provider',
      });
    }
    if (proxyTarget.mode === 'responses-compat') {
      return proxyResponsesCompat(req, res, proxyTarget);
    }

    // ② Responses body → Chat body
    let chatBody;
    try {
      chatBody = responsesToChat(req.body || {});
    } catch (e) {
      return res.status(400).json({ error: 'responsesToChat failed: ' + e.message });
    }
    if (!chatBody || typeof chatBody !== 'object') {
      return res.status(400).json({ error: 'responsesToChat returned non-object' });
    }
    chatBody.stream = true;

    // ③ fetch 真实 chat/completions（stream）
    let upstream;
    try {
      upstream = await fetch(proxyTarget.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${proxyTarget.apiKey}`,
        },
        body: JSON.stringify(chatBody),
      });
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      sendFailed(res, `fetch upstream failed: ${msg}`);
      return;
    }

    if (!upstream.ok || !upstream.body) {
      let detail = '';
      try { detail = await upstream.text(); } catch (_) {}
      sendFailed(res, `upstream ${upstream.status}: ${String(detail).slice(0, 500)}`);
      return;
    }

    // ④ Chat SSE → Responses SSE，逐行转发
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const converter = chatStreamToResponses(sse => {
      try { res.write(sse); } catch (_) {}
    });

    const reader = upstream.body.getReader();
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let clientClosed = false;
    req.on('close', () => { clientClosed = true; });

    try {
      while (!clientClosed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.write(value);
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          try { converter.pushLine(line); } catch (_) {}
        }
      }
      const tail = decoder.end();
      if (tail) buffer += tail;
      if (buffer.length) {
        try { converter.pushLine(buffer); } catch (_) {}
        buffer = '';
      }
      try { converter.end(); } catch (_) {}
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      try {
        res.write(`event: response.failed\ndata: ${JSON.stringify({
          type: 'response.failed',
          response: { status: 'failed', error: { message: 'stream error: ' + msg } },
        })}\n\n`);
      } catch (_) {}
    } finally {
      try { res.end(); } catch (_) {}
    }
  });
}

async function proxyResponsesCompat(req, res, proxyTarget) {
  const body = { ...(req.body || {}), stream: true };
  let upstream;
  const aborter = new AbortController();
  try {
    upstream = await fetch(proxyTarget.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${proxyTarget.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: aborter.signal,
    });
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    sendFailed(res, `fetch upstream failed: ${msg}`);
    return;
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try { detail = await upstream.text(); } catch (_) {}
    sendFailed(res, `upstream ${upstream.status}: ${String(detail).slice(0, 500)}`);
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let completed = false;
  let failed = false;
  let responseMeta = null;
  let usage = null;
  const outputItems = [];
  let currentEvent = '';
  let currentData = [];

  function trackSseLine(rawLine) {
    const line = String(rawLine || '').replace(/\r$/, '');
    if (!line.trim()) {
      finishTrackedEvent();
      return;
    }
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      currentData.push(line.slice(5).trimStart());
    }
  }

  function finishTrackedEvent() {
    if (!currentEvent && currentData.length === 0) return;
    const payload = currentData.join('\n');
    let obj = null;
    if (payload && payload !== '[DONE]') {
      try { obj = JSON.parse(payload); } catch (_) {}
    }
    const typ = currentEvent || (obj && obj.type) || '';
    if (typ === 'response.completed') completed = true;
    if (typ === 'response.failed' || typ === 'error') failed = true;
    if (obj && obj.response && typeof obj.response === 'object') {
      responseMeta = { ...(responseMeta || {}), ...obj.response };
      if (obj.response.usage) usage = obj.response.usage;
      if (Array.isArray(obj.response.output)) {
        obj.response.output.forEach((item, idx) => { outputItems[idx] = item; });
      }
    }
    if (obj && obj.item && /^response\.output_item\.(added|done)$/.test(typ)) {
      const idx = Number.isInteger(obj.output_index) ? obj.output_index : outputItems.length;
      outputItems[idx] = obj.item;
    }
    currentEvent = '';
    currentData = [];
  }

  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    try { aborter.abort(); } catch (_) {}
  });

  const reader = upstream.body.getReader();
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  try {
    let stopAfterTerminalEvent = false;
    while (!clientClosed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.write(value);
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        trackSseLine(line);
        try { res.write(line + '\n'); } catch (_) {}
        if (completed || failed) {
          stopAfterTerminalEvent = true;
          break;
        }
      }
      if (stopAfterTerminalEvent) break;
    }
    if (stopAfterTerminalEvent) {
      try { await reader.cancel(); } catch (_) {}
    } else {
      const tail = decoder.end();
      if (tail) buffer += tail;
      if (buffer.length) {
        trackSseLine(buffer);
        try { res.write(buffer); } catch (_) {}
        buffer = '';
      }
    }
    finishTrackedEvent();
    if (!clientClosed && !completed && !failed) {
      const response = {
        ...(responseMeta || {}),
        id: (responseMeta && responseMeta.id) || `resp_multicc_${Date.now().toString(36)}`,
        object: 'response',
        status: 'completed',
        output: outputItems.filter(Boolean),
      };
      if (usage) response.usage = usage;
      try {
        res.write(`\n\nevent: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response,
        })}\n\n`);
      } catch (_) {}
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    if (!clientClosed) {
      try {
        res.write(`event: response.failed\ndata: ${JSON.stringify({
          type: 'response.failed',
          response: { status: 'failed', error: { message: 'stream error: ' + msg } },
        })}\n\n`);
      } catch (_) {}
    }
  } finally {
    try { res.end(); } catch (_) {}
  }
}

function sendFailed(res, message) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(`event: response.failed\ndata: ${JSON.stringify({
    type: 'response.failed',
    response: { status: 'failed', error: { message } },
  })}\n\n`);
  try { res.end(); } catch (_) {}
}

module.exports = { mountCodexProxy };
