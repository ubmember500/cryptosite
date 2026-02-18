import api from './api';

export const wallScannerService = {
  getTopSymbols(exchange, market = 'futures') {
    return api.get('/wall-scanner/symbols', { params: { exchange, market } }).then((r) => r.data.symbols || []);
  },

  scan(params, signal) {
    return api.get('/wall-scanner/scan', { params, signal }).then((r) => r.data);
  },

  getDensityMap(exchange, symbol, depth, minVolume) {
    return api.get('/wall-scanner/density', {
      params: { exchange, symbol, depth, minVolume },
    }).then((r) => r.data.density || {});
  },
};
