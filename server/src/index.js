const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const http = require('http');
const app = require('./app');
const socketService = require('./services/socketService');
const klineManager = require('./services/klineManager');
const { startAlertEngine } = require('./services/alertEngine');
const telegramPolling = require('./services/telegramPolling');

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with the HTTP server
socketService.initializeSocket(server);

// Start alert engine (klineManager initializes on-demand when clients subscribe)
startAlertEngine();

// Start server
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO initialized`);
  console.log(`⏰ Alert engine started`);

  const { logEmailStatus } = require('./utils/email');
  logEmailStatus();

  const telegramService = require('./services/telegramService');
  const hasToken = telegramService.hasTelegramBot();
  console.log(`📱 Telegram bot: ${hasToken ? 'configured' : 'not configured (set TELEGRAM_BOT_TOKEN in .env and restart)'}`);

  if (hasToken) {
    const username = await telegramService.getBotUsername();
    if (username) {
      console.log(`📱 Telegram bot username: @${username}`);
    } else {
      console.warn('📱 Telegram getMe failed or no username (check token or set TELEGRAM_BOT_USERNAME)');
    }

    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    const useWebhook = webhookUrl && String(webhookUrl).trim().startsWith('https://');
    if (useWebhook) {
      await telegramService.setWebhook(String(webhookUrl).trim());
      console.log('📱 Telegram updates: webhook');
    } else {
      await telegramService.deleteWebhook();
      telegramPolling.startTelegramPolling();
      console.log('📱 Telegram updates: polling');
    }
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  klineManager.shutdown();
  telegramPolling.stopTelegramPolling();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  klineManager.shutdown();
  telegramPolling.stopTelegramPolling();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
