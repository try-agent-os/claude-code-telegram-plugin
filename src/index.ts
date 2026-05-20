import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { initDb, seedAdmins, getUnansweredMessages, saveMessage } from './db.js';
import { createBot, onIncomingMessage, onReaction } from './bot.js';
import { getToolDefinitions, handleToolCall } from './tools.js';
import { getTimezone } from './access.js';
import type { Bot } from 'grammy';

const PORT = parseInt(process.env.PORT ?? '3848', 10);
const STDIO_MODE = PORT === 0 || process.env.MCP_TRANSPORT === 'stdio';

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason);
  console.error(`[unhandledRejection] ${msg}`);
});

const activeSessions = new Map<string, Server>();

function getLocalISO(tz: string): string {
  return getTimeMetadata(tz).local_date;
}

function getTimeMetadata(tz: string): {
  epoch: string;
  utc_date: string;
  local_date: string;
  local_human: string;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const p = (type: string) => parts.find(p => p.type === type)!.value;
  const gmtOffset = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = gmtOffset === 'GMT' ? '+00:00' : gmtOffset.replace('GMT', '');
  const local_date = `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}${offset}`;

  const humanParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZoneName: 'short',
  }).formatToParts(now);
  const hp = (type: string) => humanParts.find(p => p.type === type)?.value ?? '';
  const local_human = `${hp('weekday')} ${hp('year')}-${hp('month')}-${hp('day')} ${hp('hour')}:${hp('minute')} ${hp('timeZoneName')}`;

  return {
    epoch: String(Math.floor(now.getTime() / 1000)),
    utc_date: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    local_date,
    local_human,
  };
}

function createMcpServer(bot: Bot): Server {
  const server = new Server(
    { name: 'telegram', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        experimental: {
          'claude/channel': {},
        },
      },
    },
  );

  const toolDefs = getToolDefinitions();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefs.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(bot, name, args ?? {});
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  return server;
}

function setupChannelPush(bot: Bot, adminIds: number[]) {
  onIncomingMessage((event) => {
    const { userId, chatId, chatType, chatTitle, text, username, displayName, messageId, replyToMessageId, quotedText, mediaType, isForward, forwardFrom } = event;
    const from = username ? `@${username}` : displayName ?? 'Unknown';
    const replyInfo = replyToMessageId ? ` [reply to msg ${replyToMessageId}${quotedText ? ` quoted: "${quotedText.slice(0, 40)}"` : ''}]` : '';
    const typeInfo = mediaType ? ` [${mediaType}]` : '';
    const fwdInfo = isForward && forwardFrom ? ` [fwd from: ${forwardFrom}]` : '';
    const chatLabel = chatType === 'private' ? `chat ${chatId}` : `${chatType} ${chatId}${chatTitle ? ` "${chatTitle}"` : ''}`;
    console.error(`[Telegram] ${from}${typeInfo}${fwdInfo} (${chatLabel}, msg ${messageId}${replyInfo}):\n> ${text}`);

    let content = text;
    if (replyToMessageId) {
      const quoteSuffix = quotedText ? ` quoted="${quotedText.replace(/"/g, '\\"')}"` : '';
      content = `[reply to msg_id=${replyToMessageId}${quoteSuffix}] ${content}`;
    }
    if (isForward && forwardFrom) content = `[forwarded from ${forwardFrom}] ${content}`;
    if (chatType !== 'private') {
      content = `[${from}${chatTitle ? ` in "${chatTitle}"` : ''}] ${content}`;
    }

    const tz = getTimezone(userId);

    for (const [sid, server] of activeSessions) {
      server.notification({
        method: 'notifications/claude/channel',
        params: {
          content,
          meta: {
            chat_id: String(chatId),
            chat_type: chatType,
            chat_title: chatTitle ?? '',
            message_id: String(messageId),
            reply_to_message_id: replyToMessageId ? String(replyToMessageId) : '',
            quoted_text: quotedText ?? '',
            user: username ?? String(chatId),
            user_id: String(userId),
            media_type: mediaType ?? '',
            is_forward: isForward ? 'true' : 'false',
            forward_from: forwardFrom ?? '',
            ...getTimeMetadata(tz),
            timezone: tz,
          },
        },
      }).catch((err: Error) => {
        console.error(`[channel] Failed to push to session ${sid}: ${err.message}`);
      });
    }
  });

  onReaction((event) => {
    const { chatId, messageId, emoji, action, username, displayName } = event;
    const from = username ? `@${username}` : displayName ?? 'Unknown';
    console.error(`[Telegram] ${from} ${action === 'added' ? 'added' : 'removed'} reaction ${emoji} on msg ${messageId} in chat ${chatId}`);

    const content = `[reaction: ${emoji}] on message_id=${messageId}`;

    for (const [sid, server] of activeSessions) {
      server.notification({
        method: 'notifications/claude/channel',
        params: {
          content,
          meta: {
            chat_id: String(chatId),
            message_id: String(messageId),
            reaction: emoji,
            reaction_action: action,
            user: username ?? String(chatId),
            user_id: event.userId ? String(event.userId) : String(chatId),
            ...getTimeMetadata(event.userId ? getTimezone(event.userId) : getTimezone(chatId)),
            timezone: event.userId ? getTimezone(event.userId) : getTimezone(chatId),
          },
        },
      }).catch((err: Error) => {
        console.error(`[channel] Failed to push reaction to session ${sid}: ${err.message}`);
      });
    }
  });
}

