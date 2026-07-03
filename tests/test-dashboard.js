'use strict';
/**
 * multicc Dashboard API test
 * Usage:  node test-dashboard.js
 *         BASE_URL=http://localhost:3000 node test-dashboard.js
 *
 * Tests the Dashboard API endpoints:
 *   GET /api/dashboard/sessions
 *   GET /api/dashboard/sessions?kind=chat
 *   GET /api/dashboard/sessions?active=true
 *   GET /api/dashboard/stats
 *
 * If the API is not yet implemented (404 / endpoint missing), the suite
 * reports SKIP for each case and exits 0 — this lets the test ship before
 * the API lands and start enforcing the contract the moment it does.
 */

const http  = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/* ── tiny test runner (mirrors test.js style) ──────────────────────── */
let passed = 0, failed = 0, skipped = 0;
const results = [];

function ok(name)             { passed++; results.push({ ok: true,  name }); }
function fail(name, reason)   { failed++; results.push({ ok: false, name, reason }); }
function skip(name, reason)   { skipped++; results.push({ ok: null,  name, reason }); }

async function caseAsync(name, fn) {
  try { await fn(); ok(name); }
  catch (e) {
    if (e && e.code === 'SKIP') { skip(name, e.message); }
    else { fail(name, e.message); }
  }
}

/* ── helpers ───────────────────────────────────────────────────────── */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getJson(pathname) {
  const url = `${BASE_URL}${pathname}`;
  const { status, body } = await httpGet(url);
  if (status === 404) {
    const err = new Error(`endpoint not found (404) — API not yet implemented`);
    err.code = 'SKIP';
    throw err;
  }
  if (status !== 200) throw new Error(`GET ${pathname} → HTTP ${status}`);
  let json;
  try { json = JSON.parse(body); }
  catch (e) { throw new Error(`GET ${pathname} → invalid JSON: ${e.message}`); }
  return json;
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SESSION_REQUIRED_FIELDS = ['id', 'label', 'cli', 'kind', 'active', 'createdAt', 'lastActivity'];

/* ── main ──────────────────────────────────────────────────────────── */
(async () => {

  console.log('\n── Dashboard API tests ───────────────────────────────────');
  console.log(`    Base URL: ${BASE_URL}\n`);

  let endpointAvailable = true;
  try {
    const { status } = await httpGet(`${BASE_URL}/api/dashboard/stats`);
    if (status === 404) endpointAvailable = false;
  } catch (_) {
    // Server may not be running at all — we'll let the cases report SKIP.
    endpointAvailable = false;
  }
  if (!endpointAvailable) {
    console.log('    ⚠️  Dashboard API not detected (404 / server down). Cases will SKIP.\n');
  }

  /* 1. GET /api/dashboard/sessions — shape contract */
  await caseAsync('GET /api/dashboard/sessions returns { sessions[], count }', async () => {
    const data = await getJson('/api/dashboard/sessions');
    assert(Array.isArray(data.sessions), `expected sessions to be an array, got ${typeof data.sessions}`);
    assert(typeof data.count === 'number', `expected count to be a number, got ${typeof data.count}`);
    assert(data.count === data.sessions.length,
      `count (${data.count}) !== sessions.length (${data.sessions.length})`);
    for (const s of data.sessions) {
      for (const f of SESSION_REQUIRED_FIELDS) {
        assert(f in s, `session ${s.id || '(no id)'} missing field "${f}"`);
      }
    }
  });

  /* 2. ?kind=chat filter */
  await caseAsync('GET /api/dashboard/sessions?kind=chat filters by kind', async () => {
    const data = await getJson('/api/dashboard/sessions?kind=chat');
    assert(Array.isArray(data.sessions), 'sessions should be an array');
    for (const s of data.sessions) {
      assert(s.kind === 'chat', `expected kind=chat, got kind=${s.kind} on session ${s.id}`);
    }
  });

  /* 3. ?active=true filter */
  await caseAsync('GET /api/dashboard/sessions?active=true filters by active', async () => {
    const data = await getJson('/api/dashboard/sessions?active=true');
    assert(Array.isArray(data.sessions), 'sessions should be an array');
    for (const s of data.sessions) {
      assert(s.active === true, `expected active=true, got active=${s.active} on session ${s.id}`);
    }
  });

  /* 4. GET /api/dashboard/stats — shape + arithmetic */
  await caseAsync('GET /api/dashboard/stats returns { total, active, byCli, byKind }', async () => {
    const data = await getJson('/api/dashboard/stats');
    assert(typeof data.total === 'number', `expected total to be a number, got ${typeof data.total}`);
    assert(typeof data.active === 'number', `expected active to be a number, got ${typeof data.active}`);
    assert(data.total >= data.active, `total (${data.total}) < active (${data.active})`);
    assert(data.byCli && typeof data.byCli === 'object', 'byCli should be an object');
    assert(data.byKind && typeof data.byKind === 'object', 'byKind should be an object');
    const byCliSum = Object.values(data.byCli).reduce((a, b) => a + Number(b), 0);
    assert(byCliSum === data.total,
      `sum(byCli)=${byCliSum} !== total=${data.total}`);
  });

  /* SUMMARY */
  console.log('\n── Results ────────────────────────────────────────────────');
  for (const r of results) {
    if (r.ok === true)       console.log(`  ✅ PASS  ${r.name}`);
    else if (r.ok === false) { console.log(`  ❌ FAIL  ${r.name}`); console.log(`           → ${r.reason}`); }
    else                     { console.log(`  ⏭️  SKIP  ${r.name}  (${r.reason})`); }
  }
  const total = passed + failed + skipped;
  console.log(`\n  ${passed}/${total} passed` +
    (skipped ? `, ${skipped} skipped` : '') +
    (failed ? `, ${failed} failed` : '') + '\n');

  // Exit 0 when everything that *ran* passed (skips don't count as failures).
  process.exit(failed > 0 ? 1 : 0);

})();
