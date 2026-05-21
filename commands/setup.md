---
description: Install system dependencies (ffmpeg, cmake, whisper.cpp) and prepare the Telegram plugin for first use.
---

# /telegram:setup

Install system dependencies and prepare the Telegram plugin for first use.

## Steps

1. Check that `node` and `npm` are available.

2. Install system dependencies (if not present):
   - `ffmpeg` — required for voice message transcription (converts OGG to WAV)
   - `cmake` — required to build whisper.cpp for local voice transcription

   On Debian/Ubuntu:
   ```bash
   sudo apt-get update && sudo apt-get install -y ffmpeg cmake libopenblas-dev pkg-config
   ```

   On macOS:
   ```bash
   brew install ffmpeg cmake
   ```

3. Install npm dependencies into the plugin data directory:
   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}" && npm install --production
   ```

4. Build TypeScript:
   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}" && npm run build
   ```

5. Verify the bot token is configured:
   - If `${user_config.bot_token}` is empty, tell the user to:
     1. Open Telegram, find @BotFather
     2. Send `/newbot`, follow the wizard
     3. Copy the token
     4. Run `/plugin configure telegram` and paste the token

6. Verify admin user ID is set:
   - If `${user_config.admin_user_ids}` is empty, tell the user to:
     1. Open Telegram, find @userinfobot
     2. Send `/start` to get their numeric user ID
     3. Run `/plugin configure telegram` and paste their ID

7. Test the connection by starting the MCP server briefly and checking for a successful Telegram API response.

After setup, the plugin is ready. The MCP server starts automatically with each Claude Code session.
