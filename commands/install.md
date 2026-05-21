---
description: Install the Telegram MCP server on a local or remote server (skeleton — currently routes to /telegram:setup).
---

# /telegram:install

Install the Telegram MCP server on a local or remote server.

> **Status:** Skeleton for future implementation. For now, use `/telegram:setup` for local installation.

## Vision

This command will install and configure telegram-mcp as a persistent service on a target server — either locally or on a remote machine via SSH.

## Future steps

1. Ask the user where to install:
   - **Local** — install on the current machine
   - **Remote** — install on a remote server via SSH (user provides `host`, `user`, optional `port`)

2. For remote installs:
   - Verify SSH connectivity: `ssh <user>@<host> echo ok`
   - Check that `node` (>= 18) and `npm` are available on the remote
   - Copy the plugin source to the remote host
   - Run `npm install --production` and `npm run build` remotely
   - Set up systemd unit for the telegram-mcp service
   - Configure environment variables (bot token, admin IDs)

3. For local installs:
   - Same as `/telegram:setup` but also creates a systemd/launchd service for persistence

4. Verify the bot starts and responds to a test message.

## TODO

- [ ] Implement local install with systemd service creation
- [ ] Implement remote install via SSH
- [ ] Add health check after install
- [ ] Support Docker-based installs
