import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

/**
 * useSocket hook - manages Socket.IO connection for real-time alerts and klines
 * @param {Object} options - Optional callbacks
 * @param {Function} options.onAlertTriggered - Callback when alert is triggered
 * @param {Function} options.onKlineUpdate - Callback when kline data updates
 */
export const useSocket = (options = {}) => {
  const socketRef = useRef(null);
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    // Only connect if authenticated and have token
    if (!isAuthenticated || !accessToken) {
      return;
    }

    // Connect to Socket.IO server
    const socket = io('http://localhost:5000', {
      auth: {
        token: accessToken,
      },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    // Connection event
    socket.on('connect', () => {
      console.log('[Socket] ✅ Connected, socket ID:', socket.id);
      if (options.onConnect) {
        options.onConnect();
      }
    });

    // Disconnection event
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      if (options.onDisconnect) {
        options.onDisconnect();
      }
    });

    // Error event
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    // Listen for alert triggered events
    if (options.onAlertTriggered) {
      socket.on('alert-triggered', (alertData) => {
        options.onAlertTriggered(alertData);
      });
    }

    // Listen for kline updates
    if (options.onKlineUpdate) {
      socket.on('kline-update', (klineData) => {
        console.log('[Socket] 📊 kline-update event received:', {
          exchange: klineData.exchange,
          symbol: klineData.symbol,
          interval: klineData.interval,
          exchangeType: klineData.exchangeType,
          close: klineData.kline?.close,
          time: klineData.kline?.time,
          isClosed: klineData.kline?.isClosed,
        });
        options.onKlineUpdate(klineData);
      });
    }

    // Listen for kline errors
    socket.on('kline-error', (errorData) => {
      console.error('[Socket] Kline error:', errorData.error);
    });

    // Add methods to socket instance for external access
    socket.subscribeKline = (exchange, symbol, interval, exchangeType) => {
      console.log(`[Socket] 📤 Emitting subscribe-kline:`, {
        exchange,
        symbol,
        interval,
        exchangeType,
        socketId: socket.id,
        connected: socket.connected
      });
      socket.emit('subscribe-kline', { exchange, symbol, interval, exchangeType });
      console.log('[Socket] ✅ subscribe-kline event emitted');
    };

    socket.unsubscribeKline = (exchange, symbol, interval, exchangeType) => {
      console.log(`[Socket] 📤 Emitting unsubscribe-kline:`, {
        exchange,
        symbol,
        interval,
        exchangeType,
        socketId: socket.id
      });
      socket.emit('unsubscribe-kline', { exchange, symbol, interval, exchangeType });
      console.log('[Socket] ✅ unsubscribe-kline event emitted');
    };

    // Cleanup on unmount or when auth changes
    return () => {
      if (socket) {
        socket.off('alert-triggered');
        socket.off('kline-update');
        socket.off('kline-error');
        socket.disconnect();
      }
    };
  }, [isAuthenticated, accessToken, options.onAlertTriggered, options.onKlineUpdate]);

  return socketRef.current;
};
