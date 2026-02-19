const PROD_API_FALLBACK = 'https://cryptosite-rud8.onrender.com/api';
const DEV_API_FALLBACK = 'http://localhost:5000/api';

const configuredApiBase = import.meta.env.VITE_API_BASE_URL;
const configuredApiIsLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(String(configuredApiBase || ''));

export const API_BASE_URL =
  (import.meta.env.PROD && configuredApiIsLocalhost
    ? PROD_API_FALLBACK
    : configuredApiBase) ||
  (import.meta.env.PROD ? PROD_API_FALLBACK : DEV_API_FALLBACK);
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
