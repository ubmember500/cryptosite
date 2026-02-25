import api from './api';

export const alertService = {
  /**
   * Get alerts with optional filters.
   * @param {object} params - { status, exchange, market, type }
   * @returns {Promise<array>} - Array of alerts (from response.data.alerts or response.data if array)
   */
  async getAlerts(params = {}) {
    const { status, exchange, market, type } = params;
    const query = {};
    if (status != null && status !== '') query.status = status;
    if (exchange != null && exchange !== '') query.exchange = exchange;
    if (market != null && market !== '') query.market = market;
    if (type != null && type !== '') query.type = type;
    const response = await api.get('/alerts', { params: query });
    const data = response.data;
    const alerts = Array.isArray(data?.alerts) ? data.alerts : (Array.isArray(data) ? data : []);
    const sweptTriggers = Array.isArray(data?.sweptTriggers) ? data.sweptTriggers : [];
    const pendingNotifications = Array.isArray(data?.pendingNotifications) ? data.pendingNotifications : [];
    return { alerts, sweptTriggers, pendingNotifications };
  },

  /**
   * Create alert. Returns single alert from response.data.alert.
   */
  async createAlert(payload) {
    const response = await api.post('/alerts', payload);
    const alert = response.data?.alert ?? response.data;
    return {
      alert,
      immediateTrigger: Boolean(response.data?.immediateTrigger),
      transition: response.data?.transition ?? null,
    };
  },

  /**
   * Update alert. Returns single alert from response.data.alert.
   */
  async updateAlert(id, payload) {
    const response = await api.put(`/alerts/${id}`, payload);
    return response.data?.alert ?? response.data;
  },

  /**
   * Toggle alert active state (PATCH /alerts/:id/toggle). Returns single alert from response.data.alert.
   */
  async toggleAlert(id) {
    const response = await api.patch(`/alerts/${id}/toggle`);
    return response.data?.alert ?? response.data;
  },

  async deleteAlert(id) {
    const response = await api.delete(`/alerts/${id}`);
    return response.data;
  },

  async getHistory() {
    const response = await api.get('/alerts/history');
    const data = response.data;
    if (Array.isArray(data?.alerts)) return data.alerts;
    if (Array.isArray(data)) return data;
    return [];
  },
};
