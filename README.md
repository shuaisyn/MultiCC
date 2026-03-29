<p align="center">
  <img src="public/icon.svg" width="120" height="120" alt="WebCC Logo" />
</p>

<h1 align="center">WebCC</h1>

<p align="center">
  <strong>Run Claude Code in your browser. From any device.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#api-reference">API Reference</a> &bull;
  <a href="#faq">FAQ</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >=18" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/version-1.0.0-orange" alt="Version" />
</p>

---

## What is WebCC?

**WebCC** (Web Claude Code) turns your local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI into a full-featured, browser-based terminal that you can access from **any device** on your network — your phone, tablet, another laptop, or even from WeChat.

Unlike traditional SSH or web terminal tools, WebCC is purpose-built for Claude Code workflows:

- **Voice Input** — dictate commands and let AI refine your speech into precise technical language
- **Multi-Session Dashboard** — monitor and manage multiple Claude Code sessions from a single page
- **Smart Notifications** — get voice alerts and push notifications when Claude finishes a task or needs your input
- **WeChat Bridge** — relay conversations between WeChat and Claude Code (ideal for mobile-first workflows in China)
- **PWA Support** — install as a native-like app on iOS and Android

```
┌─────────────────────────────────────────────────────────┐
│  Phone / Tablet / Laptop / WeChat                       │
│                    ▼                                     │
│         https://192.168.x.x:3443                        │
│                    ▼                                     │
│  ┌──────────── WebCC Server ────────────┐               │
│  │  Express + WebSocket + HTTPS         │               │
│  │       ▼              ▼               │               │
│  │   tmux session   tmux session        │               │
│  │   └─ claude      └─ claude           │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

---

## Features

### Terminal

| Feature | Description |
|---------|-------------|
| **Full xterm.js Terminal** | Complete terminal emulation with 256-color support, clickable URLs, 5000-line scrollback |
| **Multi-Session** | Run multiple independent Claude Code sessions simultaneously |
| **Session Persistence** | Sessions survive server restarts (backed by tmux); reconnect to pick up where you left off |
| **Auto-Reconnect** | Exponential-backoff reconnection with instant resume when switching back to the app |
| **Multi-Client** | Multiple browser tabs/devices can share the same session in real-time |
| **Custom Session ID** | Name your sessions (`?newid=my-project`) for easy identification |
| **Directory Picker** | Visual directory browser when creating new sessions |
| **Change Working Dir** | Switch a running session's working directory on the fly |

### Voice Input

| Feature | Description |
|---------|-------------|
| **Whisper STT** | Record audio in-browser, transcribe via Whisper API (Groq, OpenRouter, or any OpenAI-compatible endpoint) |
| **AI Refinement** | Raw transcription is streamed through an LLM to convert spoken language into precise technical commands |
| **Vocabulary Learning** | The system learns from your corrections — frequently corrected terms are fed back into Whisper prompts |
| **SSE Streaming** | AI refinement results stream in real-time with latency metrics (queue, first-token, total) |

### Notifications

| Feature | Description |
|---------|-------------|
| **Voice Alerts** | Browser speech synthesis announces "Task completed" or "Waiting for your action" |
| **Smart Trigger** | Notifications only fire when the page is in the background — no interruptions while you're looking at the terminal |
| **Pattern Detection** | Recognizes Claude's prompts: Y/n confirmations, Allow/Deny, numbered choices, idle prompts |
| **Push Notifications** | Web Push via VAPID — works even when the browser is closed |
| **Toast Overlay** | Visual toast notification with auto-dismiss; cancelled immediately when you return to the page |

### File Management

| Feature | Description |
|---------|-------------|
| **File Browser** | Slide-in panel to browse server-side files; click to insert paths into the terminal |
| **File Upload** | Drag-and-drop, paste from clipboard, or use the file picker — up to 25 MB per file |
| **File Download** | Download or preview files directly from the file browser (images, PDFs, code, audio, video) |
| **Attachment Chips** | Uploaded files appear as clickable chips; click to insert the server path |

### Dashboard (`/manage`)

| Feature | Description |
|---------|-------------|
| **Session Grid** | Visual cards for all sessions with status, cwd, connection count, last activity |
| **Inline Terminal** | Click a session card to open its terminal in an embedded iframe — no new tab needed |
| **Notification Monitor** | Per-session WebSocket monitoring with real-time "waiting" / "completed" badges |
| **Notification Log** | Bottom bar showing recent events with dismiss and click-to-focus |
| **Voice Settings** | Configure OpenRouter and Whisper API credentials, models, and vocabulary directly from the UI |
| **QR Code** | One-click QR code with your LAN IP and access token — scan from any phone to connect |

### Mobile

| Feature | Description |
|---------|-------------|
| **Responsive Layout** | Full-width terminal on mobile; sidebar hides when viewing a session |
| **Mobile Input Bar** | Special key buttons (Esc, Tab, Ctrl+C, Ctrl+D, arrows, Home, End) + text input field |
| **Keyboard Handling** | `visualViewport` resize tracking ensures the terminal shrinks when the soft keyboard appears |
| **PWA** | Installable as a home-screen app with standalone display mode |
| **iOS Safe Areas** | Proper `env(safe-area-inset-*)` padding for notched devices |

### WeChat Bridge (`/wechat`)

| Feature | Description |
|---------|-------------|
| **Bidirectional Relay** | Messages from a WeChat contact/group are forwarded to Claude; Claude's output is sent back to WeChat |
| **MCP Integration** | Connects to a `wechat-mcp` server via JSON-RPC 2.0 over HTTP |
| **Echo Filtering** | Hash-based deduplication prevents message loops |
| **Chat Commands** | `/help`, `/status`, `/sessions`, `/bind <id>` — control the bridge from within WeChat |
| **Live Chat Log** | SSE-powered real-time message stream in the browser UI |

### Security

| Feature | Description |
|---------|-------------|
| **Token Authentication** | Optional `ACCESS_TOKEN` protects all API and WebSocket endpoints |
| **Auto-Generated HTTPS** | Self-signed TLS certificate with SAN IPs, auto-renewed on IP change |
| **Localhost Bypass** | Local connections are always allowed without a token |
| **Static Asset Exemption** | JS/CSS/images served without auth to avoid breaking the page load |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **tmux** installed and available in PATH
- **Claude Code CLI** installed (`claude` command available)
- **openssl** (for auto-generated HTTPS certificates)

### Installation

```bash
# Clone the repository
git clone https://github.com/user/webcc.git
cd webcc

