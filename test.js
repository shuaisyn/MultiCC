'use strict';
/**
 * webcc integration test
 * Usage:  node test.js           (auto-detects running server)
 *         node test.js --no-ws   (skip WebSocket test)
 *         npm test
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');
const http  = require('http');
const https = require('https');
const WebSocket = require('ws');
const pty  = require('node-pty');

const SKIP_WS     = process.argv.includes('--no-ws');
const TIMEOUT_PTY = 20_000;
const TIMEOUT_WS  = 20_000;

/* ── tiny test runner ──────────────────────────────────────────────── */
let passed = 0, failed = 0;
const results = [];

function ok(name)           { passed++; results.push({ ok: true,  name }); }
function fail(name, reason) { failed++; results.push({ ok: false, name, reason }); }

function check(name, fn) {
  try { fn(); ok(name); }
  catch (e) { fail(name, e.message); }
}

async function checkAsync(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { fail(name, e.message); }
}

/* ── helpers ───────────────────────────────────────────────────────── */
function resolveClaude() {
  if (process.env.CLAUDE_CMD) return process.env.CLAUDE_CMD;
  const extraDirs = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/usr/local/bin', '/opt/homebrew/bin',
  ];
  for (const dir of extraDirs) {
    const p = path.join(dir, 'claude');
    if (fs.existsSync(p)) return p;
  }
  try {
    return execSync("zsh -l -c 'which claude 2>/dev/null'", { encoding: 'utf8', timeout: 5000 })
      .trim().split('\n')[0];
  } catch (_) {}
  return 'claude';
}

function detectServer() {
  const certPath = path.join(__dirname, 'cert.pem');
  const keyPath  = path.join(__dirname, 'key.pem');
  const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);
  const port     = process.env.PORT || (useHttps ? 3443 : 3000);
  const proto    = useHttps ? 'https' : 'http';
  const wsProto  = useHttps ? 'wss'   : 'ws';
  return { proto, wsProto, port };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function serverIsUp(proto, port) {
  return httpGet(`${proto}://localhost:${port}/api/sessions`)
    .then(r => r.status === 200)
    .catch(() => false);
}

