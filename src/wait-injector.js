'use strict';

// ── Wait injector: continue a chat session when external data arrives ──
//
// A `claude -p` turn ends when the model yields (even if it said "I'll wait for
// X"). Streaming keeps the process warm, but SOMETHING still has to deliver the
// awaited data as the next message. This module is that something. Three modes:
//
//   A. callback  — the model registers a wait and hands the caller a callback
//                  URL; when the external system POSTs the result, we inject it.
//   B. poll      — the model gives a shell command or URL + a match condition;
//                  we poll on an interval and inject the output once it matches.
//   D. auto      — fallback with NO explicit registration: when a turn ends in a
//                  "waiting on background (not on the user)" state, nudge the
//                  session to continue. Guarded: capped consecutive count,
//                  reset by any real user message, skipped if an explicit
//                  wait (A/B) is already pending for that session.
//
// All three converge on inject() → runChatTurn(session, text), which for a
// streaming session feeds the warm process (queued if a turn is mid-flight) and
// for a default session does a --resume turn. So this works regardless of mode.

const crypto = require('crypto');

// Injected dependencies (set by init) so the module is testable in isolation.
let _inject = async () => {};   // (session, text) => Promise   — runChatTurn wrapper
let _exec = async () => ({ stdout: '', code: 1 }); // (cmd, cwd) => {stdout, stderr, code}
let _isBusy = () => false;      // (session) => bool             — is a turn in flight
let _log = () => {};

const waits = new Map();        // waitId -> wait spec/state
const autoState = new Map();    // session -> { count, lastHash }
let ticker = null;

const TICK_MS = 1000;
const DEFAULTS = { intervalSec: 15, maxChecks: 40, timeoutSec: 1800 };
const MIN_INTERVAL_SEC = 3;
const MAX_AUTO_CONTINUE = 5;     // consecutive auto-continues before giving up

function genId() { return 'w_' + crypto.randomBytes(6).toString('hex'); }
function genToken() { return crypto.randomBytes(16).toString('hex'); }

function init({ inject, exec, isBusy, log } = {}) {
  if (inject) _inject = inject;
  if (exec) _exec = exec;
  if (isBusy) _isBusy = isBusy;
  if (log) _log = log;
  startTicker();
}

function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (ticker.unref) ticker.unref();
}

// ── Registration (A/B) ──
// spec: { session, mode:'poll'|'callback', cwd?, baseUrl?,
//         pollCmd?|pollUrl?, untilContains?|untilRegex?, intervalSec?, maxChecks?,
//         injectPrefix?, timeoutSec? }
function register(spec, nowMs) {
  const now = nowMs || Date.now();
  if (!spec || !spec.session) throw new Error('session required');
  const mode = spec.mode === 'callback' ? 'callback' : 'poll';
  const w = {
    id: genId(),
    token: genToken(),
    session: spec.session,
    mode,
    cwd: spec.cwd || process.cwd(),
    injectPrefix: typeof spec.injectPrefix === 'string' ? spec.injectPrefix : null,
    createdAt: now,
    checks: 0,
    inFlight: false,
  };

  if (mode === 'poll') {
    if (!spec.pollCmd && !spec.pollUrl) throw new Error('poll mode needs pollCmd or pollUrl');
    if (!spec.untilContains && !spec.untilRegex) throw new Error('poll mode needs untilContains or untilRegex');
    w.pollCmd = spec.pollCmd || null;
    w.pollUrl = spec.pollUrl || null;
    w.untilContains = spec.untilContains || null;
    w.untilRegex = spec.untilRegex || null;
    w.intervalSec = Math.max(MIN_INTERVAL_SEC, Number(spec.intervalSec) || DEFAULTS.intervalSec);
    w.maxChecks = Math.max(1, Number(spec.maxChecks) || DEFAULTS.maxChecks);
    w.nextAt = now + w.intervalSec * 1000;
  } else {
    w.timeoutSec = Math.max(10, Number(spec.timeoutSec) || DEFAULTS.timeoutSec);
    w.expireAt = now + w.timeoutSec * 1000;
  }

  waits.set(w.id, w);
  _log(`[wait] registered ${w.id} mode=${mode} session=${w.session}`);
  return { id: w.id, token: w.token, mode };
}

function publicView(w) {
  return {
    id: w.id, session: w.session, mode: w.mode, checks: w.checks || 0,
    maxChecks: w.maxChecks, intervalSec: w.intervalSec,
    pollCmd: w.pollCmd, pollUrl: w.pollUrl,
    untilContains: w.untilContains, untilRegex: w.untilRegex,
    createdAt: w.createdAt,
  };
}

function listForSession(session) {
  return [...waits.values()].filter(w => w.session === session).map(publicView);
}

function hasWait(session) {
  for (const w of waits.values()) if (w.session === session) return true;
  return false;
}

