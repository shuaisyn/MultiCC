'use strict';

let autoRefreshTimer = null;
let _cachedSessions = [];
let _focusedSessionId = null;
const _urlToken = new URLSearchParams(location.search).get('token');
function tokenQS(prefix) { return _urlToken ? `${prefix}token=${_urlToken}` : ''; }

/* ── Helpers ── */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelative(iso) {
  if (!iso) return 'N/A';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function shortenPath(p, maxLen) {
  if (!p) return '(unknown)';
  if (p.length <= maxLen) return p;
  return '...' + p.slice(-(maxLen - 3));
}

/* ── Notification monitoring via WebSocket ── */
const ANSI_RE = /\x1b(?:\[[0-9;?]*[a-zA-Z~]|\][^\x07]*(?:\x07|\x1b\\)|[()][AB012]|.)/g;
const WAITING_PATTERNS = [
  /\[Y\/n\]/, /\[y\/N\]/, /\(y\/n\)/i, /\(yes\/no\)/i,
  /Do you want to/i, /Press Enter/i, /Yes\s*\/\s*No/i,
  /Allow\s*(once|always)/i, /Allow\b/, /Approve\??/i, /Deny/i,
  /Run\s+command\??/i, /Do you want to proceed/i,
  /\bpermission\b/i, /\bconfirm\b/i,
  /[❯>]\s*$/, /\?\s*$/,
];
const NOTIFY_IDLE_MS = 6000;
const NOTIFY_MIN_CHARS = 80;

// Per-session monitor state: { ws, state, chars, recentText, idleTimer, connectedAt }
const monitors = new Map();
// Notification log entries: [{ id, sessionId, type, message, time }]
let notifications = [];
let notifIdCounter = 0;

function stripAnsi(str) {
  return str.replace(ANSI_RE, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function matchesWaiting(text) {
  for (const pat of WAITING_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

function startMonitor(sessionId) {
  if (monitors.has(sessionId)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const urlToken = new URLSearchParams(location.search).get('token');
  const tokenParam = urlToken ? `&token=${urlToken}` : '';
  const wsUrl = `${proto}//${location.host}/?id=${sessionId}${tokenParam}`;

  let ws;
  try { ws = new WebSocket(wsUrl); } catch (_) { return; }

  const mon = {
    ws,
    state: 'idle',
    chars: 0,
    recentText: '',
    idleTimer: null,
    connectedAt: 0,
  };
  monitors.set(sessionId, mon);

  ws.onopen = () => { mon.connectedAt = Date.now(); };

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'output') return;
      // Skip replay buffer (first 5s after connect)
      if (Date.now() - mon.connectedAt < 5000) return;

      const text = stripAnsi(msg.data);
      const printable = text.replace(/\s+/g, '');

      mon.recentText += text;
      if (mon.recentText.length > 3000) mon.recentText = mon.recentText.slice(-2000);

      if (printable.length > 0) {
        mon.chars += printable.length;
        if (mon.state === 'idle') mon.state = 'active';
      }

      // Immediate pattern check
      if (mon.state === 'active' && matchesWaiting(text)) {
        mon.state = 'waiting';
        setCardNotify(sessionId, 'waiting');
        addNotification(sessionId, 'waiting', '等待操作');
      }

      // Idle timer
      if (mon.idleTimer) clearTimeout(mon.idleTimer);
      mon.idleTimer = setTimeout(() => {
        if (mon.state === 'active' && mon.chars >= NOTIFY_MIN_CHARS) {
          const tail = mon.recentText.slice(-2000);
          if (matchesWaiting(tail)) {
            setCardNotify(sessionId, 'waiting');
            addNotification(sessionId, 'waiting', '等待操作');
          } else {
            setCardNotify(sessionId, 'completed');
            addNotification(sessionId, 'completed', '任务已完成');
          }
        }
        mon.state = 'idle';
        mon.chars = 0;
        mon.recentText = '';
      }, NOTIFY_IDLE_MS);
    } catch (_) {}
  };

  ws.onclose = () => {
    if (mon.idleTimer) clearTimeout(mon.idleTimer);
    monitors.delete(sessionId);
  };
  ws.onerror = () => {};
}

function stopMonitor(sessionId) {
  const mon = monitors.get(sessionId);
  if (!mon) return;
  if (mon.idleTimer) clearTimeout(mon.idleTimer);
  try { mon.ws.close(); } catch (_) {}
  monitors.delete(sessionId);
}

function syncMonitors(sessions) {
  const activeIds = new Set(sessions.filter(s => s.active).map(s => s.id));
  // Start monitors for new active sessions
  for (const id of activeIds) {
    if (!monitors.has(id)) startMonitor(id);
  }
  // Stop monitors for sessions that are no longer active
  for (const id of monitors.keys()) {
    if (!activeIds.has(id)) stopMonitor(id);
  }
}

/* ── Card notification badges ── */
function setCardNotify(sessionId, type) {
  const badge = document.querySelector(`.session-card[data-id="${sessionId}"] .notify-badge`);
  if (!badge) return;
  badge.className = 'notify-badge ' + type;
  badge.textContent = type === 'waiting' ? '等待操作' : '已完成';
}

function clearCardNotify(sessionId) {
  const badge = document.querySelector(`.session-card[data-id="${sessionId}"] .notify-badge`);
  if (badge) badge.className = 'notify-badge';
}

/* ── Notification log bar ── */
const notifyBar = document.getElementById('notify-bar');

function addNotification(sessionId, type, message) {
  const entry = {
    id: ++notifIdCounter,
    sessionId,
    type,
    message,
    time: new Date(),
  };
  notifications.push(entry);
  if (notifications.length > 50) notifications = notifications.slice(-50);
  renderNotifyBar();

  // Voice notification
  if (window.speechSynthesis) {
    const text = `Session ${sessionId}: ${message}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.1;
    utterance.volume = 0.8;
    window.speechSynthesis.speak(utterance);
  }
}

function dismissNotification(nid) {
  notifications = notifications.filter(n => n.id !== nid);
  renderNotifyBar();
}

function renderNotifyBar() {
  if (notifications.length === 0) {
    notifyBar.innerHTML = '';
    notifyBar.classList.remove('has-items');
    return;
  }
  notifyBar.classList.add('has-items');
  // Show most recent first, max 10
  const recent = notifications.slice(-10).reverse();
  notifyBar.innerHTML = recent.map(n => `
    <div class="notify-item" onclick="focusSession('${escapeHtml(n.sessionId)}')">
      <span class="ni-dot ${n.type}"></span>
      <span class="ni-id">#${escapeHtml(n.sessionId)}</span>
      <span class="ni-msg">${escapeHtml(n.message)}</span>
      <span class="ni-time">${formatTime(n.time.toISOString())}</span>
      <span class="ni-dismiss" onclick="event.stopPropagation(); dismissNotification(${n.id})" title="Dismiss">✕</span>
    </div>
  `).join('');
  notifyBar.scrollTop = 0;
}

/* ── Notify toggle button ── */
const notifyToggle = document.getElementById('notify-toggle');
let _notifyBarVisible = true;
notifyToggle.addEventListener('click', () => {
  _notifyBarVisible = !_notifyBarVisible;
  notifyToggle.classList.toggle('active', _notifyBarVisible);
  if (!_notifyBarVisible) {
    notifyBar.style.display = 'none';
  } else {
    notifyBar.style.display = '';
    renderNotifyBar();
  }
});
notifyToggle.classList.add('active');

/* ── Session loading ── */
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions' + tokenQS('?'));
    const sessions = await res.json();
    _cachedSessions = sessions;
    renderSessions(sessions);
    syncMonitors(sessions);
  } catch (err) {
    console.error('Failed to load sessions:', err);
    document.getElementById('session-list').innerHTML =
      `<div class="empty-state"><p style="color:#f85149">Failed to load sessions: ${err.message}</p></div>`;
  }
}

function renderSessions(sessions) {
  const el = document.getElementById('session-list');

  if (sessions.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🖥️</div>
        <p>No active sessions</p>
        <button class="btn btn-green" onclick="newSession()">+ New Session</button>
      </div>`;
    return;
  }

  // Sort: active first, then by lastActivity desc
  sessions.sort((a, b) => {
    if (a.active !== b.active) return b.active ? 1 : -1;
    const aTime = a.lastActivity ? new Date(a.lastActivity) : new Date(0);
    const bTime = b.lastActivity ? new Date(b.lastActivity) : new Date(0);
    return bTime - aTime;
  });

  const isFocused = !!_focusedSessionId;
  const maxCwd = isFocused ? 24 : 36;

  const cards = sessions.map(s => {
    const shortCwd = shortenPath(s.cwd, maxCwd);
    const statusClass = s.active ? 'active' : 'inactive';
    const statusText = s.active ? 'Running' : 'Stopped';
    const lastAct = s.lastActivity ? formatRelative(s.lastActivity) : 'N/A';
    const created = formatTime(s.createdAt);
    const focusedClass = s.id === _focusedSessionId ? ' focused' : '';

    return `
      <div class="session-card${focusedClass}" data-id="${escapeHtml(s.id)}" onclick="focusSession('${escapeHtml(s.id)}')">
        <span class="notify-badge"></span>
        <div class="card-top">
          <span class="session-id">#${escapeHtml(s.id)}</span>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="card-body">
          <div class="card-field">
            <span class="field-label">cwd</span>
            <span class="field-value cwd-value" title="${escapeHtml(s.cwd || '')}">${escapeHtml(shortCwd)}</span>
          </div>
          <div class="card-field">
            <span class="field-label">Created</span>
            <span class="field-value">${escapeHtml(created)}</span>
          </div>
          ${isFocused ? '' : `<div class="card-field">
            <span class="field-label">Active</span>
            <span class="field-value">${escapeHtml(lastAct)}</span>
          </div>`}
        </div>
        <div class="card-footer">
          <span class="client-count"><span class="count-num">${s.clients}</span> conn</span>
          <button class="btn btn-sm" onclick="event.stopPropagation(); openSessionNewTab('${escapeHtml(s.id)}')">New Tab</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteSession('${escapeHtml(s.id)}')">Del</button>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `<div class="session-grid">${cards}</div>`;
}

/* ── Focus panel: embed terminal iframe ── */
const focusPanel   = document.getElementById('focus-panel');
const focusIframe  = document.getElementById('focus-iframe');
const focusId      = document.getElementById('focus-id');
const focusCwd     = document.getElementById('focus-cwd');
const focusNewtab  = document.getElementById('focus-newtab');
const focusCloseBtn = document.getElementById('focus-close');

function focusSession(id) {
  const s = _cachedSessions.find(s => s.id === id);
  if (!s) return;

  // Clear notification badge when focusing
  clearCardNotify(id);

  if (_focusedSessionId === id) return; // already focused
  _focusedSessionId = id;

  document.body.classList.add('has-focus');
  focusId.textContent = '#' + id;
  focusCwd.textContent = s.cwd || '';
  focusCwd.title = s.cwd || '';

  // Build iframe URL
  const urlToken = new URLSearchParams(location.search).get('token');
  const tokenParam = urlToken ? `&token=${urlToken}` : '';
  const iframeUrl = `/?id=${id}${tokenParam}`;
  focusIframe.src = iframeUrl;

  // Re-render cards to show focused state
  renderSessions(_cachedSessions);
}

function closeFocusPanel() {
  _focusedSessionId = null;
  document.body.classList.remove('has-focus');
  focusIframe.src = 'about:blank';
  renderSessions(_cachedSessions);
}

focusCloseBtn.addEventListener('click', closeFocusPanel);
focusNewtab.addEventListener('click', () => {
  if (_focusedSessionId) openSessionNewTab(_focusedSessionId);
});

function openSessionNewTab(id) {
  const urlToken = new URLSearchParams(location.search).get('token');
  const tokenParam = urlToken ? `?token=${urlToken}&id=${id}` : `?id=${id}`;
  window.open(`/${tokenParam}`, '_blank');
}

async function deleteSession(id) {
  if (!confirm(`Delete session ${id}?\nThe PTY process will be terminated.`)) return;
  try {
    const res = await fetch(`/api/sessions/${id}` + tokenQS('?'), { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      showToast(`Error: ${err.error}`, true);
      return;
    }
    showToast(`Session ${id} deleted`);
    if (_focusedSessionId === id) closeFocusPanel();
    loadSessions();
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

function newSession() {
  window.open('/', '_blank');
  setTimeout(loadSessions, 800);
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.background = isError ? '#f85149' : '#238636';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ── Keyboard shortcut: Esc to close focus panel ── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _focusedSessionId) closeFocusPanel();
});

/* ── Voice Settings ── */
async function loadVoiceSettings() {
  try {
    const res = await fetch('/api/settings/voice' + tokenQS('?'));
    const data = await res.json();
    document.getElementById('vs-base-url').value = data.baseUrl || '';
    document.getElementById('vs-api-key').value = '';
    document.getElementById('vs-api-key').placeholder = data.hasKey ? data.apiKey : 'sk-or-v1-...';
    document.getElementById('vs-model').value = data.model || '';
    document.getElementById('ws-base-url').value = data.whisperBaseUrl || '';
    document.getElementById('ws-api-key').value = '';
    document.getElementById('ws-api-key').placeholder = data.hasWhisperKey ? data.whisperApiKey : 'gsk_... (留空则复用 OpenRouter Key)';
    document.getElementById('ws-model').value = data.whisperModel || '';
    document.getElementById('ws-language').value = data.whisperLanguage || 'zh';
    document.getElementById('ws-prompt').value = data.whisperPrompt || '';
  } catch (_) {}
}

async function saveVoiceSettings() {
  const vsStatus = document.getElementById('vs-status');
  const wsStatus = document.getElementById('ws-status');
  const body = {};
  const baseUrl = document.getElementById('vs-base-url').value.trim();
  const apiKey = document.getElementById('vs-api-key').value.trim();
  const model = document.getElementById('vs-model').value.trim();
  if (baseUrl) body.baseUrl = baseUrl;
  if (apiKey) body.apiKey = apiKey;
  if (model) body.model = model;
  const wsBaseUrl = document.getElementById('ws-base-url').value.trim();
  const wsApiKey = document.getElementById('ws-api-key').value.trim();
  const wsModel = document.getElementById('ws-model').value.trim();
  if (wsBaseUrl) body.whisperBaseUrl = wsBaseUrl;
  if (wsApiKey) body.whisperApiKey = wsApiKey;
  if (wsModel) body.whisperModel = wsModel;
  const wsLanguage = document.getElementById('ws-language').value.trim();
  const wsPrompt = document.getElementById('ws-prompt').value.trim();
  body.whisperLanguage = wsLanguage;
  body.whisperPrompt = wsPrompt;

  if (Object.keys(body).length === 0) {
    vsStatus.textContent = 'No changes';
    vsStatus.className = 'status-text';
    wsStatus.textContent = 'No changes';
    wsStatus.className = 'status-text';
    return;
  }

  try {
    const res = await fetch('/api/settings/voice' + tokenQS('?'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    vsStatus.textContent = 'Saved';
    vsStatus.className = 'status-text ok';
    wsStatus.textContent = 'Saved';
    wsStatus.className = 'status-text ok';
    showToast('Voice settings saved');
    loadVoiceSettings();
  } catch (err) {
    vsStatus.textContent = `Failed: ${err.message}`;
    vsStatus.className = 'status-text err';
    wsStatus.textContent = `Failed: ${err.message}`;
    wsStatus.className = 'status-text err';
  }
}

/* ── QR Code ── */
async function showQR() {
  const modal = document.getElementById('qr-modal');
  const canvas = document.getElementById('qr-canvas');
  const urlText = document.getElementById('qr-url-text');

  let url;
  try {
    const res = await fetch('/api/server-info' + tokenQS('?'));
    const info = await res.json();
    const tokenQuery = info.token ? `?token=${info.token}` : '';
    url = info.url + '/manage' + tokenQuery;
  } catch (_) {
    // Fallback to current browser URL with token from current page
    const curToken = new URLSearchParams(location.search).get('token');
    const tokenQuery = curToken ? `?token=${curToken}` : '';
    url = window.location.origin + '/manage' + tokenQuery;
  }

  urlText.textContent = url;

  // qrcode-generator API
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();

  const cellSize = 6;
  const margin = 8;
  const count = qr.getModuleCount();
  const size = count * cellSize + margin * 2;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(margin + c * cellSize, margin + r * cellSize, cellSize, cellSize);
      }
    }
  }

  modal.classList.add('visible');
}

function hideQR(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('qr-modal').classList.remove('visible');
}

/* ── Init ── */
loadSessions();
loadVoiceSettings();
autoRefreshTimer = setInterval(loadSessions, 5000);
