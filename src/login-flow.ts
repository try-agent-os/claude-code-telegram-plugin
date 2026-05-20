// Telegram-triggered `claude auth login` flow.
//
// State machine:
//   /login                         -> cmd_start -> URL -> user copies code ->
//   <next text msg from same chat> -> cmd_submit -> OK / FAIL
//   /login_cancel  or 5min timeout -> cmd_cancel
//
// Requires an external login script (set via TELEGRAM_LOGIN_SCRIPT env var)
// that accepts: start | submit <code> | cancel
// The script should output URL=<url> on start, and OK on successful submit.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execFileP = promisify(execFile);

const SCRIPT = process.env.TELEGRAM_LOGIN_SCRIPT || '';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingLogin {
  startedAt: number;
  timer: NodeJS.Timeout;
}

const pending = new Map<number, PendingLogin>();

function adminIds(): Set<number> {
  const raw = process.env.TELEGRAM_ADMIN_USER_IDS || process.env.TELEGRAM_USER_ID || '';
  const ids = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  return new Set(ids);
}

export function isLoginConfigured(): boolean {
  return SCRIPT !== '' && existsSync(SCRIPT);
}

export function isLoginAdmin(userId: number): boolean {
  return adminIds().has(userId);
}

export function isLoginPending(chatId: number): boolean {
  return pending.has(chatId);
}

function clearPending(chatId: number): void {
  const p = pending.get(chatId);
  if (p) clearTimeout(p.timer);
  pending.delete(chatId);
}

export interface StartResult {
  ok: true;
  url: string;
}
export interface StartFailure {
  ok: false;
  error: string;
}

export async function startLogin(chatId: number): Promise<StartResult | StartFailure> {
  if (!isLoginConfigured()) {
    return { ok: false, error: 'Login script not configured. Set TELEGRAM_LOGIN_SCRIPT env var or run `claude auth login` on your server directly.' };
  }

  clearPending(chatId);
  try {
    await execFileP(SCRIPT, ['cancel']);
  } catch {
    // ignore
  }

  try {
    const { stdout } = await execFileP(SCRIPT, ['start'], { timeout: 40_000 });
    const urlMatch = stdout.match(/^URL=(.+)$/m);
    if (!urlMatch) {
      return { ok: false, error: 'login script returned no URL' };
    }
    const url = urlMatch[1].trim();
    const timer = setTimeout(() => {
      pending.delete(chatId);
      execFile(SCRIPT, ['cancel'], () => {});
      console.error(`[login-flow] chat ${chatId} login timed out after 5min`);
    }, LOGIN_TIMEOUT_MS);
    pending.set(chatId, { startedAt: Date.now(), timer });
    return { ok: true, url };
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    return { ok: false, error: e.stderr?.trim() || e.message };
  }
}

export interface SubmitResult {
  ok: true;
}
export interface SubmitFailure {
  ok: false;
  error: string;
}

export async function submitLogin(chatId: number, code: string): Promise<SubmitResult | SubmitFailure> {
  if (!pending.has(chatId)) {
    return { ok: false, error: 'no active login session — start with /login first' };
  }
  try {
    const { stdout } = await execFileP(SCRIPT, ['submit', code], { timeout: 60_000 });
    clearPending(chatId);
    if (stdout.trim() === 'OK') {
      return { ok: true };
    }
    return { ok: false, error: `unexpected script output: ${stdout.trim()}` };
  } catch (err) {
    clearPending(chatId);
    const e = err as { stderr?: string; message: string };
    return { ok: false, error: e.stderr?.trim() || e.message };
  }
}

export async function cancelLogin(chatId: number): Promise<void> {
  clearPending(chatId);
  try {
    await execFileP(SCRIPT, ['cancel']);
  } catch {
    // ignore
  }
}
