/* eslint-disable no-undef */
// __PROD_API_URL__ and __PROD_SOCKET_URL__ are injected by vite.config.js `define`.
// They are compile-time constants that CANNOT be overridden by Cloudflare/Vercel env vars.
const PROD_API = typeof __PROD_API_URL__ !== 'undefined' ? __PROD_API_URL__ : 'https://cryptosite-rud8.onrender.com/api';
const PROD_SOCKET = typeof __PROD_SOCKET_URL__ !== 'undefined' ? __PROD_SOCKET_URL__ : 'https://cryptosite-rud8.onrender.com';

// Dev: respect env vars; Prod: always use the hardcoded Render URLs.
export const API_BASE_URL = import.meta.env.PROD
  ? PROD_API
  : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api');

export const SOCKET_URL = import.meta.env.PROD
  ? PROD_SOCKET
  : (import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000');

console.log('[Config] API_BASE_URL =', API_BASE_URL);
console.log('[Config] SOCKET_URL =', SOCKET_URL);

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
  FORMATIONS: '/formations',
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
