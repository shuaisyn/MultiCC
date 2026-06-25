// Global Claude Code token usage, read straight from the canonical source:
// the claude CLI's own session transcripts under ~/.claude/projects/**/*.jsonl.
//
// This is independent of multicc's per-provider accounting (token_daily.json /
// token_usage.json), which only sees turns multicc itself spawned + closed and
// can miss usage during downtime/crashes. The transcripts are the ground truth:
// every assistant message carries a `usage` block. We dedupe by requestId+msgId
// (the CLI re-writes the same response across resume/summary), then aggregate by
// model across today / week / month / all windows, plus a per-day trend.
//
// Tokens are reported as four distinct buckets — input / output / cacheWrite
// (cache_creation) / cacheRead — never silently merged, so the UI can decide
// whether to show "fresh" (input+output) or "consumed" (all four). Cache reads
// dwarf everything on cache-heavy turns and are near-free, so conflating them
// would be misleading.
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CACHE_TTL_MS = 120 * 1000;

let cache = null;          // { generatedAt, data }
let inFlight = null;       // shared promise so concurrent requests scan once

function localDateKey(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Window boundaries (local time): today / Monday-week / month-1st.
function windowStarts() {
  const now = new Date();
  const today = localDateKey(now);
  const wk = new Date(now);
  wk.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // back to Monday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { today, week: localDateKey(wk), month: localDateKey(monthStart) };
}

function emptyBucket() {
  return { inputTokens: 0, outputTokens: 0, cacheWrite: 0, cacheRead: 0, msgs: 0 };
}
function addInto(target, model, i, o, cw, cr) {
  const b = target[model] || (target[model] = emptyBucket());
  b.inputTokens += i; b.outputTokens += o; b.cacheWrite += cw; b.cacheRead += cr; b.msgs += 1;
}

async function listJsonl(dir) {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listJsonl(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

// Bucket one record into every window it belongs to, plus the per-day trend.
function record(windows, byDay, W, dk, model, i, o, cw, cr) {
  addInto(windows.all, model, i, o, cw, cr);
  if (dk >= W.month) {
    addInto(windows.month, model, i, o, cw, cr);
    if (dk >= W.week) addInto(windows.week, model, i, o, cw, cr);
  }
  if (dk === W.today) addInto(windows.today, model, i, o, cw, cr);
  const day = byDay[dk] || (byDay[dk] = {});
  day[model] = (day[model] || 0) + i + o + cw + cr;
}

// Codex (the codex CLI) keeps its own transcripts under ~/.codex/sessions as a
// rollout event stream. Token usage arrives as `event_msg`/`token_count` events
// whose `info.total_token_usage` is CUMULATIVE per session. We diff consecutive
// cumulative snapshots (monotonic → no double-counting however often the event
// fires) and bucket each delta by its own timestamp's day. Codex's
// cached_input_tokens is a subset of input_tokens, so fresh = input - cached and
// cached maps to our cacheRead bucket; codex has no separate cache-write notion.
async function addCodexInto(windows, byDay, W) {
  const files = await listJsonl(CODEX_DIR);
  let responses = 0;
  for (const fp of files) {
    let text;
    try { text = await fsp.readFile(fp, 'utf8'); } catch { continue; }
    let model = 'codex';
    let prev = null;                 // last cumulative { input, cached, output }
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.indexOf('"token_count"') === -1 && line.indexOf('"model"') === -1) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      const p = d.payload || {};
      if (p.model) model = p.model;  // turn_context carries the active model
      if (!(d.type === 'event_msg' && p.type === 'token_count')) continue;
      const t = (p.info && p.info.total_token_usage) || null;
      if (!t) continue;
      const cur = {
        input: t.input_tokens || 0,
        cached: t.cached_input_tokens || 0,
        output: t.output_tokens || 0,
      };
      if (prev) {
        const din = Math.max(0, cur.input - prev.input);
        const dca = Math.max(0, cur.cached - prev.cached);
        const dou = Math.max(0, cur.output - prev.output);
        const fresh = Math.max(0, din - dca);
        if (fresh + dou + dca > 0) {
          record(windows, byDay, W, localDateKey(new Date(d.timestamp)), model, fresh, dou, 0, dca);
          if (dou > 0) responses++;
        }
      } else {
        // First snapshot is itself a delta from zero.
        const fresh = Math.max(0, cur.input - cur.cached);
        if (fresh + cur.output + cur.cached > 0) {
          record(windows, byDay, W, localDateKey(new Date(d.timestamp)), model, fresh, cur.output, 0, cur.cached);
          if (cur.output > 0) responses++;
        }
      }
      prev = cur;
    }
  }
  return { files: files.length, responses };
}

async function compute() {
  const files = await listJsonl(PROJECTS_DIR);
  const W = windowStarts();
  const seen = new Set();
  const windows = { today: {}, week: {}, month: {}, all: {} };
  const byDay = {};                  // dateKey -> { model -> total }
  let responses = 0;

  for (const fp of files) {
    let text;
    try { text = await fsp.readFile(fp, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line || line.indexOf('"usage"') === -1) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      const ts = d.timestamp;
      const m = d.message;
      if (!ts || !m || !m.usage) continue;
      const rid = d.requestId || '';
      const mid = m.id || d.uuid || '';
      const key = rid + ':' + mid;
      if (seen.has(key)) continue;   // same API response already counted
      seen.add(key);
      responses++;

      const u = m.usage;
      const i = u.input_tokens || 0;
      const o = u.output_tokens || 0;
      const cw = u.cache_creation_input_tokens || 0;
      const cr = u.cache_read_input_tokens || 0;
      if (i + o + cw + cr === 0) continue;   // skip <synthetic>/no-op records
      const model = m.model || 'unknown';
      record(windows, byDay, W, localDateKey(new Date(ts)), model, i, o, cw, cr);
    }
  }

  const codex = await addCodexInto(windows, byDay, W);

  return {
    generatedAt: new Date().toISOString(),
    sources: { claude: PROJECTS_DIR, codex: CODEX_DIR },
    scannedFiles: files.length + codex.files,
    responses: responses + codex.responses,
    windows,
    byDay,   // { 'YYYY-MM-DD': { model: totalTokens } }
  };
}

// Cached accessor. Re-scans at most once per TTL; concurrent callers share the
// same in-flight scan. `force` bypasses the cache (UI "refresh" button).
async function getGlobalUsage({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && (now - cache.at) < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const data = await compute();
      cache = { at: Date.now(), data };
      return data;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

module.exports = { getGlobalUsage, _compute: compute };
