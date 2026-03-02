import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { API_BASE_URL } from '../utils/constants';

const PUBLIC_PATHS = new Set(['/market', '/market-map', '/instructions', '/login', '/register', '/forgot-password', '/reset-password']);

const isPublicPath = (pathname = '') => {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return Array.from(PUBLIC_PATHS).some((publicPath) => publicPath !== '/' && pathname.startsWith(`${publicPath}/`));
};

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request: add Authorization only when token exists (login/register don't send token)
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response: 401 handling for protected routes only — do NOT run for login/register
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const url = originalRequest?.url ?? '';
    const isAuthEndpoint =
      url.includes('auth/login') || url.includes('auth/register') || originalRequest?._skipAuthRedirect;
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
    const isOnPublicPath = isPublicPath(currentPath);

    // Login/register return 401 for invalid credentials — let the page show the error, never redirect
    if (isAuthEndpoint) {
      return Promise.reject(error);
    }

    // Handle 401 on protected routes (expired/invalid token)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined' && !isOnPublicPath && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

export default api;
