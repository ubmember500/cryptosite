import api from './api';

export const watchlistService = {
  async getWatchlist() {
    const response = await api.get('/watchlist');
    return response.data;
  },

  async addToWatchlist(coinId, coinSymbol) {
    const response = await api.post('/watchlist', { coinId, coinSymbol });
    return response.data;
  },

  async removeFromWatchlist(coinId) {
    const response = await api.delete(`/watchlist/${coinId}`);
    return response.data;
  }
};