# Install dependencies
npm install

# (Optional) Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Start the Server

```bash
npm start
```

The server will:

1. Auto-detect your local IP addresses
2. Generate a self-signed TLS certificate (if needed)
3. Start listening on `https://localhost:3443`

```
  WebCC is running at https://localhost:3443

  Other devices can access via:
    https://192.168.1.100:3443

  Note: First visit will show a security warning (self-signed cert).
  Click "Advanced" -> "Proceed" / "Continue" to accept.
```

### Access from Other Devices

1. Open `https://<your-ip>:3443` on your phone/tablet
2. Accept the self-signed certificate warning
3. If `ACCESS_TOKEN` is set, append `?token=<your-token>` to the URL
4. Or use the QR code from the Dashboard (`/manage`) page

---

## Configuration

All configuration is done via environment variables in the `.env` file. The server hot-reloads voice settings when changed through the Dashboard UI.

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3443` (HTTPS) / `3000` (HTTP) | Server listen port |
| `ACCESS_TOKEN` | *(none)* | Access token for remote authentication. If unset, no auth required |
| `CLAUDE_CMD` | *(auto-detected)* | Override path to the `claude` binary |
| `CLAUDE_ARGS` | *(none)* | Extra CLI arguments passed to Claude (space-separated) |

### Voice Refinement (OpenRouter / LLM)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | *(none)* | API key for the LLM used to refine voice transcriptions |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` | LLM model name |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base URL |

