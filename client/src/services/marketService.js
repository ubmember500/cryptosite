import api from './api';

export const marketService = {
  async getCoins() {
    const response = await api.get('/market/coins');
    return response.data;
  },

  async getCoin(id) {
    const response = await api.get(`/market/coins/${id}`);
    return response.data;
  },

  async searchCoins(query) {
    const response = await api.get('/market/search', {
      params: { query }
    });
    return response.data;
  }
};