// ── Callback resolution (A) ──
function resolve(id, token, data) {
  const w = waits.get(id);
  if (!w) return { ok: false, error: 'wait not found' };
  if (w.token !== token) return { ok: false, error: 'bad token' };
  waits.delete(id);
  const prefix = w.injectPrefix || '[等待的数据已返回]';
  _log(`[wait] resolved ${id} via callback`);
  fireInject(w.session, `${prefix}\n${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return { ok: true };
}

function cancel(id) {
  const had = waits.delete(id);
  return { ok: had };
}

function cancelForSession(session) {
  let n = 0;
  for (const [id, w] of waits) if (w.session === session) { waits.delete(id); n++; }
  autoState.delete(session);
  return n;
}

// ── Poll driver (B) + callback timeout ──
async function tick(nowMs) {
  const now = nowMs || Date.now();
  for (const w of [...waits.values()]) {
    if (w.mode === 'callback') {
      if (now >= w.expireAt) { waits.delete(w.id); _log(`[wait] callback ${w.id} timed out`); }
      continue;
    }
    // poll
    if (w.inFlight || now < w.nextAt) continue;
    w.inFlight = true;
    try {
      const out = await runProbe(w);
      if (matches(w, out)) {
        waits.delete(w.id);
        const prefix = w.injectPrefix || '[轮询条件已满足]';
        _log(`[wait] poll ${w.id} matched after ${w.checks + 1} checks`);
        fireInject(w.session, `${prefix}\n${out.slice(0, 4000)}`);
        continue;
      }
      w.checks++;
      if (w.checks >= w.maxChecks) {
        waits.delete(w.id);
        _log(`[wait] poll ${w.id} gave up after ${w.checks} checks`);
        fireInject(w.session, `[轮询超时] 等待的条件在 ${w.checks} 次检查后仍未满足，请决定是继续等待还是改用其它方式。`);
      } else {
        w.nextAt = now + w.intervalSec * 1000;
      }
    } catch (e) {
      w.checks++;
      w.nextAt = now + w.intervalSec * 1000;
      _log(`[wait] poll ${w.id} probe error: ${e.message}`);
    } finally {
      w.inFlight = false;
    }
  }
}

async function runProbe(w) {
  if (w.pollUrl) {
    const r = await fetch(w.pollUrl);
    return await r.text();
  }
  const { stdout, stderr } = await _exec(w.pollCmd, w.cwd);
  return `${stdout || ''}${stderr || ''}`;
}

function matches(w, out) {
  if (w.untilContains) return out.includes(w.untilContains);
  if (w.untilRegex) { try { return new RegExp(w.untilRegex).test(out); } catch { return false; } }
  return false;
}

// ── Auto-continue fallback (D) ──
// Called from the post-turn classifier when state === 'background'. Guarded so a
// session can't auto-loop forever. Skipped if an explicit wait already covers it.
function autoContinue(session, opts = {}) {
  if (hasWait(session)) { _log(`[wait] auto skip ${session}: explicit wait pending`); return false; }
  const st = autoState.get(session) || { count: 0, lastHash: null };
  if (st.count >= MAX_AUTO_CONTINUE) {
    _log(`[wait] auto cap reached for ${session} (${st.count})`);
    return false;
  }
  st.count++;
  autoState.set(session, st);
  const nudge = opts.nudge ||
    '继续：你上一轮提到的在等待的外部结果，如果已经可以推进就继续完成任务；如果确实还需要等待，请用 multicc 的 /wait 接口注册轮询或回调，而不要直接停下。';
  _log(`[wait] auto-continue ${session} (#${st.count})`);
  const d = Number(opts.delayMs);
  const delayMs = Number.isFinite(d) ? Math.max(0, d) : 2000;
  setTimeout(() => fireInject(session, nudge), delayMs);
  return true;
}

// Reset the auto-continue counter — call on a real user message, or when the
// turn ends "done" / "waiting on user".
function resetAuto(session) { autoState.delete(session); }

// Inject only when the session is free; if a turn is mid-flight, retry shortly
// so we never interrupt the very work we are waiting on. (Streaming queues
// internally too, but this keeps default sessions safe.)
function fireInject(session, text, attempt = 0) {
  if (_isBusy(session) && attempt < 60) {
    setTimeout(() => fireInject(session, text, attempt + 1), 1000);
    return;
  }
  Promise.resolve(_inject(session, text)).catch(e => _log(`[wait] inject failed for ${session}: ${e.message}`));
}

function stats() {
  return { waits: waits.size, autoSessions: autoState.size };
}

module.exports = {
  init, register, resolve, cancel, cancelForSession,
  listForSession, hasWait, tick, autoContinue, resetAuto, stats,
  _waits: waits, // for tests
};
