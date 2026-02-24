'use strict';

let autoRefreshTimer = null;

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelative(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const sessions = await res.json();
    renderSessions(sessions);
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

  const rows = sessions.map(s => `
    <tr>
      <td><span class="session-id">${s.id}</span></td>
      <td class="time-cell" title="${s.createdAt}">${formatTime(s.createdAt)}</td>
      <td class="time-cell" title="${s.lastActivity}">${formatRelative(s.lastActivity)}</td>
      <td>
        <span class="client-badge ${s.clients === 0 ? 'zero' : ''}">
          ${s.clients} connected
        </span>
      </td>
      <td>
        <div class="actions">
          <button class="btn" onclick="openSession('${s.id}')">Open</button>
          <button class="btn btn-danger" onclick="deleteSession('${s.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');

  el.innerHTML = `
    <table class="session-table">
      <thead>
        <tr>
          <th>Session ID</th>
          <th>Created</th>
          <th>Last Activity</th>
          <th>Clients</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function openSession(id) {
  window.open(`/?id=${id}`, '_blank');
}

async function deleteSession(id) {
  if (!confirm(`Delete session ${id}?\nThe PTY process will be terminated.`)) return;
  try {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      showToast(`Error: ${err.error}`, true);
      return;
    }
    showToast(`Session ${id} deleted`);
    loadSessions();
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

function newSession() {
  window.open('/', '_blank');
  // Refresh after a short delay so the new session appears
  setTimeout(loadSessions, 800);
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.background = isError ? '#f85149' : '#238636';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Initial load
loadSessions();

// Auto-refresh every 5 seconds
autoRefreshTimer = setInterval(loadSessions, 5000);
