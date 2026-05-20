import { Composer } from 'grammy';
import { cancelLogin, isLoginAdmin, isLoginConfigured, startLogin } from '../login-flow.js';

const composer = new Composer();

composer.command('login', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId || !isLoginAdmin(userId)) {
    await ctx.reply('Only bot admins can use /login.');
    return;
  }

  if (!isLoginConfigured()) {
    await ctx.reply('Login script not configured. Run `claude auth login` on your server directly, or set TELEGRAM_LOGIN_SCRIPT env var.');
    return;
  }

  await ctx.reply('Starting claude auth login...');

  const result = await startLogin(ctx.chat!.id);
  if (!result.ok) {
    await ctx.reply(`Failed to start login: ${result.error}`);
    return;
  }

  await ctx.reply(
    `Open the link below, sign in to your Claude account, copy the code and send it as the NEXT message (or /login_cancel to abort).\n\n${result.url}`,
    { link_preview_options: { is_disabled: true } },
  );
});

composer.command('login_cancel', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId || !isLoginAdmin(userId)) return;
  await cancelLogin(ctx.chat!.id);
  await ctx.reply('Login cancelled.');
});

export default composer;
