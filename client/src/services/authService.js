import api from './api';

export const authService = {
  async register(username, email, password) {
    const response = await api.post('/auth/register', { username, email, password }, { _skipAuthRedirect: true });
    return response.data;
  },

  async login(email, password) {
    try {
      const response = await api.post('/auth/login', { email, password }, { _skipAuthRedirect: true });
      // response.data should have { user, accessToken, refreshToken }
      if (!response?.data) {
        console.error('[authService.login] Response has no data', response);
        throw new Error('Invalid login response');
      }
      return response.data;
    } catch (err) {
      console.error('[authService.login] Request failed', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      throw err;
    }
  },

  async getMe() {
    const response = await api.get('/auth/me');
    return response.data;
  },
  
  // Refresh token is often handled via cookies or specific endpoint
  async refresh() {
    const response = await api.post('/auth/refresh');
    return response.data;
  },

  async forgotPassword(email) {
    const response = await api.post('/auth/forgot-password', { email });
    return response.data;
  },

  async resetPassword(token, newPassword) {
    const response = await api.post('/auth/reset-password', { token, newPassword });
    return response.data;
  },
};
