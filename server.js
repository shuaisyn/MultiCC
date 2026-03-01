'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const app = express();

const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');
const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);
const PORT = process.env.PORT || (useHttps ? 3443 : 3000);

let server;
if (useHttps) {
  const sslOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  server = https.createServer(sslOptions, app);
  // HTTP → HTTPS redirect
  const httpApp = express();
  httpApp.use((req, res) => {
    res.redirect(301, `https://${req.hostname}:${PORT}${req.url}`);
  });
  http.createServer(httpApp).listen(3000, () => {
    console.log(`  HTTP redirect running on http://localhost:3000\n`);
  });
} else {
  server = http.createServer(app);
}

const wss = new WebSocket.Server({ server });
const isWindows = process.platform === 'win32';

// Resolve the full path of the claude executable at startup
function resolveClaude() {
  if (process.env.CLAUDE_CMD) {
    console.log(`[webcc] CLAUDE_CMD override: ${process.env.CLAUDE_CMD}`);
    return process.env.CLAUDE_CMD;
  }

  const extraPaths = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.local', 'share', 'claude', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.npm', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
  ];
  const sep = isWindows ? ';' : ':';
  const augmentedPath = [...new Set([...extraPaths, ...(process.env.PATH || '').split(sep)])].join(sep);
  process.env.PATH = augmentedPath;

  if (!isWindows) {
    // Try login shell first — it sources ~/.zshrc / ~/.bashrc and sees the real PATH
    const shells = ['/bin/zsh', '/bin/bash'];
    for (const sh of shells) {
      if (!fs.existsSync(sh)) continue;
      try {
        const result = execSync(`${sh} -l -c 'which claude 2>/dev/null'`, {
          encoding: 'utf8',
          timeout: 5000,
        });
        const found = result.trim().split(/\r?\n/)[0].trim();
        if (found && fs.existsSync(found)) {
          console.log(`[webcc] Found claude via ${sh}: ${found}`);
          return found;
        }
      } catch (_) {}
    }
  }

  // Try which/where with augmented PATH
  try {
    const result = execSync(isWindows ? 'where claude' : 'which claude', {
      encoding: 'utf8',
      env: { ...process.env, PATH: augmentedPath },
      timeout: 5000,
    });
    const lines = result.trim().split(/\r?\n/);
    const exe = isWindows ? lines.find(l => l.endsWith('.exe')) || lines[0] : lines[0];
    const found = exe.trim();
    if (found) {
      console.log(`[webcc] Found claude via which: ${found}`);
      return found;
    }
  } catch (_) {}

  // Direct file existence check
  for (const dir of extraPaths) {
    const candidate = path.join(dir, isWindows ? 'claude.exe' : 'claude');
    if (fs.existsSync(candidate)) {
      console.log(`[webcc] Found claude via direct check: ${candidate}`);
      return candidate;
    }
  }

  console.warn('[webcc] WARNING: Could not locate claude binary, falling back to "claude"');
  return isWindows ? 'claude.exe' : 'claude';
}

const CLAUDE_CMD = resolveClaude();
const CLAUDE_ARGS = process.env.CLAUDE_ARGS ? process.env.CLAUDE_ARGS.split(' ') : [];
console.log(`[webcc] Using claude: ${CLAUDE_CMD}`);

// ── Session persistence ──
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

function loadPersistedSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      const map = new Map();
      for (const s of data) map.set(s.id, s);
      console.log(`[webcc] Loaded ${map.size} persisted session(s)`);
      return map;
    }
  } catch (e) {
    console.error('[webcc] Failed to load sessions.json:', e.message);
  }
  return new Map();
}

function savePersistedSessions() {
  const data = [...persistedSessions.values()].map(({ id, cwd, createdAt }) => ({ id, cwd, createdAt }));
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[webcc] Failed to save sessions.json:', e.message);
  }
}

const persistedSessions = loadPersistedSessions();

// ── Session management ──
// { id, ptyProcess, buffer: string[], clients: Set<ws>, createdAt, lastActivity, cwd }
const sessions = new Map();