### Voice STT (Whisper)

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_API_KEY` | *(falls back to `OPENROUTER_API_KEY`)* | API key for the Whisper STT service |
| `WHISPER_BASE_URL` | `https://openrouter.ai/api/v1` | Whisper-compatible API base URL (e.g., `https://api.groq.com/openai/v1`) |
| `WHISPER_MODEL` | `whisper-large-v3-turbo` | Whisper model name |
| `WHISPER_LANGUAGE` | `zh` | ISO 639-1 language code for transcription |
| `WHISPER_PROMPT` | *(none)* | Static vocabulary hints for Whisper (comma-separated technical terms) |

### Push Notifications (VAPID)

| Variable | Default | Description |
|----------|---------|-------------|
| `VAPID_PUBLIC_KEY` | *(auto-generated)* | VAPID public key for Web Push |
| `VAPID_PRIVATE_KEY` | *(auto-generated)* | VAPID private key for Web Push |

> VAPID keys are automatically generated on first run and persisted to `.env`. You typically do not need to set these manually.

---

## Architecture

```
webcc/
├── server.js              # Main server: Express, WebSocket, tmux, all API routes
├── wechat-bridge.js       # WeChat MCP bridge module
├── package.json
├── .env                   # Environment configuration
│
├── public/                # Static frontend files
│   ├── index.html         # Terminal page (main UI)
│   ├── client.js          # Terminal client logic
│   ├── manage.html        # Dashboard page
│   ├── manage.js          # Dashboard logic
│   ├── wechat.html        # WeChat bridge UI
│   ├── wechat.js          # WeChat bridge client logic
│   ├── pwa.js             # PWA registration & push subscription
│   ├── sw.js              # Service Worker (push notifications, caching)
│   ├── icon.svg           # App icon
│   ├── manifest.json      # Web App Manifest
│   └── qrcode.min.js      # QR code generation library
│
├── sessions.json          # Persisted session registry
├── voice_examples.json    # STT feedback history (up to 50 entries)
├── whisper_vocab.json     # Auto-learned vocabulary (up to 100 terms)
├── push_subscriptions.json# Web Push subscription store
├── wechat-config.json     # WeChat bridge configuration
├── cert.pem / key.pem     # Auto-generated TLS certificate
└── cert.pem.bak / key.pem.bak  # Certificate backups
```

### How It Works

```
Browser (xterm.js)
    │
    ├── WebSocket ──────► Express Server
    │                         │
    │                    tmux session
    │                    ┌─────────┐
    │                    │ claude   │  ← Claude Code CLI
    │                    └─────────┘
    │                         │
    │   pipe-pane + FIFO      │  output
    │◄────────────────────────┘
    │
    ├── POST /api/voice/stt ──► Whisper API (Groq/OpenRouter)
    │
    ├── POST /api/voice/refine ──► LLM API (OpenRouter) ──► SSE stream
    │
    └── WebSocket (manage.js) ──► per-session monitoring ──► Push notifications
```

**Key design decisions:**

- **tmux as session backend** — Claude Code sessions survive server restarts; `tmux pipe-pane` with named FIFOs provides reliable output capture without node-pty limitations
- **No database** — all state is in-memory `Map` objects backed by flat JSON files; simple, zero-dependency persistence
- **Two-layer notifications** — client-side `speechSynthesis` for foreground alerts, server-side Web Push for background/closed-browser notifications
- **Vocabulary learning loop** — user corrections flow from `/api/voice/feedback` → `voice_examples.json` → `whisper_vocab.json` → Whisper prompt → better future transcriptions

---

## API Reference

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Get session details |
| `DELETE` | `/api/sessions/:id` | Kill and delete a session |
| `POST` | `/api/sessions/:id/relocate` | Change session's working directory |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files?path=<dir>&session=<id>` | List directory contents |
| `GET` | `/api/download?path=<file>&inline=<bool>` | Download or preview a file |

