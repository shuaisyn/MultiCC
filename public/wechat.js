'use strict';

const hdrStatus   = document.getElementById('hdr-status');
const cfgMcpUrl   = document.getElementById('cfg-mcp-url');
const cfgChatName = document.getElementById('cfg-chat-name');
const cfgSession  = document.getElementById('cfg-session');
const cfgPoll     = document.getElementById('cfg-poll');
const cfgIdle     = document.getElementById('cfg-idle');
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const cfgStatus   = document.getElementById('cfg-status');
const chatLog     = document.getElementById('chat-log');
const msgInput    = document.getElementById('msg-input');
const sendTarget  = document.getElementById('send-target');

let evtSource = null;
let isRunning = false;

// ── Load config ──
async function loadConfig() {
  try {
    const res = await fetch('/api/wechat/config');
    const cfg = await res.json();
    cfgMcpUrl.value   = cfg.mcpUrl || '';
    cfgChatName.value = cfg.chatName || '';
    cfgPoll.value     = cfg.pollInterval || 3000;
    cfgIdle.value     = cfg.outputIdle || 5000;
    // Session will be set after loadSessions
    if (cfg.sessionId) cfgSession.dataset.pending = cfg.sessionId;
  } catch (_) {}
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const list = await res.json();
    const current = cfgSession.value || cfgSession.dataset.pending || '';
    cfgSession.innerHTML = '<option value="">-- 选择会话 --</option>';
    for (const s of list) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.id} — ${s.cwd || '?'}${s.active ? '' : ' (inactive)'}`;
      if (s.id === current) opt.selected = true;
      cfgSession.appendChild(opt);
    }
    delete cfgSession.dataset.pending;
  } catch (_) {}
}

async function saveConfig() {
  try {
    const res = await fetch('/api/wechat/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mcpUrl: cfgMcpUrl.value.trim(),
        chatName: cfgChatName.value.trim(),
        sessionId: cfgSession.value,
        pollInterval: parseInt(cfgPoll.value) || 3000,
        outputIdle: parseInt(cfgIdle.value) || 5000,
      }),
    });
    const data = await res.json();
    showStatus(data.ok ? '已保存' : '保存失败', data.ok);
  } catch (e) {
    showStatus(`保存失败: ${e.message}`, false);
  }
}

// ── Bridge control ──
async function startBridge() {
  btnStart.disabled = true;
  showStatus('启动中...', true);
  try {
    const res = await fetch('/api/wechat/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mcpUrl: cfgMcpUrl.value.trim(),
        chatName: cfgChatName.value.trim(),
        sessionId: cfgSession.value,
        pollInterval: parseInt(cfgPoll.value) || 3000,
        outputIdle: parseInt(cfgIdle.value) || 5000,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Start failed');
    setRunning(true);
    showStatus('桥接已启动', true);
    chatLog.innerHTML = '';
    connectSSE();
  } catch (e) {
    showStatus(`启动失败: ${e.message}`, false);
    btnStart.disabled = false;
  }
}

async function stopBridge() {
  try {
    await fetch('/api/wechat/stop', { method: 'POST' });
    setRunning(false);
    showStatus('桥接已停止', true);
    disconnectSSE();
  } catch (e) {
    showStatus(`停止失败: ${e.message}`, false);
  }
}

function setRunning(on) {
  isRunning = on;
  btnStart.disabled = on;
  btnStop.disabled = !on;
  hdrStatus.className = `hdr-status ${on ? 'on' : 'off'}`;
  hdrStatus.textContent = on ? 'Running' : 'Stopped';
}

function showStatus(text, ok) {
  cfgStatus.textContent = text;
  cfgStatus.className = `cfg-status ${ok ? 'ok' : 'err'}`;
  setTimeout(() => { cfgStatus.textContent = ''; }, 5000);
}

// ── SSE for live log ──
function connectSSE() {
  disconnectSSE();
  evtSource = new EventSource('/api/wechat/events');
  evtSource.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data);
      appendLog(entry);
    } catch (_) {}
  };
  evtSource.onerror = () => {
    // Reconnect after a delay
    disconnectSSE();
    if (isRunning) setTimeout(connectSSE, 3000);
  };
}

function disconnectSSE() {
  if (evtSource) { evtSource.close(); evtSource = null; }
}

// ── Log rendering ──
function appendLog(entry) {
  // Remove empty placeholder
  const empty = chatLog.querySelector('.log-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `log-entry type-${entry.type}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  const d = new Date(entry.ts);
  time.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;

  const prefix = document.createElement('span');
  prefix.className = 'log-prefix';
  const prefixMap = { in: 'WeChat >', out: 'Claude <', system: 'SYS', error: 'ERR' };
  prefix.textContent = (prefixMap[entry.type] || entry.type) + ' ';

  const text = document.createTextNode(entry.text);

  div.append(time, prefix, text);
  chatLog.appendChild(div);

  // Auto-scroll
  chatLog.scrollTop = chatLog.scrollHeight;

  // Limit DOM nodes
  while (chatLog.children.length > 500) chatLog.removeChild(chatLog.firstChild);
}

// ── Manual send ──
async function sendMsg() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';

  const target = sendTarget.value;
  try {
    const res = await fetch('/api/wechat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target }),
    });
    if (!res.ok) {
      const data = await res.json();
      showStatus(data.error || '发送失败', false);
    }
  } catch (e) {
    showStatus(`发送失败: ${e.message}`, false);
  }
}

msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendMsg(); }
});

// ── Mobile config toggle ──
function toggleConfig() {
  document.getElementById('config-panel').classList.toggle('open');
}

// ── Check running state on load ──
async function checkStatus() {
  try {
    const res = await fetch('/api/wechat/status');
    const data = await res.json();
    setRunning(data.running);
    if (data.running) {
      connectSSE();
      // Load existing log
      const logRes = await fetch('/api/wechat/log');
      const log = await logRes.json();
      chatLog.innerHTML = '';
      for (const entry of log) appendLog(entry);
    }
  } catch (_) {}
}

// ── Init ──
loadConfig().then(() => loadSessions());
checkStatus();
