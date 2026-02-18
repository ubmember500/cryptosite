import api from './api';

export const telegramService = {
  /**
   * Get one-time connect link for linking Telegram to the account.
   * GET /api/telegram/connect-link (auth required)
   * @returns {{ connectLink: string, expiresAt: string }}
   */
  async getConnectLink() {
    const response = await api.get('/telegram/connect-link');
    return response.data;
  },

  /**
   * Disconnect Telegram from the current user.
   * DELETE /api/telegram/disconnect (auth required)
   */
  async disconnectTelegram() {
    await api.delete('/telegram/disconnect');
  },

  /**
   * Send a test notification to the current user's Telegram. Fails if not linked.
   * POST /api/telegram/test (auth required)
   */
  async sendTestNotification() {
    const response = await api.post('/telegram/test');
    return response.data;
  },
};