### Voice

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/voice/stt` | Upload audio for Whisper transcription (multipart `file` field) |
| `POST` | `/api/voice/refine` | Stream AI-refined text via SSE (`{ raw }` JSON body) |
| `POST` | `/api/voice/feedback` | Submit correction feedback (`{ raw, refined, userFinal }`) |
| `GET` | `/api/voice/vocab` | Get learned vocabulary terms |
| `DELETE` | `/api/voice/vocab/:term` | Remove a vocabulary term |
| `GET` | `/api/voice/test-sse` | Debug: test SSE streaming |

### Voice Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings/voice` | Get current voice/STT configuration |
| `POST` | `/api/settings/voice` | Update voice/STT configuration |

### Push Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/push/vapid-key` | Get VAPID public key |
| `POST` | `/api/push/subscribe` | Register push subscription |
| `DELETE` | `/api/push/subscribe` | Remove push subscription |

### WeChat Bridge

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/wechat/status` | Bridge running state |
| `GET` | `/api/wechat/config` | Get bridge configuration |
| `POST` | `/api/wechat/config` | Update bridge configuration |
| `POST` | `/api/wechat/start` | Start the bridge |
| `POST` | `/api/wechat/stop` | Stop the bridge |
| `POST` | `/api/wechat/send` | Send message to PTY or WeChat (`{ text, target }`) |
| `GET` | `/api/wechat/log` | Get message log (supports `?since=<ms>`) |
| `GET` | `/api/wechat/events` | SSE stream of live log entries |

### Server Info

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/server-info` | Get server IP, port, protocol, URL, and token |

### WebSocket Protocol

**Connect:** `ws[s]://host/?id=<sessionId>&token=<token>`

**Client -> Server:**

```jsonc
{ "type": "input",  "data": "ls -la\r" }          // Terminal input
{ "type": "resize", "cols": 120, "rows": 40 }      // Terminal resize
{ "type": "upload", "tempId": "up_xxx", "name": "file.txt", "mime": "text/plain", "data": "<base64>" }
```

**Server -> Client:**

```jsonc
{ "type": "session_id", "id": "a1b2c3d4" }         // Session assigned
{ "type": "output",     "data": "..." }             // Terminal output
{ "type": "exit",       "data": "..." }             // Session ended
{ "type": "relocate",   "cwd": "/new/path" }        // Directory changed
{ "type": "file_saved", "tempId": "up_xxx", "path": "/tmp/webcc_xxx.txt", "name": "file.txt" }
```

---

## Usage Guide

### Voice Input Workflow

1. Click the **microphone button** (or tap on mobile)
2. Speak your command in natural language (supports mixed Chinese/English)
3. Recording stops on second click; audio is uploaded for Whisper transcription
4. The **Voice Panel** opens showing:
   - **Raw text** — direct Whisper output (editable)
   - **AI-refined text** — streaming LLM-processed version (editable)
   - Timing info (queue, first-token, total latency)
5. Choose **Use Raw**, **Use AI Text**, or edit either field before sending
6. The chosen text is sent to the terminal; corrections are saved to improve future transcriptions

### Dashboard Multi-Session Management

1. Navigate to `/manage` (or `/manage?token=<token>`)
2. Click **+ New Session** to create sessions
3. Click any session card to view its terminal inline
4. Watch for notification badges:
   - **Yellow "等待操作"** — Claude is waiting for input (Y/n, Allow/Deny, etc.)
   - **Green "已完成"** — Claude has finished its task
5. Configure voice settings in the collapsible **Voice Settings** section at the bottom
6. Use the **QR** button to share access with your phone

### WeChat Bridge

