import api from './api';

const SESSION_KEY = 'crypto-alerts-session-id';
const FLUSH_INTERVAL_MS = 10000;
const MAX_BATCH_SIZE = 50;

let queue = [];
let flushTimer = null;

function generateSessionId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}

export function getActivitySessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const sessionId = generateSessionId();
    localStorage.setItem(SESSION_KEY, sessionId);
    return sessionId;
  } catch {
    return 'anonymous';
  }
}

function normalizeEvent(eventType, payload = {}) {
  return {
    eventType,
    sessionId: getActivitySessionId(),
    pagePath: typeof payload.pagePath === 'string' ? payload.pagePath : window.location.pathname,
    label: typeof payload.label === 'string' ? payload.label : undefined,
    element: typeof payload.element === 'string' ? payload.element : undefined,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined,
    occurredAt: new Date().toISOString(),
  };
}

async function flushQueue() {
  if (queue.length === 0) return;

  const events = queue.slice(0, MAX_BATCH_SIZE);
  queue = queue.slice(MAX_BATCH_SIZE);

  try {
    await api.post('/activity/track', {
      sessionId: getActivitySessionId(),
      events,
    });
  } catch {
    queue = [...events, ...queue].slice(0, 500);
  }
}

function ensureFlushTimer() {
  if (flushTimer) return;
  flushTimer = window.setInterval(() => {
    flushQueue();
  }, FLUSH_INTERVAL_MS);
}

export function initActivityTracking() {
  ensureFlushTimer();

  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      flushQueue();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('beforeunload', flushQueue);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('beforeunload', flushQueue);
    if (flushTimer) {
      window.clearInterval(flushTimer);
      flushTimer = null;
    }
  };
}

export function trackActivity(eventType, payload = {}) {
  const event = normalizeEvent(eventType, payload);
  queue.push(event);

  if (queue.length >= MAX_BATCH_SIZE) {
    flushQueue();
    return;
  }

  ensureFlushTimer();
}

export function trackPageView(path) {
  trackActivity('page_view', { pagePath: path });
}

export function trackClick({ pagePath, label, element, metadata } = {}) {
  trackActivity('click', { pagePath, label, element, metadata });
}
