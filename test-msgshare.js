'use strict';
// E2E for message (snapshot) sharing: select messages → link; snapshot survives
// session deletion; password gate works.
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const WebSocket = require('ws');

const PORT = 3998, TOKEN = '1234qwer', BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-msgshare-'));
const T = Date.now(); const log = (...a) => console.log(`[${((Date.now() - T) / 1000).toFixed(1)}s]`, ...a);
const A = { 'Content-Type': 'application/json', 'X-Access-Token': TOKEN };
const REC = { 'Content-Type': 'application/json' };
const api = async (m, p, b, h) => { const r = await fetch(BASE + p, { method: m, headers: h || A, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, j, headers: r.headers }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; log('✅', m); } else { fail++; log('❌', m); } };

let srv, sid;
(async () => {
  srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', () => {});
  for (let i = 0; i < 40; i++) { const r = await api('GET', '/api/server-info?token=' + TOKEN).catch(() => ({ status: 0 })); if (r.status === 200) break; await sleep(500); }
  log('server up');
  const dir = (await api('POST', '/api/directories', { name: 'ms', path: tmp, create: true })).j;
  sid = (await api('POST', `/api/directories/${dir.id}/sessions`, { cli: 'claude', kind: 'chat', model: 'haiku' })).j.id;

  // seed history with one real turn
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/chat?session=${sid}&token=${TOKEN}`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await new Promise((resolve) => { const on = (raw) => { let e; try { e = JSON.parse(raw); } catch { return; } if (e.type === 'stream_end') { ws.off('message', on); resolve(); } }; ws.on('message', on); ws.send(JSON.stringify({ type: 'user_message', text: '只回复一个词：苹果' })); });
  ws.close();

  const hist = await api('GET', `/api/sessions/${sid}/history`);
  ok(hist.status === 200 && hist.j.messages.length >= 2, `history has messages (${hist.j.messages?.length})`);

  // public message snapshot of both messages
  const shareRes = await api('POST', `/api/sessions/${sid}/share-messages`, { indices: [0, 1] });
  ok(shareRes.j.ok && shareRes.j.type === 'messages' && shareRes.j.messageCount === 2, 'created public message snapshot (2 msgs)');
  const tok = shareRes.j.token;
  const recGet = await api('GET', `/api/share/${tok}/session`, null, REC);
  ok(recGet.status === 200 && recGet.j.type === 'messages' && recGet.j.messages.length === 2, 'recipient reads snapshot without admin token');

  // snapshot independence: delete the session, snapshot still resolves
  await api('DELETE', `/api/sessions/${sid}`);
  const afterDel = await api('GET', `/api/share/${tok}/session`, null, REC);
  ok(afterDel.status === 200 && afterDel.j.messages.length === 2, 'snapshot survives session deletion (independent copy)');
  sid = null;

  // password-protected message snapshot (recreate a session quickly to pick from is not needed;
  // reuse: create another snapshot from the deleted session would 404, so test password on a fresh one)
  const dir2 = (await api('POST', '/api/directories', { name: 'ms2', path: fs.mkdtempSync(path.join(tmp, 's2-')), create: true })).j;
  const sid2 = (await api('POST', `/api/directories/${dir2.id}/sessions`, { cli: 'claude', kind: 'chat', model: 'haiku' })).j.id;
  const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/ws/chat?session=${sid2}&token=${TOKEN}`);
  await new Promise((res, rej) => { ws2.on('open', res); ws2.on('error', rej); });
  await new Promise((resolve) => { const on = (raw) => { let e; try { e = JSON.parse(raw); } catch { return; } if (e.type === 'stream_end') { ws2.off('message', on); resolve(); } }; ws2.on('message', on); ws2.send(JSON.stringify({ type: 'user_message', text: '只回复一个词：香蕉' })); });
  ws2.close();
  const pwShare = (await api('POST', `/api/sessions/${sid2}/share-messages`, { indices: [0], password: 'pw1' })).j;
  ok(pwShare.token, 'created password message snapshot');
  const noPw = await api('GET', `/api/share/${pwShare.token}/session`, null, REC);
  ok(noPw.status === 401, 'password snapshot → 401 without auth');
  const auth = await api('POST', `/api/share/${pwShare.token}/auth`, { password: 'pw1' }, REC);
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
  const withCk = await api('GET', `/api/share/${pwShare.token}/session`, null, { ...REC, Cookie: cookie });
  ok(withCk.status === 200 && withCk.j.messages.length === 1, 'password snapshot readable after auth');

  await api('DELETE', `/api/sessions/${sid2}`).catch(() => {});
  srv.kill('SIGTERM'); fs.rmSync(tmp, { recursive: true, force: true });
  log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} (${pass} pass, ${fail} fail)`);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 500);
})().catch(async (e) => { console.error('FAILED:', e.message); if (srv) srv.kill('SIGTERM'); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} setTimeout(() => process.exit(1), 500); });
