'use strict';
// Serial git executor + small TTL memo. Every git subprocess routed through
// runGit() runs one-at-a-time (never concurrently), so independent HTTP requests
// can't fork dozens of git processes at once or trip over each other's index.lock.
// runGit is async (execFile) so the Node event loop stays free while git runs —
// unlike the execFileSync sprinkled through the codebase, which blocks the whole
// server for the duration of every git call.
const { execFile } = require('child_process');

let chain = Promise.resolve();   // tail of the serial queue
let depth = 0;                   // queued + running

// Run `git <args>` in `cwd`, serialized behind every other runGit() call.
// Resolves with raw stdout (NOT trimmed — callers that want a value trim it).
function runGit(cwd, args, opts = {}) {
  depth++;
  const exec = () => new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: opts.timeout || 120000,
      maxBuffer: opts.maxBuffer || 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); }
      else resolve(stdout);
    });
  });
  // Append to the chain. `.then(exec, exec)` makes the next op run regardless of
  // whether the previous one resolved or rejected, so one failure never wedges
  // the queue. The chain itself swallows results so it can't leak rejections.
  const result = chain.then(exec, exec);
  chain = result.then(() => {}, () => {});
  const done = () => { depth--; };
  result.then(done, done);
  return result;
}

function queueDepth() { return depth; }

// ── Tiny synchronous TTL memo, with per-key jitter so a batch of entries
// populated in the same tick don't all expire on the same future tick (which
// would make one unlucky poll pay the full recompute cost). Used to wrap
// synchronous git helpers (e.g. worktree merge-state) that are called once per
// item across large lists on every poll.
function makeTtlCache(baseTtlMs, jitterMs = 0) {
  const store = new Map();   // key -> { value, expiry }
  return {
    // compute() is only called on a miss; its result is cached until expiry.
    get(key, compute) {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expiry > now) return hit.value;
      const value = compute();
      const ttl = baseTtlMs + (jitterMs ? Math.floor(Math.random() * jitterMs) : 0);
      store.set(key, { value, expiry: now + ttl });
      return value;
    },
    set(key, value) {
      const ttl = baseTtlMs + (jitterMs ? Math.floor(Math.random() * jitterMs) : 0);
      store.set(key, { value, expiry: Date.now() + ttl });
    },
    delete(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}

module.exports = { runGit, queueDepth, makeTtlCache };