/* ── main ──────────────────────────────────────────────────────────── */
(async () => {

  /* 1. STATIC CHECKS */
  console.log('\n── Static checks ──────────────────────────────────────────');

  const spawnHelper = path.join(
    __dirname,
    'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'
  );

  check('spawn-helper exists', () => {
    if (!fs.existsSync(spawnHelper)) throw new Error(`not found: ${spawnHelper}`);
  });

  check('spawn-helper is executable', () => {
    const stat = fs.statSync(spawnHelper);
    if (!(stat.mode & 0o111)) {
      fs.chmodSync(spawnHelper, 0o755);
      console.log('    (auto-fixed: chmod +x spawn-helper)');
    }
  });

  check('node-pty native module loads', () => { require('node-pty'); });

  const CLAUDE_CMD = resolveClaude();
  check('claude binary found', () => {
    if (!CLAUDE_CMD || !fs.existsSync(CLAUDE_CMD))
      throw new Error(`not found (tried: ${CLAUDE_CMD})`);
  });

  check('claude binary is executable', () => {
    const stat = fs.statSync(CLAUDE_CMD);
    if (!(stat.mode & 0o111)) throw new Error(`not executable: ${CLAUDE_CMD}`);
  });

  /* 2. PTY SPAWN TEST */
  console.log('\n── PTY spawn test ─────────────────────────────────────────');

  await checkAsync('claude spawns in PTY and produces output', () =>
    new Promise((resolve, reject) => {
      let proc;
      const timer = setTimeout(() => {
        try { proc && proc.kill(); } catch (_) {}
        reject(new Error(`no output within ${TIMEOUT_PTY / 1000}s`));
      }, TIMEOUT_PTY);

      try {
        proc = pty.spawn(CLAUDE_CMD, [], {
          name: 'xterm-256color',
          cols: 120, rows: 30,
          cwd: os.homedir(),
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        });
      } catch (e) {
        clearTimeout(timer);
        return reject(e);
      }

      proc.onData(() => {
        clearTimeout(timer);
        try { proc.kill(); } catch (_) {}
        resolve();
      });

      proc.onExit(({ exitCode }) => {
        clearTimeout(timer);
        if (exitCode !== 0 && exitCode !== null)
          reject(new Error(`claude exited immediately with code ${exitCode}`));
        else
          resolve();
      });
    })
  );

  /* 3. WEBSOCKET INTEGRATION TEST */
  if (SKIP_WS) {
    console.log('\n── WebSocket test (skipped via --no-ws) ───────────────────');
  } else {
    console.log('\n── WebSocket integration test ─────────────────────────────');
    const { proto, wsProto, port } = detectServer();
    const isUp = await serverIsUp(proto, port);

    if (!isUp) {
      console.log(`  ⚠  Server not running on ${proto}://localhost:${port}`);
      console.log('     Run "npm start" in another terminal then re-run to include WS test.');
    } else {
      await checkAsync('GET /api/sessions returns 200', async () => {
        const r = await httpGet(`${proto}://localhost:${port}/api/sessions`);
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      });

      await checkAsync('WebSocket: new session gets session_id + PTY output', () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`${wsProto}://localhost:${port}`, {
            rejectUnauthorized: false,
          });
          let gotSessionId = false;
          let sessionId = null;

          const timer = setTimeout(() => {
            ws.terminate();
            reject(new Error(
              gotSessionId
                ? `session ${sessionId} created but no PTY output within ${TIMEOUT_WS / 1000}s`
                : `no session_id within ${TIMEOUT_WS / 1000}s`
            ));
          }, TIMEOUT_WS);

          ws.on('error', e => { clearTimeout(timer); reject(e); });

          ws.on('message', raw => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.type === 'error') {
              clearTimeout(timer);
              ws.terminate();
              return reject(new Error(`server error: ${msg.data}`));
            }
            if (msg.type === 'session_id') {
              gotSessionId = true;
              sessionId = msg.id;
              console.log(`    session_id received: ${sessionId}`);
              return;
            }
            if (msg.type === 'output' && msg.data) {
              clearTimeout(timer);
              console.log(`    first output: ${JSON.stringify(msg.data.slice(0, 60))}…`);
              ws.close();
              // clean up test session
              if (sessionId) {
                const lib = proto === 'https' ? https : http;
                const req = lib.request(
                  { hostname: 'localhost', port, path: `/api/sessions/${sessionId}`, method: 'DELETE', rejectUnauthorized: false },
                  () => {}
                );
                req.on('error', () => {});
                req.end();
              }
              resolve();
            }
          });
        })
      );
    }
  }

  /* 4. VOICE SSE INTEGRATION TESTS */
  console.log('\n── Voice SSE integration tests ────────────────────────────');
  {
    const { proto, port } = detectServer();
    const isUp = await serverIsUp(proto, port);

    if (!isUp) {
      console.log(`  ⚠  Server not running, skipping voice SSE tests`);
    } else {

      // Helper: HTTP POST that returns raw response for SSE streaming
      function httpPost(url, body) {
        return new Promise((resolve, reject) => {
          const lib = url.startsWith('https') ? https : http;
          const urlObj = new URL(url);
          const req = lib.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            rejectUnauthorized: false,
          }, (res) => {
            // Clear the connection timeout once we receive headers;
            // the SSE stream timeout in readSSEStream will manage the rest.
            req.setTimeout(0);
            resolve(res);
          });
          req.on('error', reject);
          req.setTimeout(10000, () => { req.destroy(); reject(new Error('request timeout')); });
          req.write(JSON.stringify(body));
          req.end();
        });
      }

      // Helper: read SSE stream and parse events
      function readSSEStream(res, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
          const events = [];
          let buf = '';
          let rawChunks = [];
          const timer = setTimeout(() => {
            res.destroy();
            reject(new Error(`SSE stream timeout after ${timeoutMs / 1000}s. Events so far: ${JSON.stringify(events)}. Raw chunks: ${rawChunks.join('')}`));
          }, timeoutMs);

          res.on('data', (chunk) => {
            const text = chunk.toString();
            rawChunks.push(text);
            console.log(`    [sse-reader] chunk (${text.length} bytes): ${JSON.stringify(text.slice(0, 150))}`);
            buf += text;
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const payload = line.slice(6).trim();
              if (payload === '[DONE]') {
                events.push({ type: 'done' });
              } else {
                try {
                  const parsed = JSON.parse(payload);
                  events.push({ type: 'data', ...parsed });
                } catch (e) {
                  events.push({ type: 'parse_error', raw: payload, error: e.message });
                }
              }
            }
          });

          res.on('end', () => {
            clearTimeout(timer);
            console.log(`    [sse-reader] stream ended. Total events: ${events.length}`);
            resolve(events);
          });

          res.on('error', (e) => {
            clearTimeout(timer);
            reject(new Error(`SSE stream error: ${e.message}. Events so far: ${JSON.stringify(events)}`));
          });
        });
      }

      // Test 1: SSE test endpoint (no claude dependency)
      await checkAsync('SSE test endpoint streams 3 chunks + [DONE]', async () => {
        const res = await new Promise((resolve, reject) => {
          const lib = proto === 'https' ? https : http;
          lib.get(`${proto}://localhost:${port}/api/voice/test-sse`, { rejectUnauthorized: false }, resolve)
            .on('error', reject);
        });
        console.log(`    Response status: ${res.statusCode}`);
        console.log(`    Content-Type: ${res.headers['content-type']}`);

        if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
        if (!res.headers['content-type']?.includes('text/event-stream')) {
          throw new Error(`Expected text/event-stream, got: ${res.headers['content-type']}`);
        }

        const events = await readSSEStream(res, 10000);
        console.log(`    Events received: ${JSON.stringify(events)}`);

        const dataEvents = events.filter(e => e.type === 'data');
        const doneEvents = events.filter(e => e.type === 'done');
        if (dataEvents.length !== 3) throw new Error(`Expected 3 data events, got ${dataEvents.length}`);
        if (doneEvents.length !== 1) throw new Error(`Expected 1 [DONE] event, got ${doneEvents.length}`);
      });

      // Test 2: Voice refine with empty input (immediate [DONE])
      await checkAsync('Voice refine: empty input returns immediate [DONE]', async () => {
        const res = await httpPost(`${proto}://localhost:${port}/api/voice/refine`, { raw: '' });
        console.log(`    Response status: ${res.statusCode}`);
        console.log(`    Content-Type: ${res.headers['content-type']}`);
        const events = await readSSEStream(res, 5000);
        console.log(`    Events: ${JSON.stringify(events)}`);
        const doneEvents = events.filter(e => e.type === 'done');
        if (doneEvents.length !== 1) throw new Error(`Expected 1 [DONE], got ${doneEvents.length}`);
      });

      // Test 3: Voice refine with real input (full claude flow)
      await checkAsync('Voice refine: real input streams text + [DONE]', async () => {
        console.log('    Sending real voice refine request (may take up to 60s)...');
        const res = await httpPost(`${proto}://localhost:${port}/api/voice/refine`, { raw: '帮我检查一下git status' });
        console.log(`    Response status: ${res.statusCode}`);
        console.log(`    Content-Type: ${res.headers['content-type']}`);
        console.log(`    All headers: ${JSON.stringify(Object.fromEntries(Object.entries(res.headers)))}`);

        if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);

        const events = await readSSEStream(res, 65000);
        console.log(`    Total events: ${events.length}`);
        console.log(`    Events breakdown: ${JSON.stringify(events.map(e => ({ type: e.type, textLen: e.text?.length })))}`);

        const dataEvents = events.filter(e => e.type === 'data');
        const doneEvents = events.filter(e => e.type === 'done');
        const parseErrors = events.filter(e => e.type === 'parse_error');

        if (parseErrors.length > 0) {
          console.log(`    ⚠ Parse errors: ${JSON.stringify(parseErrors)}`);
        }

        if (dataEvents.length === 0) {
          throw new Error(`No data events received. All events: ${JSON.stringify(events)}`);
        }
        if (doneEvents.length !== 1) {
          throw new Error(`Expected exactly 1 [DONE], got ${doneEvents.length}. All events: ${JSON.stringify(events)}`);
        }

        const fullText = dataEvents.map(e => e.text || '').join('');
        console.log(`    Refined text: ${JSON.stringify(fullText.slice(0, 200))}`);
        if (!fullText.trim()) {
          throw new Error('Data events received but combined text is empty');
        }
      });

      // Test 4: Verify SSE format is valid (manual byte-level check)
      await checkAsync('Voice refine: SSE format byte-level verification', async () => {
        const res = await httpPost(`${proto}://localhost:${port}/api/voice/refine`, { raw: '测试SSE格式' });
        const rawData = await new Promise((resolve, reject) => {
          const chunks = [];
          const timer = setTimeout(() => { res.destroy(); reject(new Error('timeout')); }, 65000);
          res.on('data', c => chunks.push(c));
          res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
          res.on('error', e => { clearTimeout(timer); reject(e); });
        });

        console.log(`    Raw SSE data (${rawData.length} bytes): ${JSON.stringify(rawData.slice(0, 300))}`);

        // Check each SSE event ends with \n\n
        const eventBlocks = rawData.split('\n\n').filter(b => b.trim());
        console.log(`    Event blocks count: ${eventBlocks.length}`);
        for (const block of eventBlocks) {
          if (!block.startsWith('data: ')) {
            throw new Error(`Event block doesn't start with "data: ": ${JSON.stringify(block.slice(0, 100))}`);
          }
        }

        // Verify the last event is [DONE]
        const lastBlock = eventBlocks[eventBlocks.length - 1];
        if (!lastBlock.includes('[DONE]')) {
          throw new Error(`Last event is not [DONE]: ${JSON.stringify(lastBlock)}`);
        }
      });

      // Test 5: Concurrent requests (queue behavior)
      await checkAsync('Voice refine: concurrent requests are queued correctly', async () => {
        console.log('    Sending 2 concurrent requests...');
        const [res1, res2] = await Promise.all([
          httpPost(`${proto}://localhost:${port}/api/voice/refine`, { raw: '第一个请求' }),
          httpPost(`${proto}://localhost:${port}/api/voice/refine`, { raw: '第二个请求' }),
        ]);

        console.log(`    Response 1 status: ${res1.statusCode}, Response 2 status: ${res2.statusCode}`);

        const [events1, events2] = await Promise.all([
          readSSEStream(res1, 120000),
          readSSEStream(res2, 120000),
        ]);

        console.log(`    Request 1 events: ${events1.length}, Request 2 events: ${events2.length}`);

        const done1 = events1.filter(e => e.type === 'done').length;
        const done2 = events2.filter(e => e.type === 'done').length;
        if (done1 !== 1) throw new Error(`Request 1: expected 1 [DONE], got ${done1}`);
        if (done2 !== 1) throw new Error(`Request 2: expected 1 [DONE], got ${done2}`);

        const data1 = events1.filter(e => e.type === 'data');
        const data2 = events2.filter(e => e.type === 'data');
        if (data1.length === 0) throw new Error('Request 1: no data events');
        if (data2.length === 0) throw new Error('Request 2: no data events');

        console.log(`    Both requests completed with data + [DONE] ✓`);
      });
    }
  }

  /* SUMMARY */
  console.log('\n── Results ────────────────────────────────────────────────');
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓  ${r.name}`);
    } else {
      console.log(`  ✗  ${r.name}`);
      console.log(`       → ${r.reason}`);
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);

})();
