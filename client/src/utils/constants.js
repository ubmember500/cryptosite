export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || API_BASE_URL.replace(/\/api\/?$/, '');

export const ROUTES = {
  HOME: '/',
  ACCOUNT: '/account',
  CHARTS: '/charts',
  ALERTS: '/alerts',
  MARKET: '/market',
  MARKET_MAP: '/market-map',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  PROFILE: '/profile',
  LISTINGS: '/listings',
};

export const ALERT_CONDITIONS = {
  ABOVE: 'above',
  BELOW: 'below',
  PCT_CHANGE: 'pct_change',
};

export const ALERT_STATUS = {
  ACTIVE: 'active',
  TRIGGERED: 'triggered',
  EXPIRED: 'expired',
};
