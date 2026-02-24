const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const http = require('http');
const app = require('./app');
const socketService = require('./services/socketService');
const klineManager = require('./services/klineManager');
const { startAlertEngine, stopAlertEngine } = require('./services/alertEngine');
const telegramPolling = require('./services/telegramPolling');

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with the HTTP server
socketService.initializeSocket(server);

// Start server
let isShuttingDown = false;

async function bootstrap() {
  server.listen(PORT, async () => {
    try {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log('📡 Socket.IO initialized');

      await startAlertEngine();
      console.log('⏰ Alert engine started');

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
    } catch (error) {
      console.error('Server startup sequence failed:', error);
      process.exit(1);
    }
  });
}

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} signal received: closing HTTP server`);

  klineManager.shutdown();
  telegramPolling.stopTelegramPolling();
  await stopAlertEngine();

  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  console.error('Server bootstrap failed:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  shutdown('SIGINT');
});