function generateId() {
  let id = '';
  while (id.length < 8) id += Math.random().toString(36).slice(2);
  return id.slice(0, 8);
}

function resolveCwd(current, arg) {
  if (!arg || arg === '~') return os.homedir();
  if (arg.startsWith('~/') || arg.startsWith('~\\')) return path.join(os.homedir(), arg.slice(2));
  return path.resolve(current, arg);
}

function createSession(id, cwd) {
  // Fall back to homedir if the persisted cwd no longer exists (e.g. Windows paths on macOS)
  if (!cwd || !fs.existsSync(cwd)) {
    if (cwd) console.warn(`[webcc] cwd "${cwd}" not found, falling back to home dir`);
    cwd = os.homedir();
  }
  console.log(`[webcc] Spawning: ${CLAUDE_CMD} ${CLAUDE_ARGS.join(' ')} in ${cwd}`);
  const ptyProcess = pty.spawn(CLAUDE_CMD, CLAUDE_ARGS, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  const persisted = persistedSessions.get(id);
  const session = {
    id,
    ptyProcess,
    buffer: [],
    clients: new Set(),
    createdAt: persisted ? new Date(persisted.createdAt) : new Date(),
    lastActivity: new Date(),
    cwd,
  };

  // Save to persistence
  persistedSessions.set(id, { id, cwd, createdAt: session.createdAt });
  savePersistedSessions();

  ptyProcess.onData((data) => {
    session.buffer.push(data);
    if (session.buffer.length > 500) session.buffer.shift();
    session.lastActivity = new Date();
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'output', data }));
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    // Guard against stale exits (e.g. after relocate killed the old PTY)
    if (sessions.get(id) !== session) return;
    console.log(`[webcc] Session ${id} exited (code ${exitCode})`);
    const exitMsg = `\r\n\x1b[33m[Claude Code process exited (code ${exitCode})]\x1b[0m\r\n`;
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'exit', data: exitMsg }));
      }
    }
    sessions.delete(id);
    // Keep in persistedSessions so it can be restored on reconnect
  });

  sessions.set(id, session);
  return session;
}

// ── REST API ──
app.use(express.json());

app.get('/api/sessions', (req, res) => {
  const list = [...persistedSessions.values()].map(p => {
    const active = sessions.get(p.id);
    return active
      ? { id: active.id, cwd: active.cwd, createdAt: active.createdAt, lastActivity: active.lastActivity, clients: active.clients.size, active: true }
      : { id: p.id, cwd: p.cwd, createdAt: p.createdAt, lastActivity: null, clients: 0, active: false };
  });
  res.json(list);
});

