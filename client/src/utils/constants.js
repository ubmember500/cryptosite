const PROD_API_FALLBACK = 'https://cryptosite-rud8.onrender.com/api';
const DEV_API_FALLBACK = 'http://localhost:5000/api';

const configuredApiBase = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const configuredApiIsLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(configuredApiBase);
const configuredApiIsRelative = /^\//.test(configuredApiBase);
const configuredApiIsAbsolute = /^https?:\/\//i.test(configuredApiBase);
const configuredApiLooksLikePlaceholder = /VITE_[A-Z0-9_]+/i.test(configuredApiBase);
const configuredApiIsUsableInProd = configuredApiIsAbsolute && !configuredApiIsLocalhost && !configuredApiLooksLikePlaceholder;
const configuredApiIsUsableInDev = (configuredApiIsRelative || configuredApiIsAbsolute) && !configuredApiLooksLikePlaceholder;

export const API_BASE_URL =
  (import.meta.env.PROD
    ? (configuredApiIsUsableInProd ? configuredApiBase : PROD_API_FALLBACK)
    : (configuredApiIsUsableInDev ? configuredApiBase : DEV_API_FALLBACK)) ||
  (import.meta.env.PROD ? PROD_API_FALLBACK : DEV_API_FALLBACK);

const configuredSocketUrl = String(import.meta.env.VITE_SOCKET_URL || '').trim();
const configuredSocketLooksLikePlaceholder = /VITE_[A-Z0-9_]+/i.test(configuredSocketUrl);
const configuredSocketIsUsableInProd = /^https?:\/\//i.test(configuredSocketUrl) && !configuredSocketLooksLikePlaceholder;
const configuredSocketIsUsableInDev = (/^https?:\/\//i.test(configuredSocketUrl) || /^\//.test(configuredSocketUrl)) && !configuredSocketLooksLikePlaceholder;

export const SOCKET_URL =
  (import.meta.env.PROD
    ? (configuredSocketIsUsableInProd ? configuredSocketUrl : API_BASE_URL.replace(/\/api\/?$/, ''))
    : (configuredSocketIsUsableInDev ? configuredSocketUrl : API_BASE_URL.replace(/\/api\/?$/, ''))) || API_BASE_URL.replace(/\/api\/?$/, '');

if (import.meta.env.DEV || typeof window !== 'undefined') {
  console.log('[Config] API_BASE_URL =', API_BASE_URL);
  console.log('[Config] VITE_API_BASE_URL env =', configuredApiBase);
}

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
