/**
 * Long-polling for Telegram Updates when TELEGRAM_WEBHOOK_URL is not set.
 * Processes /start CONNECT_<token> the same way as the webhook to link users.
 * Telegram allows either webhook or getUpdates, not both.
 */
const telegramService = require('./telegramService');

const GET_UPDATES_TIMEOUT_SEC = 30;
let pollingLoopPromise = null;
let lastOffset = 0;
let stopped = false;

const START_INSTRUCTIONS =
  "To link your account: open the website → Telegram Bots page → click «Подключить» → then press Start in this chat when the link opens.";

/**
 * Process a single Telegram Update: if message.text is /start CONNECT_<token>, consume token and link user.
 * If /start without token, reply with instructions so user gets a response and knows how to link.
 * @param {object} update - Telegram Update object
 */
async function processUpdate(update) {
  if (!update || !telegramService.hasTelegramBot()) return;
  const message = update.message || update.edited_message;
  if (!message || !message.text) return;

  const text = String(message.text).trim();
  const chatId = message.chat && message.chat.id;
  if (chatId == null) return;

  const match = text.match(/^\/start\s+CONNECT_(.+)$/);
  if (!match) {
    if (text.startsWith('/start')) {
      console.log('[telegramPolling] /start without CONNECT token, text:', JSON.stringify(text));
      await telegramService.sendMessage(chatId, START_INSTRUCTIONS);
    }
    return;
  }

  const token = match[1].trim();
  if (!token) {
    if (chatId) await telegramService.sendMessage(chatId, START_INSTRUCTIONS);
    return;
  }

  const consumed = await telegramService.consumeConnectToken(token);
  if (!consumed) {
    console.log('[telegramPolling] Invalid or expired CONNECT token');
    await telegramService.sendMessage(chatId, "This link has expired or was already used. Get a new link from the website (Подключить).");
    return;
  }

  const telegramUsername =
    message.from && message.from.username ? message.from.username : undefined;
  await telegramService.linkUserTelegram(consumed.userId, String(chatId), telegramUsername);
  console.log('[telegramPolling] User linked via /start CONNECT');
  await telegramService.sendMessage(chatId, "You're connected! You'll receive CryptoAlerts here.");
}

/**
 * Fetch updates from Telegram getUpdates and process them. Advances offset.
 */
async function poll() {
  if (stopped || !telegramService.hasTelegramBot()) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !token.trim()) return;

  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastOffset}&timeout=${GET_UPDATES_TIMEOUT_SEC}`;
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!data.ok || !Array.isArray(data.result)) return;

    for (const update of data.result) {
      if (update.update_id != null && update.update_id >= lastOffset) {
        lastOffset = update.update_id + 1;
      }
      await processUpdate(update);
    }
  } catch (err) {
    console.error('[telegramPolling] getUpdates failed:', err.message);
  }
}

/**
 * Run the long-polling loop until stopped. getUpdates with timeout holds the request until updates or timeout.
 */
async function runPollingLoop() {
  while (!stopped && telegramService.hasTelegramBot()) {
    await poll();
  }
}

/**
 * Start the long-polling loop. Call only when TELEGRAM_BOT_TOKEN is set and TELEGRAM_WEBHOOK_URL is not set.
 * Non-blocking: runs the loop in the background.
 */
function startTelegramPolling() {
  if (!telegramService.hasTelegramBot()) return;
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (webhookUrl && String(webhookUrl).trim().startsWith('https://')) {
    return; // Use webhook only; do not poll
  }
  if (pollingLoopPromise != null) return;

  stopped = false;
  lastOffset = 0;
  pollingLoopPromise = runPollingLoop();
  pollingLoopPromise.catch((err) => console.error('[telegramPolling] Loop error:', err.message));
  console.log('[telegramPolling] Started (getUpdates)');
}

/**
 * Stop the polling loop. Call on graceful shutdown.
 */
function stopTelegramPolling() {
  stopped = true;
  if (pollingLoopPromise != null) {
    pollingLoopPromise = null;
    console.log('[telegramPolling] Stopped');
  }
}

module.exports = {
  startTelegramPolling,
  stopTelegramPolling,
};
