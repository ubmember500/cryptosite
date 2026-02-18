const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const handleResponse = async (response) => {
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Something went wrong');
  }
  return response.json();
};

export const apiService = {
  // Market Data
  getCoins: async (params) => {
    const query = new URLSearchParams(params).toString();
    return fetch(`${API_BASE_URL}/market/coins?${query}`).then(handleResponse);
  },
  getCoinDetails: async (id) => {
    return fetch(`${API_BASE_URL}/market/coins/${id}`).then(handleResponse);
  },
  searchCoins: async (query) => {
    return fetch(`${API_BASE_URL}/market/search?q=${query}`).then(handleResponse);
  },
  getBinanceTokens: async (exchangeType, params) => {
    const query = new URLSearchParams(params).toString();
    return fetch(`${API_BASE_URL}/market/binance/tokens?exchangeType=${exchangeType}&${query}`).then(handleResponse);
  },
  getBinanceTokenDetails: async (symbol, exchangeType) => {
    return fetch(`${API_BASE_URL}/market/binance/tokens/${symbol}?exchangeType=${exchangeType}`).then(handleResponse);
  },

  // Auth (placeholder - actual implementation will use tokens)
  login: async (credentials) => {
    // TODO: Implement actual login with JWT handling
    return { user: { id: '1', username: 'test' }, token: 'fake-jwt-token' };
  },
};
