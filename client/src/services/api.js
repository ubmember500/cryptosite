import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
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

    // Login/register return 401 for invalid credentials — let the page show the error, never redirect
    if (isAuthEndpoint) {
      return Promise.reject(error);
    }

    // Handle 401 on protected routes (expired/invalid token)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

export default api;
