const crypto = require('crypto');
const prisma = require('../utils/prisma');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;

const CONNECT_TOKEN_TTL_MINUTES = 15;
let cachedBotUsername = null;

function hasTelegramBot() {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN.trim());
}

/**
 * Get bot username: from env, or from Telegram getMe (cached).
 * @returns {Promise<string|null>}
 */
async function getBotUsername() {
  if (TELEGRAM_BOT_USERNAME && TELEGRAM_BOT_USERNAME.trim()) {
    return TELEGRAM_BOT_USERNAME.trim();
  }
  if (cachedBotUsername) return cachedBotUsername;
  if (!hasTelegramBot()) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await res.json();
    if (data.ok && data.result && data.result.username) {
      cachedBotUsername = data.result.username;
      return cachedBotUsername;
    }
  } catch (err) {
    console.error('[telegramService] getMe failed:', err.message);
  }
  return null;
}

/**
 * Create a one-time connect token for linking Telegram.
 * @param {string} userId
 * @returns {Promise<{ token: string, expiresAt: Date }|null>} null if bot not configured
 */
async function createConnectToken(userId) {
  if (!hasTelegramBot()) return null;
  // Telegram start parameter is max 64 chars; we use "CONNECT_" (8) + token, so token max 56 hex = 28 bytes
  const token = crypto.randomBytes(28).toString('hex');
  const expiresAt = new Date(Date.now() + CONNECT_TOKEN_TTL_MINUTES * 60 * 1000);
  await prisma.telegramConnectToken.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/**
 * Consume a connect token: find by token, check not expired and not used, return userId and set usedAt.
 * @param {string} token
 * @returns {Promise<{ userId: string }|null>}
 */
async function consumeConnectToken(token) {
  if (!token || typeof token !== 'string') return null;
  const row = await prisma.telegramConnectToken.findUnique({
    where: { token: token.trim() },
  });
  if (!row || row.usedAt || new Date() > row.expiresAt) return null;
  await prisma.telegramConnectToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return { userId: row.userId };
}

/**
 * Link user's Telegram: set telegramChatId, telegramUsername, telegramConnectedAt.
 * @param {string} userId
 * @param {string} chatId
 * @param {string} [telegramUsername]
 */
async function linkUserTelegram(userId, chatId, telegramUsername) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramChatId: String(chatId),
      telegramUsername: telegramUsername ? String(telegramUsername) : null,
      telegramConnectedAt: new Date(),
    },
  });
}

/**
 * Clear user's Telegram link.
 * @param {string} userId
 */
async function unlinkUserTelegram(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramChatId: null,
      telegramUsername: null,
      telegramConnectedAt: null,
    },
  });
}

/**
 * Send a text message to a Telegram chat. Logs errors; does not throw.
 * @param {string} chatId
 * @param {string} text
 */
async function sendMessage(chatId, text) {
  if (!hasTelegramBot()) return;
  if (!chatId || text == null) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text: String(text),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const msg = data.description ? ` ${data.description}` : '';
      console.warn('[telegramService] sendMessage error:', res.status, msg, data);
    }
  } catch (err) {
    console.error('[telegramService] sendMessage failed:', err.message);
  }
}

/**
 * Delete the webhook. Required when using getUpdates (polling) - Telegram sends updates to only one destination.
 * @returns {Promise<boolean>} true if delete succeeded or no webhook was set
 */
async function deleteWebhook() {
  if (!hasTelegramBot()) return false;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      console.log('[telegramService] deleteWebhook ok (updates will come via getUpdates)');
      return true;
    }
    console.warn('[telegramService] deleteWebhook failed:', data);
    return false;
  } catch (err) {
    console.error('[telegramService] deleteWebhook failed:', err.message);
    return false;
  }
}

/**
 * Call Telegram setWebhook with the given URL. Used at startup when TELEGRAM_WEBHOOK_URL is set.
 * @param {string} webhookUrl
 */
async function setWebhook(webhookUrl) {
  if (!hasTelegramBot() || !webhookUrl || !webhookUrl.startsWith('https://')) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      console.log('[telegramService] setWebhook ok:', webhookUrl);
    } else {
      console.warn('[telegramService] setWebhook failed:', data);
    }
  } catch (err) {
    console.error('[telegramService] setWebhook failed:', err.message);
  }
}

module.exports = {
  hasTelegramBot,
  getBotUsername,
  createConnectToken,
  consumeConnectToken,
  linkUserTelegram,
  unlinkUserTelegram,
  sendMessage,
  deleteWebhook,
  setWebhook,
};
