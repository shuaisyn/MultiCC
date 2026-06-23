<p align="center">
  <img src="public/icon.svg" width="120" height="120" alt="MultiCC Logo" />
</p>

<h1 align="center">MultiCC</h1>

<p align="center">
  <strong>Many AI coding CLI sessions. Many clients. Any device.</strong>
</p>

<p align="center">
  <a href="#what-is-multicc">What it is</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#multi-provider-support">Providers</a> &bull;
  <a href="#session-orchestration">Orchestration</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#api-reference">API</a> &bull;
  <a href="#faq">FAQ</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >=18" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/flutter-Android%20%7C%20iOS-02569B" alt="Flutter app" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## What is MultiCC?

**MultiCC** started as "Multi-Client Claude Code" and is now a self-hosted control plane for AI coding CLIs. It lets you drive [Claude Code](https://docs.anthropic.com/en/docs/claude-code), OpenAI Codex CLI, and provider-routed sessions from a browser, a PWA, a native Flutter app (Android/iOS), or even a WeChat / Feishu / Lark chat — all at the same time, all against persistent local sessions.

It is designed around three observations:

1. **Coding-agent sessions should outlive the client.** You open a task on your laptop, walk away, and want to keep an eye on it from your phone. MultiCC runs terminal sessions in `tmux` and chat sessions as managed CLI turns, so disconnecting never kills progress.
2. **One UI can't serve every moment.** Sometimes you want a full terminal; sometimes a chat bubble is enough; sometimes you just want push notifications when an agent is waiting. MultiCC ships multiple front-ends against one backend.
3. **Multiple agents can work better than one.** A directory can have Claude, Codex, and custom-provider sessions side by side, each isolated in its own git worktree, with dispatch and merge/sync APIs for parallel work.
4. **Voice is the fastest input on a phone.** Dictate in Chinese or English, let Whisper transcribe, let an LLM rewrite it into a precise technical prompt. Corrections feed back into the vocabulary so the system gets sharper the more you use it.

```
        ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
        │ Desktop Web  │   │  Mobile PWA  │   │ Flutter App  │   │   WeChat     │
        │ (Terminal)   │   │    (Chat)    │   │ Android/iOS  │   │   Bridge     │
        └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
               │                  │                  │                  │
               ▼                  ▼                  ▼                  ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │                  MultiCC Server (Express + ws + HTTPS)               │
        │   ┌────────────────────────┐         ┌────────────────────────┐     │
        │   │  tmux session backend  │         │ CLI stream-json/json   │     │
        │   │  (terminal mode)       │         │ spawner (chat mode)    │     │
        │   └──────────┬─────────────┘         └──────────┬─────────────┘     │
        │              ▼                                   ▼                   │
        │     claude / codex CLI                  claude stream-json / codex  │
        │                                             exec --json              │
        └──────────────────────────────────────────────────────────────────────┘
```

---

## Features

### Multi-provider support

MultiCC can run multiple CLI backends in the same workspace, with each session choosing its own CLI and provider.

| CLI | Terminal mode | Chat mode | Provider routing |
|-----|---------------|-----------|------------------|
| **Claude Code** | `claude` inside `tmux`, optionally resumed by session id | `claude -p --output-format stream-json` with replayable event streaming | Default Claude login, or a per-session provider imported from `cc-switch` / stored in `providers.json` |
| **Codex** | `codex` / `codex resume <id>` inside `tmux` | `codex exec --json`, resumed after MultiCC captures the Codex session id | Default Codex login, or isolated per-provider `CODEX_HOME` under `~/.multicc/codex-homes` |

- Provider overrides are session-scoped: one session can use the official Claude subscription, another can use DeepSeek through `cc-switch`, and a third can run Codex without environment bleed-through.
- `/manage` exposes provider import, create/edit/delete, global defaults per CLI, and per-session provider selection.
- New sessions inherit the current default provider for their CLI, but any session can be reset to the local default login.

### Two modes against the same backend

| Mode | UI | Backend |
|------|----|---------|
| **Terminal** (`/`) | Full `xterm.js` — scrollback, colors, input, resize | `tmux` session, `pipe-pane` + named FIFO for reliable output capture |
| **Chat** (`/chat`) | Message bubbles with streaming tool cards | Claude Code `stream-json` or Codex `exec --json` — events are normalized and forwarded live over WebSocket; `AskUserQuestion` is disabled by default for Claude chat so headless sessions ask follow-up questions as normal text |

Both modes share the same session registry, auth layer, and notification pipeline.

### Session orchestration

- **Directory workspaces.** A registered directory owns a fleet of terminal/chat sessions across Claude and Codex.
- **Git worktree isolation.** Each normal session runs under `<repo>/.multicc-worktrees/<sessionId>` on branch `multicc/<sessionId>`, so parallel agents can edit safely.
- **Sync and merge workflow.** `POST /api/sessions/:id/sync` pulls the directory base branch into a session worktree; `POST /api/sessions/:id/merge` commits/merges the session branch back and best-effort syncs siblings.
- **Agent Commander.** New directories are seeded with an Agent Commander chat session that can coordinate specialized sibling sessions.
- **Cross-session dispatch.** Any chat session can emit `<<dispatch target="SESSION_ID">...</dispatch>>`; MultiCC sends the self-contained task to the target session and injects the result back into the dispatcher. The WeChat Gateway uses the same mechanism with an explicit confirmation step.
- **Passive inter-agent notes.** Sessions in the same directory can leave notes that are prepended to a target agent's next chat turn.

### Long-running and scheduled work

- **Wait/poll mechanism.** Agents can register poll waits (`pollCmd` or `pollUrl` plus `untilContains` / `untilRegex`) or callback waits. When the condition resolves, MultiCC injects the result into the session so work continues without a human nudge.
- **`run-detached` background tasks.** Long builds, deploys, tests, and file-watch waits can be launched from the server with `setsid`; completion registers a wait automatically and sends the exit code plus output tail back to the session.
- **Cron jobs.** Recurring tasks are stored in `scheduled_tasks.json`, use standard five-field cron expressions, and reuse their dedicated chat session across runs so context carries forward.
- **Per-session auto-triggers.** A chat session can be woken by post-turn, file-change, or schedule triggers, with cooldowns and manual test firing.
- **Progress-friendly defaults.** The system prompt steers agents away from fragile background shell jobs and toward `run-detached` or explicit waits for reliable continuation.

### Multi-client per session

- Multiple browser tabs / devices can attach to the same session and see output in sync.
- Reconnect is instant on foreground: a rolling replay buffer (last 500 stream events) backfills chat bubbles so you never see a half-empty conversation after the screen wakes up.
- Flutter app and web UI can talk to the same `chat` session concurrently.

### Flutter native app

- Rewrite of the old Capacitor webview client — now a real Flutter app with `xterm` terminal widget and a custom chat UI.
- **Multi-session sidebar** with swipe-to-close, unread badges, and per-session cwd.
- **Background notifications** via `flutter_local_notifications` + the server's Web Push/Bark pipeline.
- **In-app APK auto-update**: the app pings the server's `/multicc.apk` mtime and offers a one-tap update when a newer build is available.
- **Voice capture** using the `record` plugin with waveform.
- Distributed as a signed APK via `/manage` → APK button.

### Voice input

- **Whisper STT** through any OpenAI-compatible endpoint (Groq, OpenRouter, self-hosted).
- **AI refinement** streams raw text through an LLM (default: OpenRouter) and replaces filler/hallucinations with precise technical language — delivered over SSE with first-token and total-latency metrics.
- **Vocabulary learning loop.** Every time you accept a refined result (or edit it), the diff is stored in `voice_examples.json`; terms that keep appearing are promoted into `whisper_vocab.json` and fed back as the Whisper `prompt` parameter, so Whisper gets better at your project's jargon over time.

### Notifications

Five delivery channels, all triggered from the same "waiting / completed" detector:

| Channel | Reach | Typical use |
|---------|-------|-------------|
| **Web Push (VAPID)** | Any browser / PWA with push permission | Laptop in another room, phone in your pocket |
| **Bark** | iOS `Bark` app | Reliable iOS push without Apple certs |
| **Webhook** | Any HTTP endpoint | Pipe into Slack, Lark, n8n, Home Assistant |
| **In-app voice alert** | Browser `speechSynthesis` (foreground only) | Desk laptop — "task completed" speaks aloud |
| **Flutter local notification** | Android notification tray | Lock-screen alerts when the app is backgrounded |

Alerts fire only when the originating client is **not** looking at the session — no interruptions while you're actively reading output.

### Multi-session dashboard (`/manage`)

- Directory-level workspace view with counts for Claude/Codex terminal and chat sessions.
- Visual cards for every session (status, cwd/worktree, provider, merge state, client count, last activity).
- Click a card to open its terminal in an inline iframe — no new tabs.
- Per-session WebSocket monitors tag sessions as `idle` / `thinking` / `editing` / `running` / `waiting` in real time.
- Create Claude or Codex sessions, choose terminal/chat mode, set labels, role prompts, memory, models, auto-continue, and provider overrides.
- Manage git worktree flow: view ahead/behind/conflict state, sync from base, merge back to base, and push the directory base branch.
- Import providers from `cc-switch`, maintain local provider entries, set CLI defaults, and switch a session without restarting the server.
- Create, edit, disable, manually run, and delete recurring cron jobs.
- Inspect active waits and detached tasks from the same operational surface.
- One-click **QR code** with LAN IP + access token for phone onboarding.
- **Voice settings panel** (OpenRouter/Whisper keys, models, vocabulary) hot-reloaded without restart.
- **Notification settings** for Web Push subscribe/unsubscribe, Bark URL, Webhook URL.
- **APK download** button that serves the latest Flutter build.
- **phtunnel/花生壳 monitor** (optional) — a shell watchdog that restarts the Phtunnel DDNS app if the public URL goes unreachable.

### WeChat bridge (`/wechat`)

Two implementations share the same UI:

- **iLink bridge** (`wechat-ilink.js`) — current default. Uses the iLink WeChat API to relay messages; works with PC WeChat.
- **MCP bridge** (`wechat-bridge.js`) — legacy. Talks to a `wechat-mcp` server over JSON-RPC.

Features (both):

- Bidirectional relay between a WeChat contact/group and a MultiCC session.
- Hash-based deduplication to break echo loops.
- In-WeChat commands: `/help`, `/status`, `/sessions`, `/bind <id>`.
- Gateway mode can route work with confirmed `<<dispatch>>` handoff and return the target session's result to WeChat.
- Live SSE log stream in the browser UI.

### Feishu / Lark bridge

- Official Open Platform long-connection bridge via `@larksuiteoapi/node-sdk`, so local deployments can receive messages without a public callback URL.
- Dedicated `__feishu_gateway__` chat session, separate from the WeChat Gateway to avoid cross-talk.
- Supports Feishu China, Lark international, or a custom domain.
- `/manage` includes credential setup, gateway creation/reset/destroy, start/stop controls, manual send, and live logs.

### Security

- Optional `ACCESS_TOKEN` gates every API/WebSocket endpoint.
- `multicc_auth` HTTP-only cookie minted from the token for sticky browser sessions.
- Localhost connections bypass the token.
- Self-signed HTTPS certificate auto-generated with SAN entries for every local IP, auto-renewed when your IP changes (required for microphone + PWA).

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **tmux** (for terminal mode; chat mode does not need it)
- **Claude Code CLI** — `claude` on your PATH, already logged in
- **openssl** (HTTPS cert generation)
- **Flutter** 3.8+ (only if you want to build the native app yourself)

### Run the server

```bash
git clone https://github.com/lsjwzh/MultiCC.git
cd MultiCC
npm install
npm start
```

```
  MultiCC is running at https://localhost:3443

  Other devices:
    https://192.168.1.100:3443?token=<ACCESS_TOKEN>
```

First visit will show a cert warning — accept it once per device.

### Run as a background service (macOS)

```bash
./multicc install    # installs a launchd agent — auto-start on login, auto-restart on crash
./multicc status
./multicc log
./multicc restart
./multicc uninstall  # removes the launchd agent
```

The service writes logs to `logs/multicc.log` and `logs/multicc-error.log`.

### Build the Flutter app

```bash
cd app
flutter pub get
flutter build apk --release           # Android
flutter build ios --release --no-codesign   # iOS (needs Xcode + signing to install)
```

The release APK is copied to `public/multicc.apk` by the build; the `/manage` page serves it from there.

---

## Configuration

All configuration is environment-variable driven. Voice settings additionally hot-reload when edited via the dashboard UI.

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3443` (HTTPS) / `3000` (HTTP) | Listen port |
| `ACCESS_TOKEN` | *(none)* | Gate all endpoints; localhost always bypassed |
| `CLAUDE_CMD` | *(auto-detected)* | Override path to the `claude` binary |
| `CLAUDE_ARGS` | *(none)* | Extra CLI args passed to every spawned `claude` |
| `CLAUDE_CHAT_DISALLOWED_TOOLS` | `AskUserQuestion` | Comma-separated Claude tools disabled only in chat mode. Keep `AskUserQuestion` disabled unless you implement a custom ask bridge for headless chat. |
| `CODEX_CMD` | *(auto-detected)* | Override path to the `codex` binary |
| `CODEX_ARGS` | *(none)* | Extra CLI args passed to every spawned `codex` |

### Providers

Provider configuration is stored locally and can be managed from `/manage` or the provider APIs.

| File | Description |
|------|-------------|
| `providers.json` | MultiCC-owned provider store. Can import from `~/.cc-switch/cc-switch.db`, but edits here do not write back to `cc-switch`. |
| `provider-defaults.json` | Default provider id per CLI (`claude`, `codex`) for newly-created sessions. |
| `~/.multicc/codex-homes/<providerId>/` | Materialized `CODEX_HOME` per Codex provider, keeping auth/config isolated between sessions. |

### Voice — LLM refinement

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | *(none)* | API key for the refinement LLM |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` | Model name |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible base URL |

### Voice — Whisper STT

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_API_KEY` | *(falls back to `OPENROUTER_API_KEY`)* | API key |
| `WHISPER_BASE_URL` | `https://openrouter.ai/api/v1` | e.g. `https://api.groq.com/openai/v1` |
| `WHISPER_MODEL` | `whisper-large-v3-turbo` | Model name |
| `WHISPER_LANGUAGE` | `zh` | ISO 639-1 language hint |
| `WHISPER_PROMPT` | *(none)* | Static vocabulary hints (auto-learned terms merge with this) |

### Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | *(auto-generated)* | Web Push keys — written to `.env` on first run |
| `BARK_URL` | *(none)* | Bark push endpoint, e.g. `https://api.day.app/<your-key>` |
| `WEBHOOK_URL` | *(none)* | Generic webhook URL — receives JSON `{ title, body, type, sessionId, url }` |

---

## Architecture

```
multicc/
├── server.js                   # Main server — Express, ws, tmux, CLI spawner, voice, push
├── cron-tasks.js               # Recurring scheduled chat tasks
├── wechat-ilink.js             # WeChat bridge (iLink API — current default)
├── wechat-bridge.js            # WeChat bridge (legacy MCP variant)
├── feishu-bridge.js            # Feishu/Lark long-connection gateway bridge
├── multicc                     # Launchd service manager script
├── phtunnel-monitor.sh         # Optional DDNS watchdog
├── package.json
├── .env                        # Environment + VAPID keys
│
├── public/                     # Zero-build static frontend
│   ├── index.html / client.js  # Terminal mode UI
│   ├── chat.html   / chat.js   # Chat mode UI
│   ├── manage.html             # Multi-session dashboard
│   ├── wechat.html             # WeChat bridge UI
│   ├── pwa.js / sw.js          # PWA registration + push subscription + service worker
│   ├── manifest.json           # Web App Manifest
│   ├── icon.svg
│   └── multicc.apk             # Served by /multicc.apk (build output, gitignored)
│
├── app/                        # Flutter native client (Android + iOS)
│   ├── lib/
│   │   ├── main.dart
│   │   ├── providers/          # ChatProvider, SessionProvider
│   │   ├── screens/            # SetupScreen, ChatScreen, SessionListScreen
│   │   ├── services/           # ChatService, SettingsService, NotificationService, UpdateService
│   │   └── widgets/            # InputBar (voice + file picker), MessageBubble, ToolCard
│   ├── android/                # package com.multicc.multicc_app
│   └── ios/                    # bundle com.multicc.multiccApp
│
├── sessions.json               # Persisted session registry (gitignored)
├── directories.json            # Registered workspace directories (gitignored)
├── providers.json              # MultiCC-owned Claude/Codex provider store (gitignored)
├── provider-defaults.json      # Default provider per CLI (gitignored)
├── scheduled_tasks.json        # Cron job definitions (gitignored)
├── chat_history/               # Per-session chat transcripts (gitignored)
├── events/                     # Per-directory event logs (gitignored)
├── voice_examples.json         # STT correction history (50-entry FIFO)
├── whisper_vocab.json          # Auto-learned vocabulary (100-term LRU)
├── push_subscriptions.json     # Web Push subscription store
├── wechat-config.json          # WeChat bridge configuration
├── feishu-config.json          # Feishu/Lark bridge configuration
└── cert.pem / key.pem          # Auto-generated self-signed TLS cert
```

### How a message flows

**Terminal mode:**

```
browser keystroke → ws → tmux send-keys → claude → tmux pipe-pane → FIFO → ws → xterm render
```

**Chat mode:**

```
user message
  → ws → server.js (CLI provider abstraction)
  → claude stream-json or codex exec --json [resume/session id]
  → stdout JSON events
  → server buffers last 500 events for reconnect replay
  → fan-out to all attached clients (web + Flutter)
  → chat bubble render with live tool cards
```

**Key design decisions:**

- **tmux for terminal, raw spawn for chat.** Terminal needs persistent TTY-backed state and survives disconnects via tmux. Chat is turn-based, so the server spawns the selected CLI per user turn, relying on Claude `--resume` or Codex `exec resume` to keep conversational continuity.
- **Provider isolation per child process.** Claude provider overrides inject `ANTHROPIC_*` env vars only into that session's child process; Codex provider overrides materialize a separate `CODEX_HOME`.
- **Worktree-first concurrency.** Each session owns a branch and worktree; merge/sync APIs move changes between the session branch and the directory base branch instead of sharing one mutable checkout.
- **No database.** All state is in-memory `Map` objects persisted to flat JSON files.
- **Single auth layer.** `ACCESS_TOKEN` → HTTP-only `multicc_auth` cookie → applied uniformly to REST, WebSocket, and static file routes (with JS/CSS exemption for login-page rendering).
- **Vocabulary learning loop.** Corrections flow from `/api/voice/feedback` → `voice_examples.json` → frequency ranking → `whisper_vocab.json` → Whisper `prompt` param.
- **Reconnect-safe chat.** Every chat WS connect replays the buffered events before resuming live, so the client can rebuild its bubble state deterministically.
- **Reliable continuation primitives.** `wait`, `run-detached`, cron, and dispatch all re-enter a chat session through the same managed turn path, so long-running work and cross-session results don't disappear between turns.

---

## API Reference

### Directories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/directories` | List directories with session counts and Git push status |
| `POST` | `/api/directories` | Register a workspace directory and seed its default Agent Commander session |
| `PATCH` | `/api/directories/:id` | Rename / relocate a directory, or update its default role prompt |
| `DELETE` | `/api/directories/:id?force=1` | Delete a directory record, optionally removing owned sessions |
| `POST` | `/api/directories/:id/push` | Push the directory base branch to its configured remote |
| `GET` | `/api/directories/:id/sessions` | List sessions owned by one directory, including worktree and merge state |
| `POST` | `/api/directories/:id/sessions` | Create a Claude/Codex terminal or chat session (`{ cli, kind, label?, model?, provider? }`) |
| `GET` | `/api/directories/:id/workspace` | Live workspace board snapshot |
| `GET` / `PUT` | `/api/directories/:id/memo` | Read / write `<directory>/multicc.memo.md` |
| `POST` | `/api/directories/:id/memo/send` | Send memo text to a chat session in that directory |
| `GET` | `/api/directories/:id/events` | Directory event log for merges, dispatches, notes, provider changes, etc. |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:id` | Get session details |
| `PATCH` | `/api/sessions/:id` | Update label, model, role prompt, memory, streaming, auto-continue, or provider |
| `DELETE` | `/api/sessions/:id` | Kill and delete a session |
| `POST` | `/api/sessions/:id/relocate` | Change session's working directory |
| `POST` | `/api/sessions/:id/restart` | Restart a dead terminal session in place |
| `GET` | `/api/sessions/:id/merge-status` | Inspect worktree ahead/behind/conflict state |
| `POST` | `/api/sessions/:id/sync` | Merge the directory base branch into this session worktree |
| `POST` | `/api/sessions/:id/merge` | Merge this session branch back into the directory base branch |
| `POST` | `/api/sessions/:id/notes` | Leave a passive note for another agent in the same directory |
| `GET` | `/api/agent-resources/skills` | List installed Claude and Codex skills |
| `GET` | `/api/agent-resources/claude-sessions` | List Claude Code history sessions |
| `DELETE` | `/api/agent-resources/claude-sessions/:project/:id` | Delete one unlinked Claude history session |
| `DELETE` | `/api/agent-resources/claude-sessions?olderThanDays=N` | Delete unlinked Claude history older than N days |

### Providers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/providers?appType=claude|codex` | List providers with secrets masked, plus default provider ids |
| `POST` | `/api/providers/import` | Import / refresh providers from `cc-switch` |
| `POST` | `/api/providers` | Create a local provider (`{ appType, name, baseUrl?, authToken?, model?, settingsConfig? }`) |
| `PATCH` | `/api/providers/:appType/:id` | Update provider metadata or settings |
| `DELETE` | `/api/providers/:appType/:id` | Delete a local provider and clear matching defaults |
| `GET` / `PUT` | `/api/provider-defaults` | Read / set default provider per CLI |

### Orchestration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions/:id/wait` | Register a poll or callback wait that will inject results back into the chat session |
| `POST` | `/api/wait/:wid/resolve?token=<token>` | Resolve a callback wait from an external system |
| `GET` | `/api/sessions/:id/waits` | List waits for one session |
| `DELETE` | `/api/wait/:wid` | Cancel a wait |
| `POST` | `/api/sessions/:id/run-detached` | Launch a server-owned background command and auto-register completion polling |
| `GET` | `/api/sessions/:id/detached` | List detached tasks known to the server |
| `GET` | `/api/detached/:taskId` | Inspect one detached task status and log tail |
| `GET` | `/api/sessions/:id/triggers` | List post-turn, file-change, and schedule triggers for one session |
| `POST` | `/api/sessions/:id/triggers` | Add a trigger (`{ type, prompt?, cooldownMs?, paths?, cron? }`) |
| `PUT` | `/api/sessions/:id/triggers/:tid` | Update one trigger |
| `DELETE` | `/api/sessions/:id/triggers/:tid` | Delete one trigger |
| `POST` | `/api/sessions/:id/triggers/:tid/test` | Fire a trigger immediately for manual testing |

Example wait:

```bash
curl -s "$MULTICC_BASE_URL/api/sessions/$MULTICC_SESSION_ID/wait" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"poll","pollCmd":"test -f build.done && cat build.done","untilContains":"ok","intervalSec":15,"maxChecks":40}'
```

Example detached task:

```bash
curl -s "$MULTICC_BASE_URL/api/sessions/$MULTICC_SESSION_ID/run-detached" \
  -H 'Content-Type: application/json' \
  -d '{"command":"npm test","label":"test suite","intervalSec":10,"maxChecks":120}'
```

### Cron Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cron` | List scheduled tasks with next-run and last-run status |
| `POST` | `/api/cron` | Create a five-field cron task targeting a directory |
| `PATCH` | `/api/cron/:id` | Update schedule, prompt, target directory, CLI, or enabled state |
| `DELETE` | `/api/cron/:id` | Delete a scheduled task |
| `POST` | `/api/cron/:id/run` | Trigger one scheduled task immediately |

Example cron task:

```bash
curl -s "$MULTICC_BASE_URL/api/cron" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Daily review","dirPath":"'"$PWD"'","cli":"claude","cron":"0 9 * * *","prompt":"Review the repo status and summarize risks."}'
```

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files?path=<dir>&session=<id>` | List directory contents |
| `GET` | `/api/download?path=<file>&inline=<bool>` | Download or preview a file |

### Voice

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/voice/stt` | Multipart audio upload → Whisper transcription |
| `POST` | `/api/voice/refine` | `{ raw }` → SSE stream of refined text |
| `POST` | `/api/voice/feedback` | `{ raw, refined, userFinal }` → correction log |
| `GET` | `/api/voice/vocab` | Learned vocabulary terms |
| `DELETE` | `/api/voice/vocab/:term` | Remove a term |
| `GET` / `POST` | `/api/settings/voice` | Get / update voice configuration (hot-reload) |
| `GET` / `POST` | `/api/settings/power` | Read / update macOS lid-sleep prevention (macOS only; administrator authorization required) |

### Push / Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/push/vapid-key` | VAPID public key |
| `POST` / `DELETE` | `/api/push/subscribe` | Register / remove push subscription |
| `POST` | `/api/push/test` | Fire a test push to all subscribers |
| `POST` | `/api/bark/test` | Fire a test Bark push |
| `POST` | `/api/webhook/test` | Fire a test webhook |

### WeChat Bridge

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/wechat/status` | Bridge running state |
| `GET` / `POST` | `/api/wechat/config` | Get / update bridge config |
| `POST` | `/api/wechat/start` | Start bridge |
| `POST` | `/api/wechat/stop` | Stop bridge |
| `POST` | `/api/wechat/send` | Send message to PTY or WeChat (`{ text, target }`) |
| `GET` | `/api/wechat/log` | Message log (`?since=<ms>`) |
| `GET` | `/api/wechat/events` | SSE stream of live log entries |

### Feishu / Lark Bridge

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/feishu/status` | Bridge running state |
| `GET` / `POST` | `/api/feishu/config` | Get / update App ID, App Secret, and domain |
| `GET` / `PUT` / `DELETE` | `/api/feishu/gateway` | Read / create or switch / destroy the dedicated gateway session |
| `POST` | `/api/feishu/gateway/reset` | Clear gateway history and reset CLI session id |
| `POST` | `/api/feishu/start` | Start the long-connection bridge |
| `POST` | `/api/feishu/stop` | Stop the bridge |
| `POST` | `/api/feishu/send` | Send a message to the active Feishu/Lark chat |
| `GET` | `/api/feishu/log` | Message log |
| `GET` | `/api/feishu/events` | SSE stream of live log entries |

### Server Info & Update

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/server-info` | Server IP, port, protocol, URL, token |
| `GET` | `/multicc.apk` | Latest Flutter APK (served from `public/multicc.apk`) |

### WebSocket Protocol

**Terminal mode:** `ws[s]://host/?id=<sessionId>&token=<token>`

```jsonc
// Client -> Server
{ "type": "input",  "data": "ls -la\r" }
{ "type": "resize", "cols": 120, "rows": 40 }
{ "type": "upload", "tempId": "up_xxx", "name": "file.txt", "mime": "text/plain", "data": "<base64>" }

// Server -> Client
{ "type": "session_id", "id": "a1b2c3d4" }
{ "type": "output",     "data": "..." }
{ "type": "exit",       "data": "..." }
{ "type": "relocate",   "cwd": "/new/path" }
{ "type": "file_saved", "tempId": "up_xxx", "path": "/tmp/multicc_xxx.txt", "name": "file.txt" }
```

**Chat mode:** `ws[s]://host/chat?id=<sessionId>&token=<token>`

```jsonc
// Client -> Server
{ "type": "user_message", "text": "refactor server.js", "files": [...] }
{ "type": "cancel" }          // abort the in-flight turn
{ "type": "clear" }           // wipe history and start a fresh claude session

// Server -> Client
{ "type": "system",    "subtype": "init", "is_streaming": false, "session_id": "..." }   // only the server's own init carries is_streaming
{ "type": "stream_event", "event": { /* Claude stream-json event */ } }
{ "type": "turn_end",  "ok": true }
{ "type": "error",     "error": "..." }
```

---

## FAQ

### "Certificate warning" on first visit

Expected. MultiCC generates a self-signed cert for HTTPS (required for microphone + PWA). Click **Advanced** → **Proceed** once per device.

### Claude command not found

MultiCC searches common install paths on startup. If it still can't find `claude`, set the env var:

```bash
echo 'CLAUDE_CMD=/path/to/claude' >> .env
```

### Codex command not found

Codex sessions use the `codex` binary. MultiCC searches common Homebrew, local-bin, Cargo, and shell PATH locations. If needed:

```bash
echo 'CODEX_CMD=/path/to/codex' >> .env
```

### Which provider does a session use?

Each session records `cli` (`claude` or `codex`) and an optional `provider` id. If `provider` is empty, the session uses the local default login for that CLI. If set, only that session's spawned process receives the provider override, so sibling sessions can use different providers safely.

### "此浏览器不支持录音"

`MediaRecorder` requires a secure context. Make sure you're on `https://` (or `http://localhost`) and that you've accepted the certificate.

### Flutter app can't reach the server from my phone

- Check the phone is on the same LAN.
- Open `https://<your-ip>:3443` in the phone's browser first and accept the cert — the Flutter app piggybacks on the system trust store.
- Confirm `ACCESS_TOKEN` is set in the Flutter setup screen if the server has one.

### tmux sessions pile up

Terminal-mode sessions are named `multicc-<id>`. To clean up orphans:

```bash
tmux list-sessions | grep multicc | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
```

### I upgraded from WebCC and my app settings are gone

The rename changed persistence keys (`webcc_*` → `multicc_*`) and the Android/iOS package identifiers (`com.webcc.*` → `com.multicc.*`). Consequences:

- **Web UI:** you'll get logged out once, and notification/voice toggles reset to defaults.
- **Flutter app:** install it as a **new app** (old one stays side-by-side until you uninstall it). Setup screen will ask for host / token / session again.
- **launchd service:** `./webcc uninstall` first under the old checkout, then `./multicc install` under the new checkout — the `Label` changed from `com.webcc.server` to `com.multicc.server`.
- **Running tmux sessions** named `webcc-*` are orphaned; kill them with the command above (substituting `webcc`).

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Server** | Node.js + Express + ws |
| **Terminal backend** | tmux + pipe-pane + named FIFO |
| **Chat backend** | Claude Code `stream-json` / Codex `exec --json`, normalized over WebSocket |
| **Provider routing** | MultiCC `providers.json`, optional `cc-switch` import, per-session env / `CODEX_HOME` isolation |
| **Worktree orchestration** | Git worktrees + branches per session, merge/sync APIs |
| **Web frontend** | vanilla JS, xterm.js 5.3, zero build step |
| **Mobile app** | Flutter 3.8, `xterm`, `web_socket_channel`, `shared_preferences`, `flutter_local_notifications` |
| **Voice STT** | Whisper (Groq / OpenRouter / OpenAI-compatible) |
| **Voice refinement** | OpenRouter LLM over SSE |
| **Notifications** | Web Push (VAPID) + Bark + generic webhook |
| **Scheduler / waits** | Central cron tasks, per-session auto-triggers, and server-owned wait / detached-task injector |
| **WeChat** | iLink API (default) or MCP (legacy) |
| **TLS** | Auto-generated self-signed certs with SAN IPs |
| **Service manager** | macOS `launchd` via `./multicc install` |

### Runtime dependencies

```
express                 ^4.18.2        HTTP server and routing
ws                      ^8.16.0        WebSocket server
multer                  ^1.4.5-lts.1   Multipart file upload handling
web-push                ^3.6.7         VAPID push notifications
node-pty                ^1.0.0         PTY fallback (terminal recovery path)
better-sqlite3          ^12.6.2        Read-only `cc-switch` provider import
node-cron               ^4.2.1         Per-session schedule triggers
chokidar                ^5.0.0         File-change triggers
@larksuiteoapi/node-sdk ^1.67.0        Feishu/Lark long-connection bridge
```

> **Zero frontend build step.** All web client code is plain JavaScript served as static files.

---

## License

MIT. See [LICENSE](LICENSE).

---

<p align="center">
  <sub>Built for Claude Code, Codex, and provider-routed coding agents · https://github.com/lsjwzh/MultiCC</sub>
</p>
