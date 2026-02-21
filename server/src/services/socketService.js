const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');
const klineManager = require('./klineManager');

let io = null;

const configuredFrontendOrigins = String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  'http://localhost:5173',
  ...configuredFrontendOrigins,
]);

const isLocalDevOrigin = (origin) =>
  /^http:\/\/localhost:\d+$/.test(origin) ||
  /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);

const isTrustedVercelOrigin = (origin) =>
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

/**
 * Initialize Socket.IO server
 * Sets up CORS, authentication middleware, and connection handling
 */
function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin) || isLocalDevOrigin(origin) || isTrustedVercelOrigin(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Socket CORS blocked for origin: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authentication middleware for Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify token
      const decoded = verifyAccessToken(token);

      // Fetch user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          username: true,
        },
      });

      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      // Attach user to socket
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Initialize klineManager with Socket.IO instance
  klineManager.initialize(io);

  // Handle connection
  io.on('connection', (socket) => {
    console.log(`User ${socket.user.username} (${socket.user.id}) connected`);

    // Join user-specific room (room name = userId)
    socket.join(socket.user.id);

    // Handle kline subscription
    socket.on('subscribe-kline', ({ exchange, symbol, interval, exchangeType }) => {
      try {
        console.log(`[SocketIO] Subscribe kline: ${socket.id} -> ${exchange}:${symbol}:${interval}:${exchangeType}`);
        klineManager.subscribe(socket.id, exchange, symbol, interval, exchangeType);
      } catch (error) {
        console.error(`[SocketIO] Error subscribing to kline:`, error.message);
        socket.emit('kline-error', { error: error.message });
      }
    });

    // Handle kline unsubscription
    socket.on('unsubscribe-kline', ({ exchange, symbol, interval, exchangeType }) => {
      try {
        console.log(`[SocketIO] Unsubscribe kline: ${socket.id} -> ${exchange}:${symbol}:${interval}:${exchangeType}`);
        klineManager.unsubscribe(socket.id, exchange, symbol, interval, exchangeType);
      } catch (error) {
        console.error(`[SocketIO] Error unsubscribing from kline:`, error.message);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User ${socket.user.username} (${socket.user.id}) disconnected`);
      
      // Clean up all kline subscriptions for this client
      klineManager.handleClientDisconnect(socket.id);
    });
  });

  return io;
}

/**
 * Emit price update to all connected clients
 * @param {Object} priceData - { coinId, price, change24h }
 */
function emitPriceUpdate(priceData) {
  if (io) {
    io.emit('price-update', priceData);
  }
}

/**
 * Emit alert triggered event to specific user's room.
 * Payload must include `id` (alert id) for client store update; include `name`, `description`, `triggered`, `triggeredAt` for toast and table.
 * @param {String} userId - User ID
 * @param {Object} alertData - { id, alertId?, name, description, triggered, triggeredAt, ... }
 */
function emitAlertTriggered(userId, alertData) {
  if (io) {
    io.to(userId).emit('alert-triggered', alertData);
  }
}

/**
 * Get Socket.IO instance
 */
function getIO() {
  return io;
}

module.exports = {
  initializeSocket,
  emitPriceUpdate,
  emitAlertTriggered,
  getIO,
};