app.get('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  const active = sessions.get(id);
  const persisted = persistedSessions.get(id);
  if (!active && !persisted) return res.status(404).json({ error: 'Session not found' });
  if (active) {
    res.json({ id: active.id, cwd: active.cwd, createdAt: active.createdAt, lastActivity: active.lastActivity, clients: active.clients.size, active: true });
  } else {
    res.json({ id: persisted.id, cwd: persisted.cwd, createdAt: persisted.createdAt, lastActivity: null, clients: 0, active: false });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session && !persistedSessions.has(req.params.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (session) {
    try { session.ptyProcess.kill(); } catch (_) {}
    sessions.delete(req.params.id);
  }
  persistedSessions.delete(req.params.id);
  savePersistedSessions();
  res.json({ ok: true });
});

app.post('/api/sessions/:id/relocate', (req, res) => {
  const id = req.params.id;
  const rawCwd = (req.body.cwd || '').trim();
  if (!rawCwd) return res.status(400).json({ error: 'cwd required' });

  const rawCurrentCwd = (sessions.get(id) || persistedSessions.get(id))?.cwd;
  const currentCwd = (rawCurrentCwd && fs.existsSync(rawCurrentCwd)) ? rawCurrentCwd : os.homedir();
  const resolvedCwd = resolveCwd(currentCwd, rawCwd);

  if (!fs.existsSync(resolvedCwd)) {
    return res.status(400).json({ error: `目录不存在: ${resolvedCwd}` });
  }

  const oldSession = sessions.get(id);

  // Notify clients before killing so they can clear & prepare to reconnect
  if (oldSession) {
    for (const client of oldSession.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'relocate', cwd: resolvedCwd }));
      }
    }
  }

  // Remove from map first so the onExit guard skips the stale exit
  sessions.delete(id);
  if (oldSession) {
    try { oldSession.ptyProcess.kill(); } catch (_) {}
  }

  // Persist new cwd
  const p = persistedSessions.get(id);
  if (p) {
    p.cwd = resolvedCwd;
  } else {
    persistedSessions.set(id, { id, cwd: resolvedCwd, createdAt: new Date() });
  }
  savePersistedSessions();

  // Start fresh claude in the new directory
  try {
    createSession(id, resolvedCwd);
    console.log(`[webcc] Session ${id} relocated → ${resolvedCwd}`);
    res.json({ ok: true, cwd: resolvedCwd });
  } catch (err) {
    console.error('[webcc] Relocate failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── File Browser API ──
app.get('/api/files', (req, res) => {
  let dirPath = (req.query.path || '').trim();
  const sessionId = (req.query.session || '').trim();

  if (!dirPath && sessionId) {
    const active = sessions.get(sessionId);
    const persisted = persistedSessions.get(sessionId);
    dirPath = active?.cwd || persisted?.cwd || os.homedir();
  } else if (!dirPath) {
    dirPath = os.homedir();
  }

  if (dirPath === '~') dirPath = os.homedir();
  else if (dirPath.startsWith('~/') || dirPath.startsWith('~\\')) {
    dirPath = path.join(os.homedir(), dirPath.slice(2));
  }
  dirPath = path.resolve(dirPath);

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries
      .map(e => {
        const fullPath = path.join(dirPath, e.name);
        const isDir = e.isDirectory();
        let size = null;
        if (!isDir) {
          try { size = fs.statSync(fullPath).size; } catch (_) {}
        }
        return { name: e.name, isDir, path: fullPath, size };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const parent = dirPath !== path.parse(dirPath).root ? path.dirname(dirPath) : null;
    res.json({ path: dirPath, parent, files });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/download', (req, res) => {
  const filePath = (req.query.path || '').trim();
  const inline = req.query.inline === '1';
  if (!filePath) return res.status(400).json({ error: 'path required' });
  const resolved = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return res.status(400).json({ error: '不能下载目录' });
    if (inline) {
      res.sendFile(resolved);
    } else {
      res.download(resolved);
    }
  } catch (e) {
    res.status(404).json({ error: '文件不存在' });
  }
});

// ── Voice Refine Worker (global, starts with server) ──
const VOICE_EXAMPLES_FILE = path.join(__dirname, 'voice_examples.json');

function loadVoiceExamples() {
  try {
    if (fs.existsSync(VOICE_EXAMPLES_FILE)) {
      const data = JSON.parse(fs.readFileSync(VOICE_EXAMPLES_FILE, 'utf8'));
      return Array.isArray(data) ? data.slice(-5) : [];
    }
  } catch (_) {}
  return [];
}

function appendVoiceExample(entry) {
  let data = [];
  try {
    if (fs.existsSync(VOICE_EXAMPLES_FILE)) {
      data = JSON.parse(fs.readFileSync(VOICE_EXAMPLES_FILE, 'utf8'));
      if (!Array.isArray(data)) data = [];
    }
  } catch (_) {}
  data.push(entry);
  if (data.length > 50) data = data.slice(-50);
  try {
    fs.writeFileSync(VOICE_EXAMPLES_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[webcc] Failed to write voice_examples.json:', e.message);
  }
}

// Build a clean env for voice subprocess (no CLAUDECODE to avoid nested session error)
const voiceChildEnv = { ...process.env };
delete voiceChildEnv.CLAUDECODE;

/**
 * Global voice worker: processes refine requests sequentially via a queue.
 * Only one `claude -p` process runs at a time. The process is NOT killed
 * when the HTTP client disconnects — output is buffered and delivered.
 */
const voiceWorker = {
  queue: [],       // { prompt, onChunk(text), onDone(), onError(msg) }
  busy: false,
  currentChild: null,

  enqueue(job) {
    this.queue.push(job);
    console.log(`[webcc/voice] Queued job (queue length: ${this.queue.length})`);
    this._processNext();
  },

  _processNext() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const job = this.queue.shift();

    // Use stdin to pass prompt (avoids ARG_MAX issues with long prompts)
    const child = spawn(CLAUDE_CMD, ['-p'], {
      env: voiceChildEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.currentChild = child;
    console.log(`[webcc/voice] Worker spawned claude pid=${child.pid}`);
    // Feed prompt via stdin, then close stdin to signal end-of-input
    child.stdin.write(job.prompt);
    child.stdin.end();

    // 60-second timeout
    const killTimer = setTimeout(() => {
      console.error('[webcc/voice] Worker timeout: killing claude process');
      try { child.kill(); } catch (_) {}
      job.onChunk('[超时：AI处理超过60秒，已中止]');
    }, 60000);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      console.log(`[webcc/voice] stdout chunk: ${text.slice(0, 80)}`);
      job.onChunk(text);
    });

    child.stderr.on('data', (chunk) => {
      console.error('[webcc/voice] stderr:', chunk.toString());
    });

    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      console.log(`[webcc/voice] Worker claude exited code=${code} signal=${signal}`);
      this.currentChild = null;
      this.busy = false;
      job.onDone();
      // Process next job in queue
      this._processNext();
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      console.error('[webcc/voice] Worker spawn error:', err.message);
      this.currentChild = null;
      this.busy = false;
      job.onError(err.message);
      this._processNext();
    });
  },
};

console.log('[webcc/voice] Voice worker initialized (queue-based, sequential processing)');

app.post('/api/voice/refine', (req, res) => {
  const reqId = `vr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const raw = (req.body.raw || '').trim();
  console.log(`[webcc/voice][${reqId}] POST /api/voice/refine received, raw length: ${raw.length}, raw: ${JSON.stringify(raw.slice(0, 100))}`);

  if (!raw) {
    console.log(`[webcc/voice][${reqId}] Empty raw, sending immediate [DONE]`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  const examples = loadVoiceExamples();
  let examplesStr = '';
  if (examples.length > 0) {
    examplesStr = '\n\n历史优化案例（供参考）：\n' + examples.map((ex, i) =>
      `[案例${i + 1}] 原始：${ex.raw}\n优化后：${ex.userFinal}`
    ).join('\n');
  }

  const prompt = `你是程序员语音输入助手。原始语音识别文字可能口语化、夹杂中英文。
任务：
1. 保留所有英文技术词汇/命令/API名（React, useState, git commit等）
2. 将口语转为专业简洁的程序员描述
3. 整理成清晰可操作的需求
4. 忠实原意，不臆造功能${examplesStr}

原始语音：${raw}
直接输出优化后的文本，不要任何解释或前缀。`;

  console.log(`[webcc/voice][${reqId}] Prompt length: ${prompt.length} chars`);
  console.log(`[webcc/voice][${reqId}] Setting SSE response headers...`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable proxy buffering
  res.flushHeaders();
  console.log(`[webcc/voice][${reqId}] SSE headers flushed`);
  // Disable Nagle's algorithm so small SSE chunks are sent immediately (important for TLS/HTTPS)
  if (res.socket) {
    res.socket.setNoDelay(true);
    console.log(`[webcc/voice][${reqId}] Socket NoDelay set`);
  }

  // Send SSE comment heartbeats every 5s to prevent browser/proxy idle disconnects
  const heartbeat = setInterval(() => {
    if (!clientDisconnected) {
      try { res.write(': heartbeat\n\n'); } catch (_) {}
    }
  }, 5000);

  let clientDisconnected = false;
  res.on('close', () => {
    clientDisconnected = true;
    clearInterval(heartbeat);
    console.log(`[webcc/voice][${reqId}] Client disconnected (res close event)`);
  });

  // Helper: write SSE event and force flush (important for TLS/HTTPS)
  function sseWrite(chunk) {
    if (clientDisconnected) {
      console.warn(`[webcc/voice][${reqId}] sseWrite skipped (client disconnected), chunk: ${JSON.stringify(chunk.slice(0, 100))}`);
      return;
    }
    try {
      const writeResult = res.write(chunk);
      console.log(`[webcc/voice][${reqId}] res.write returned: ${writeResult}, chunk: ${JSON.stringify(chunk.slice(0, 120))}`);
      // Force flush the underlying socket for TLS connections
      if (res.socket && typeof res.socket.uncork === 'function') {
        res.socket.cork();
        res.socket.uncork();
      }
    } catch (writeErr) {
      console.error(`[webcc/voice][${reqId}] sseWrite error:`, writeErr.message);
    }
  }

  console.log(`[webcc/voice][${reqId}] Enqueueing job to voiceWorker (busy=${voiceWorker.busy}, queue=${voiceWorker.queue.length})`);

  voiceWorker.enqueue({
    prompt,
    onChunk(text) {
      console.log(`[webcc/voice][${reqId}] onChunk called, text length: ${text.length}, text: ${JSON.stringify(text.slice(0, 100))}`);
      const sseData = `data: ${JSON.stringify({ text })}\n\n`;
      console.log(`[webcc/voice][${reqId}] SSE data to send: ${JSON.stringify(sseData.slice(0, 150))}`);
      sseWrite(sseData);
    },
    onDone() {
      clearInterval(heartbeat);
      console.log(`[webcc/voice][${reqId}] onDone called, clientDisconnected=${clientDisconnected}`);
      if (!clientDisconnected) {
        try {
          const writeResult = res.write('data: [DONE]\n\n');
          console.log(`[webcc/voice][${reqId}] [DONE] write result: ${writeResult}`);
          res.end();
          console.log(`[webcc/voice][${reqId}] res.end() called successfully`);
        } catch (endErr) {
          console.error(`[webcc/voice][${reqId}] Error writing [DONE] or ending response:`, endErr.message);
        }
      } else {
        console.log(`[webcc/voice][${reqId}] Skipping [DONE] (client already disconnected)`);
      }
    },
    onError(msg) {
      clearInterval(heartbeat);
      console.error(`[webcc/voice][${reqId}] onError called: ${msg}, clientDisconnected=${clientDisconnected}`);
      if (!clientDisconnected) {
        try {
          res.write(`data: ${JSON.stringify({ text: `[错误: ${msg}]` })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (errWriteErr) {
          console.error(`[webcc/voice][${reqId}] Error writing error response:`, errWriteErr.message);
        }
      }
    },
  });
});

