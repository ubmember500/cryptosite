const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const telegramService = require('../services/telegramService');

/**
 * GET /api/telegram/connect-link
 * Auth required. Returns one-time link to connect Telegram. 503 if bot not configured.
 */
router.get('/connect-link', authMiddleware, async (req, res, next) => {
  try {
    if (!telegramService.hasTelegramBot()) {
      return res.status(503).json({
        error: 'Telegram bot is not configured',
        hint: 'Create a bot via @BotFather, set TELEGRAM_BOT_TOKEN in server/.env, restart the backend. See README.',
      });
    }
    const { token, expiresAt } = await telegramService.createConnectToken(req.user.id);
    if (!token) {
      return res.status(503).json({
        error: 'Telegram bot is not configured',
        hint: 'Add TELEGRAM_BOT_TOKEN to server/.env and restart the backend.',
      });
    }
    const botUsername = await telegramService.getBotUsername();
    if (!botUsername) {
      return res.status(503).json({
        error: 'Could not resolve Telegram bot username',
        hint: 'Check TELEGRAM_BOT_TOKEN is valid, or set TELEGRAM_BOT_USERNAME in server/.env and restart.',
      });
    }
    const connectLink = `https://t.me/${botUsername}?start=CONNECT_${token}`;
    res.json({ connectLink, expiresAt });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/telegram/webhook
 * No auth. Telegram sends Update objects here. Handle /start CONNECT_<token> to link user. Always 200.
 */
const START_INSTRUCTIONS =
  "To link your account: open the website → Telegram Bots page → click «Подключить» → then press Start in this chat when the link opens.";

router.post('/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const message = body.message || body.edited_message;
    if (!message || !message.text) {
      return res.status(200).json({ ok: true });
    }
    const text = String(message.text).trim();
    const chatId = message.chat && message.chat.id;
    const match = text.match(/^\/start\s+CONNECT_(.+)$/);
    if (!match) {
      if (text.startsWith('/start') && chatId) {
        console.log('[telegram webhook] /start without CONNECT token, text:', JSON.stringify(text));
        await telegramService.sendMessage(chatId, START_INSTRUCTIONS);
      }
      return res.status(200).json({ ok: true });
    }
    const token = match[1].trim();
    if (!token) {
      if (chatId) await telegramService.sendMessage(chatId, START_INSTRUCTIONS);
      return res.status(200).json({ ok: true });
    }
    if (!telegramService.hasTelegramBot()) {
      return res.status(200).json({ ok: true });
    }
    const consumed = await telegramService.consumeConnectToken(token);
    if (!consumed) {
      if (chatId) {
        await telegramService.sendMessage(chatId, "This link has expired or was already used. Get a new link from the website (Подключить).");
      }
      return res.status(200).json({ ok: true });
    }
    if (chatId == null) {
      return res.status(200).json({ ok: true });
    }
    const telegramUsername = message.from && message.from.username ? message.from.username : undefined;
    await telegramService.linkUserTelegram(consumed.userId, String(chatId), telegramUsername);
    await telegramService.sendMessage(chatId, "You're connected! You'll receive CryptoAlerts here.");
  } catch (err) {
    console.error('[telegram webhook]', err.message);
  }
  res.status(200).json({ ok: true });
});

/**
 * POST /api/telegram/test
 * Auth required. Sends a test message to the current user's Telegram if linked. Verifies delivery path.
 */
router.post('/test', authMiddleware, async (req, res, next) => {
  try {
    if (!telegramService.hasTelegramBot()) {
      return res.status(503).json({ error: 'Telegram bot is not configured' });
    }
    const prisma = require('../utils/prisma');
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { telegramChatId: true },
    });
    if (!user || !user.telegramChatId) {
      return res.status(400).json({
        error: 'Telegram not linked',
        hint: 'Use the Connect button, then in Telegram press Start so the bot can link your account.',
      });
    }
    const testMessage = 'CryptoAlerts: test notification. If you see this, Telegram is linked and the bot can send you alerts.';
    await telegramService.sendMessage(user.telegramChatId, testMessage);
    res.json({ sent: true });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/telegram/disconnect
 * Auth required. Unlinks Telegram for the current user.
 */
router.delete('/disconnect', authMiddleware, async (req, res, next) => {
  try {
    await telegramService.unlinkUserTelegram(req.user.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
