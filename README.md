# Claude Code Telegram Plugin

Chat with your Claude Code agent from Telegram. Send text, voice messages, photos, documents, and links — the bot relays everything to Claude and pushes responses back to your chat.

## Features

- **Text, voice, photos, documents, links** — all media types forwarded to Claude
- **Voice transcription** — local whisper.cpp transcription (no external API)
- **URL content extraction** — YouTube, web pages, videos auto-transcribed
- **Channel push** — incoming Telegram messages appear as real-time notifications in Claude
- **Message history** — SQLite + FTS5 full-text search across all conversations
- **Multi-admin access control** — allowlist, pending, deny policies per user
- **Group chat support** — bot responds when addressed, silently ingests otherwise
- **Reactions** — emoji reactions forwarded to Claude as events
- **OAuth login relay** — `/login` command for headless Claude authentication via Telegram

## Quick Start

### 1. Install the marketplace (one-time)

```
/plugin marketplace add try-agent-os/agentos-marketplace
```

### 2. Install the plugin

```
/plugin install telegram
```

### 3. Configure

Claude Code will prompt you for:
- **Bot token** — get one from [@BotFather](https://t.me/BotFather) in Telegram
- **Admin user IDs** — your numeric Telegram user ID (get it from [@userinfobot](https://t.me/userinfobot))

### 4. Setup system dependencies

Run the setup command inside Claude Code:

```
/telegram:setup
```

This installs `ffmpeg`, `cmake`, and builds whisper.cpp for voice transcription.

### 5. Done

The Telegram MCP server starts automatically with every Claude Code session. Send a message to your bot — it appears as a channel notification in Claude.

## Standalone Mode (without Claude Code plugin)

You can also run the bot as a standalone MCP server with SSE transport:

```bash
git clone https://github.com/try-agent-os/claude-code-telegram-plugin
cd claude-code-telegram-plugin
npm install
cp .env.example .env
# Edit .env with your bot token and admin IDs
npm run build
npm start
```

The SSE endpoint will be available at `http://localhost:3848/sse`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token from @BotFather |
| `TELEGRAM_ADMIN_USER_IDS` | Yes | Comma-separated admin Telegram user IDs |
| `TELEGRAM_ADMIN_USERNAMES` | No | Comma-separated admin usernames (display only) |
| `TELEGRAM_MCP_MEDIA_DIR` | No | Media temp directory (default: `/tmp/telegram-mcp`) |
| `PORT` | No | SSE server port (default: `3848`, set `0` for stdio/plugin mode) |
| `MCP_TRANSPORT` | No | Set to `stdio` to force stdio mode |
| `WHISPER_MODEL` | No | Whisper model: `tiny`, `small`, `medium`, `large` (default: `medium`) |
| `WHISPER_SERVER_URL` | No | Optional whisper-server HTTP endpoint for faster transcription |
| `TELEGRAM_LOGIN_SCRIPT` | No | Path to login helper script for `/login` OAuth relay |

## MCP Tools

The plugin exposes these tools to Claude:

- `send_message` — send a message to a Telegram chat (with optional inline buttons)
- `reply` — reply to a specific message
- `edit_message` — edit a previously sent message
- `add_reaction` — add emoji reaction to a message
- `search_messages` — full-text search across message history
- `get_recent_messages` — fetch recent messages from a chat
- `list_chats` — list all known chats
- `list_users` — list all known users with access status
- `approve_user` / `deny_user` — manage user access
- `get_unanswered` — get messages that haven't been responded to

## Architecture

```
src/
  index.ts          — dual-mode entry: stdio (plugin) or SSE (standalone)
  bot.ts            — grammY bot setup, message handlers, media batching
  db.ts             — SQLite + FTS5 message store, user/access tables
  access.ts         — access control (allow/pending/deny per user)
  tools.ts          — MCP tool definitions and handlers
  types.ts          — shared TypeScript types
  login-flow.ts     — OAuth login relay state machine
  group-policy.ts   — group chat notification policy
  media-pipeline.ts — voice/video/URL transcription pipeline
  commands/         — bot commands (/help, /status, /tz, /login, /id)
```

## License

MIT