function parseAdminIds(): number[] {
  const rawAdminIds = process.env.TELEGRAM_ADMIN_USER_IDS || process.env.TELEGRAM_USER_ID || '';
  return rawAdminIds
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function startStdio(bot: Bot, adminIds: number[]) {
  const server = createMcpServer(bot);
  const transport = new StdioServerTransport();
  const sessionId = 'stdio';

  activeSessions.set(sessionId, server);
  await server.connect(transport);
  console.error('[telegram-mcp] MCP server connected via stdio');

  // Replay missed messages
  setTimeout(() => {
    const missed = getUnansweredMessages(24);
    if (missed.length === 0) return;
    console.error(`[replay] replaying ${missed.length} unanswered message(s)`);
    for (const msg of missed) {
      const tz = getTimezone(msg.user_id ?? msg.chat_id);
      server.notification({
        method: 'notifications/claude/channel',
        params: {
          content: `[MISSED at ${msg.created_at} UTC] ${msg.text ?? ''}`,
          meta: {
            chat_id: String(msg.chat_id),
            chat_type: msg.chat_type ?? 'private',
            chat_title: msg.chat_title ?? '',
            message_id: String(msg.telegram_message_id),
            reply_to_message_id: msg.reply_to_message_id ? String(msg.reply_to_message_id) : '',
            quoted_text: '',
            user: msg.username ?? String(msg.chat_id),
            user_id: msg.user_id ? String(msg.user_id) : String(msg.chat_id),
            media_type: msg.media_type ?? '',
            is_forward: 'false',
            forward_from: '',
            missed: 'true',
            ...getTimeMetadata(tz),
            timezone: tz,
          },
        },
      }).catch((err: Error) => {
        console.error(`[replay] Failed to replay msg ${msg.id}: ${err.message}`);
      });
    }
  }, 3000);
}

async function startSSE(bot: Bot, adminIds: number[]) {
  const app = express();
  app.use(express.json());

  const transports = new Map<string, SSEServerTransport>();

  app.get('/sse', async (_req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);
    console.log(`[connect] session=${sessionId}`);

    transport.onclose = () => {
      console.log(`[disconnect] session=${sessionId}`);
      transports.delete(sessionId);
      activeSessions.delete(sessionId);
    };

    const server = createMcpServer(bot);
    activeSessions.set(sessionId, server);
    await server.connect(transport);

    setTimeout(() => {
      const missed = getUnansweredMessages(24);
      if (missed.length === 0) return;
      console.log(`[replay] session=${sessionId}: replaying ${missed.length} unanswered message(s)`);
      for (const msg of missed) {
        const tz = getTimezone(msg.user_id ?? msg.chat_id);
        server.notification({
          method: 'notifications/claude/channel',
          params: {
            content: `[MISSED at ${msg.created_at} UTC] ${msg.text ?? ''}`,
            meta: {
              chat_id: String(msg.chat_id),
              chat_type: msg.chat_type ?? 'private',
              chat_title: msg.chat_title ?? '',
              message_id: String(msg.telegram_message_id),
              reply_to_message_id: msg.reply_to_message_id ? String(msg.reply_to_message_id) : '',
              quoted_text: '',
              user: msg.username ?? String(msg.chat_id),
              user_id: msg.user_id ? String(msg.user_id) : String(msg.chat_id),
              media_type: msg.media_type ?? '',
              is_forward: 'false',
              forward_from: '',
              missed: 'true',
              ...getTimeMetadata(tz),
              timezone: tz,
            },
          },
        }).catch((err: Error) => {
          console.error(`[replay] Failed to replay msg ${msg.id}: ${err.message}`);
        });
      }
    }, 3000);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      sessions: transports.size,
      uptime: process.uptime(),
    });
  });

  app.post('/emergency', async (req, res) => {
    const token = process.env.EMERGENCY_NOTIFY_TOKEN;
    if (token && req.header('x-emergency-token') !== token) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const { source, severity, message, log, dedup_prefix } = (req.body ?? {}) as {
      source?: string; severity?: string; message?: string; log?: string; dedup_prefix?: string;
    };
    if (!message || typeof message !== 'string') {
      res.status(400).json({ ok: false, error: 'message required' });
      return;
    }
    if (adminIds.length === 0) {
      res.status(503).json({ ok: false, error: 'no admin recipients configured' });
      return;
    }
    const sev = (severity ?? 'error').toLowerCase();
    const icon = sev === 'error' ? '\u{1F534}' : sev === 'warn' ? '\u{1F7E1}' : sev === 'info' ? '\u{1F535}' : '⚪';
    const host = process.env.HOSTNAME || require('os').hostname().split('.')[0];
    const src = source ?? '?';
    const prefix = dedup_prefix ? `${dedup_prefix} ` : '';
    let full = `${icon} [${host}/${src}] ${sev}: ${prefix}${message}`;
    if (log && typeof log === 'string') {
      const clipped = log.split('\n').slice(-20).join('\n');
      full += `\n\n\`\`\`\n${clipped}\n\`\`\``;
    }
    if (full.length > 3900) full = full.slice(0, 3900) + '…';

    const sent: number[] = [];
    const failures: { chat_id: number; error: string }[] = [];
    for (const chatId of adminIds) {
      try {
        const result = await bot.api.sendMessage(chatId, full);
        sent.push(chatId);
        try {
          saveMessage({
            telegram_message_id: result.message_id,
            chat_id: chatId,
            chat_type: 'private',
            chat_title: null,
            user_id: chatId,
            username: null,
            display_name: null,
            text: full,
            direction: 'out',
            reply_to_message_id: null,
            media_type: null,
            file_path: null,
            file_name: null,
          });
        } catch (dbErr) {
          console.error(`[emergency] DB log failed for msg ${result.message_id}:`, (dbErr as Error).message);
        }
      } catch (err) {
        failures.push({ chat_id: chatId, error: (err as Error).message });
      }
    }
    console.log(`[emergency] ${src}/${sev} -> sent=${sent.length} fail=${failures.length}: ${message.slice(0, 80)}`);
    if (sent.length === 0) {
      res.status(502).json({ ok: false, sent, failures });
      return;
    }
    res.json({ ok: true, sent, failures });
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`[telegram-mcp] SSE listening on http://localhost:${PORT}`);
  });

  return httpServer;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is required');
    process.exit(1);
  }

  initDb();
  console.error('[telegram-mcp] Database initialized');

  const adminIds = parseAdminIds();
  const adminUsernames = (process.env.TELEGRAM_ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (adminIds.length > 0) {
    seedAdmins(adminIds, adminUsernames);
    console.error(`[telegram-mcp] Seeded ${adminIds.length} admin(s): ${adminIds.join(',')}`);
  }

  const startTime = Date.now();
  const bot = createBot(token, {
    getSessionCount: () => activeSessions.size,
    getUptime: () => (Date.now() - startTime) / 1000,
  });

  setupChannelPush(bot, adminIds);

  if (STDIO_MODE) {
    console.error('[telegram-mcp] Starting in stdio mode (plugin)');
    await startStdio(bot, adminIds);
  } else {
    console.error(`[telegram-mcp] Starting in SSE mode (standalone, port ${PORT})`);
    await startSSE(bot, adminIds);
  }

  bot.start({
    allowed_updates: ['message', 'message_reaction', 'callback_query'],
    onStart: () => console.error('[telegram-mcp] Bot started, listening for messages...'),
  }).catch((err) => {
    console.error('[telegram-mcp] Bot polling error:', (err as Error).message);
  });

  async function shutdown() {
    console.error('[telegram-mcp] Shutting down...');
    activeSessions.clear();
    await bot.stop();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
