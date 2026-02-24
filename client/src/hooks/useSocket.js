import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { SOCKET_URL } from '../utils/constants';

/**
 * useSocket hook - manages Socket.IO connection for real-time alerts and klines
 * @param {Object} options - Optional callbacks
 * @param {Function} options.onAlertTriggered - Callback when alert is triggered
 * @param {Function} options.onKlineUpdate - Callback when kline data updates
 */
export const useSocket = (options = {}) => {
  const socketRef = useRef(null);
  const seenTriggeredEventsRef = useRef(new Set());
  const callbacksRef = useRef({
    onConnect: null,
    onDisconnect: null,
    onAlertTriggered: null,
    onKlineUpdate: null,
  });
  const accessToken = useAuthStore((state) => state.accessToken);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    callbacksRef.current = {
      onConnect: options.onConnect || null,
      onDisconnect: options.onDisconnect || null,
      onAlertTriggered: options.onAlertTriggered || null,
      onKlineUpdate: options.onKlineUpdate || null,
    };
  }, [options.onConnect, options.onDisconnect, options.onAlertTriggered, options.onKlineUpdate]);

  useEffect(() => {
    // Only connect if authenticated and have token
    if (!isAuthenticated || !accessToken) {
      return;
    }

    // Connect to Socket.IO server
    const socket = io(SOCKET_URL, {
      auth: {
        token: accessToken,
      },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    // Connection event
    socket.on('connect', () => {
      console.log('[Socket] ✅ Connected, socket ID:', socket.id);
      if (callbacksRef.current.onConnect) {
        callbacksRef.current.onConnect();
      }
    });

    // Disconnection event
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      if (callbacksRef.current.onDisconnect) {
        callbacksRef.current.onDisconnect();
      }
    });

    // Error event
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    // Listen for alert triggered events
    socket.on('alert-triggered', (alertData) => {
      const alertId = alertData?.id || alertData?.alertId;
      const triggeredAt = alertData?.triggeredAt ? new Date(alertData.triggeredAt).toISOString() : 'na';
      const dedupeKey = `${alertId || 'unknown'}:${triggeredAt}`;

      if (seenTriggeredEventsRef.current.has(dedupeKey)) {
        return;
      }
      seenTriggeredEventsRef.current.add(dedupeKey);

      if (seenTriggeredEventsRef.current.size > 500) {
        const keys = Array.from(seenTriggeredEventsRef.current);
        seenTriggeredEventsRef.current = new Set(keys.slice(-200));
      }

      if (callbacksRef.current.onAlertTriggered) {
        callbacksRef.current.onAlertTriggered(alertData);
      }
    });

    // Listen for kline updates
    socket.on('kline-update', (klineData) => {
      if (!callbacksRef.current.onKlineUpdate) return;
      console.log('[Socket] 📊 kline-update event received:', {
        exchange: klineData.exchange,
        symbol: klineData.symbol,
        interval: klineData.interval,
        exchangeType: klineData.exchangeType,
        close: klineData.kline?.close,
        time: klineData.kline?.time,
        isClosed: klineData.kline?.isClosed,
      });
      callbacksRef.current.onKlineUpdate(klineData);
    });

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
  }, [isAuthenticated, accessToken]);

  return socketRef.current;
};