app.post('/api/voice/feedback', (req, res) => {
  const { raw, refined, userFinal } = req.body;
  if (raw && refined !== undefined && userFinal !== undefined && userFinal !== refined) {
    appendVoiceExample({ raw, refined, userFinal, ts: new Date().toISOString() });
  }
  res.json({ ok: true });
});

// SSE test endpoint (for debugging voice streaming issues)
app.get('/api/voice/test-sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);

  let i = 0;
  const iv = setInterval(() => {
    res.write(`data: ${JSON.stringify({ text: `SSE test chunk ${++i}` })}\n\n`);
    if (i >= 3) {
      clearInterval(iv);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }, 500);
  req.on('close', () => clearInterval(iv));
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ── WebSocket connections ──
wss.on('connection', (ws, req) => {
  const urlObj = new URL(req.url, 'http://localhost');
  let sessionId = urlObj.searchParams.get('id') || '';
  let session;

  if (sessionId && sessions.has(sessionId)) {
    session = sessions.get(sessionId);
    console.log(`[webcc] Client attached to session ${sessionId} (${session.clients.size + 1} total)`);
  } else {
    if (!sessionId) sessionId = generateId();
    const persisted = persistedSessions.get(sessionId);
    const cwd = persisted ? persisted.cwd : os.homedir();
    if (persisted) {
      console.log(`[webcc] Restoring session ${sessionId} (cwd: ${cwd})`);
    } else {
      console.log(`[webcc] Creating session ${sessionId}`);
    }
    try {
      session = createSession(sessionId, cwd);
    } catch (err) {
      const msg = `Failed to launch Claude Code: ${err.message}\r\n` +
        `Make sure "claude" is installed and available in PATH.\r\n` +
        `You can also set the CLAUDE_CMD environment variable.\r\n`;
      ws.send(JSON.stringify({ type: 'error', data: msg }));
      ws.close();
      return;
    }
  }

  session.clients.add(ws);

  // Tell client its session ID
  ws.send(JSON.stringify({ type: 'session_id', id: sessionId }));

  // Replay buffered output to reconnecting client
  if (session.buffer.length > 0) {
    ws.send(JSON.stringify({ type: 'output', data: session.buffer.join('') }));
  }

  // WebSocket messages → PTY input / resize
  let inputBuf = '';
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'input') {
        // Track cd commands to keep session.cwd up to date
        for (const ch of msg.data) {
          if (ch === '\r' || ch === '\n') {
            const line = inputBuf.trim();
            // Strip ANSI/VT escape sequences (e.g. bracketed-paste \x1b[200~…\x1b[201~)
            const cleanLine = line.replace(/\x1b(?:\[[0-9;?]*[A-Za-z~]|.)/g, '');
            const cdMatch = cleanLine.match(/^cd(?:\s+(.+))?$/);
            if (cdMatch) {
              const arg = (cdMatch[1] || '').trim().replace(/^["']|["']$/g, '');
              const newCwd = resolveCwd(session.cwd, arg);
              session.cwd = newCwd;
              const p = persistedSessions.get(session.id);
              if (p) {
                p.cwd = newCwd;
                savePersistedSessions();
              }
              console.log(`[webcc] Session ${session.id} cwd → ${newCwd}`);
            }
            inputBuf = '';
          } else if (ch === '\x03' || ch === '\x15') {
            // Ctrl+C or Ctrl+U clears the line
            inputBuf = '';
          } else if (ch === '\x7f' || ch === '\b') {
            inputBuf = inputBuf.slice(0, -1);
          } else if (ch >= ' ') {
            inputBuf += ch;
          }
        }
        session.ptyProcess.write(msg.data);
        session.lastActivity = new Date();
      } else if (msg.type === 'resize') {
        session.ptyProcess.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
      } else if (msg.type === 'upload') {
        const { tempId, name, mime, data } = msg;
        const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8);
        const safeName = `webcc_${Date.now()}.${ext}`;
        const tmpPath = path.join(os.tmpdir(), safeName);
        fs.writeFileSync(tmpPath, Buffer.from(data, 'base64'));
        console.log(`[webcc] Saved upload: ${tmpPath}`);
        ws.send(JSON.stringify({ type: 'file_saved', tempId, path: tmpPath, name }));
      }
    } catch (e) {
      console.error('[webcc] Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    session.clients.delete(ws);
    console.log(`[webcc] Client left session ${sessionId} (${session.clients.size} remaining)`);
  });

  ws.on('error', (err) => {
    console.error('[webcc] WebSocket error:', err.message);
    session.clients.delete(ws);
  });
});

server.listen(PORT, () => {
  const proto = useHttps ? 'https' : 'http';
  console.log(`\n  WebCC is running at ${proto}://localhost:${PORT}\n`);
  console.log(`  Sessions persist until manually closed or server restarts.\n`);
  console.log(`  Manage sessions at ${proto}://localhost:${PORT}/manage\n`);
  if (useHttps) {
    console.log(`  Note: First visit will show a security warning (self-signed cert).\n`);
    console.log(`  Click "Advanced" → "Proceed to localhost" to continue.\n`);
  }
});