1. Start a [`wechat-mcp`](https://github.com/user/wechat-mcp) server
2. Navigate to `/wechat` in WebCC
3. Configure:
   - **MCP URL**: Your wechat-mcp server address (default `http://localhost:8000/mcp`)
   - **Chat Name**: The WeChat contact or group name to monitor
   - **Session**: Which WebCC session to bind to
4. Click **Start** to begin relaying
5. In WeChat, send messages to the configured contact/group — they'll appear in Claude's terminal
6. Claude's responses will be sent back to WeChat automatically
7. Use `/help` in WeChat to see available commands

### Mobile Best Practices

- **Install as PWA**: Use "Add to Home Screen" in Safari/Chrome for a native app experience
- **Accept the certificate**: On first visit, you must accept the self-signed certificate
- **Use the mobile input bar**: Special keys (Esc, Tab, Ctrl+C, arrows) are available as buttons below the terminal
- **Voice input**: The microphone button works on mobile — ensure you grant microphone permission
- **Push notifications**: Enable via the Dashboard's "Push" button to get notified even when the app is closed

---

## Data Files

WebCC stores all persistent data as flat JSON files in the project root:

| File | Description | Max Size |
|------|-------------|----------|
| `sessions.json` | Session registry (`id`, `cwd`, `createdAt`) | Grows with sessions |
| `voice_examples.json` | STT correction history | 50 entries (FIFO) |
| `whisper_vocab.json` | Learned vocabulary terms | 100 terms (sorted by frequency) |
| `push_subscriptions.json` | Web Push subscription objects | Grows with subscribers |
| `wechat-config.json` | WeChat bridge configuration | Single object |
| `cert.pem` / `key.pem` | Auto-generated TLS certificate | Regenerated on IP change |

---

## Troubleshooting

### "Certificate warning" on first visit

This is expected. WebCC generates a self-signed certificate for HTTPS (required for microphone access and PWA). Click **Advanced** -> **Proceed** in your browser.

### Claude command not found

WebCC searches common install paths automatically. If it still can't find `claude`, set the `CLAUDE_CMD` environment variable:

```bash
echo 'CLAUDE_CMD=/path/to/claude' >> .env
```

### Voice input shows "此浏览器不支持录音"

`MediaRecorder` requires a **secure context** (HTTPS or localhost). Ensure you're accessing via `https://` and have accepted the certificate.

### "fetch failed" on voice STT

This usually means the server can't reach the Whisper API. Check:
1. `WHISPER_API_KEY` is set in `.env`
2. `WHISPER_BASE_URL` is correct (e.g., `https://api.groq.com/openai/v1` for Groq)
3. Your server has internet access

### Session shows "Disconnected" and won't reconnect

If using `ACCESS_TOKEN`, ensure the token is in your URL (`?token=<token>`). WebCC preserves the token across reconnections, but clearing the URL manually will lose it.

### tmux sessions pile up

WebCC names its tmux sessions `webcc-<id>`. To clean up orphaned sessions:

```bash
tmux list-sessions | grep webcc | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Server** | Node.js + Express |
| **Terminal Backend** | tmux + pipe-pane + named FIFO |
| **WebSocket** | ws |
| **Frontend Terminal** | xterm.js 5.3 (FitAddon, WebLinksAddon) |
| **Voice STT** | Whisper API (Groq / OpenRouter / OpenAI-compatible) |
| **Voice Refinement** | OpenRouter LLM (SSE streaming) |
| **Push Notifications** | Web Push (VAPID) via web-push |
| **WeChat Integration** | MCP (Model Context Protocol) over HTTP |
| **TLS** | Auto-generated self-signed certificates via openssl |
| **PWA** | Service Worker + Web App Manifest |

### Dependencies

```
express          ^4.18.2    HTTP server and routing
ws               ^8.16.0    WebSocket server
multer           ^1.4.5     Multipart file upload handling
web-push         ^3.6.7     VAPID push notifications
better-sqlite3   ^12.6.2    SQLite (available for future features)
```

> **Zero frontend build step** — all client code is vanilla JavaScript served as static files. No webpack, no bundler, no transpiler.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <sub>Built with Claude Code</sub>
</p>
