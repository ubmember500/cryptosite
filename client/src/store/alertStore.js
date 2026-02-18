import { create } from 'zustand';
import { alertService } from '../services/alertService';

export const useAlertStore = create((set, get) => ({
  alerts: [],
  history: [],
  loading: false,
  error: null,

  /**
   * Fetch alerts with filters. filters: { status, exchange, market, type }
   */
  fetchAlerts: async (filters = {}) => {
    set({ loading: true, error: null });
    try {
      const alerts = await alertService.getAlerts(filters);
      set({ alerts: Array.isArray(alerts) ? alerts : [], loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },
  
  fetchHistory: async () => {
      set({ loading: true, error: null });
      try {
        const data = await alertService.getHistory();
        set({ history: data, loading: false });
      } catch (error) {
        set({ error: error.message, loading: false });
      }
  },

  createAlert: async (alertData) => {
    set({ loading: true, error: null });
    try {
      const newAlert = await alertService.createAlert(alertData);
      set((state) => ({
        alerts: [newAlert, ...state.alerts],
        loading: false,
      }));
      return newAlert;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  updateAlert: async (id, alertData) => {
    set({ loading: true, error: null });
    try {
      const updatedAlert = await alertService.updateAlert(id, alertData);
      set((state) => ({
        alerts: state.alerts.map((a) => (a.id === id ? updatedAlert : a)),
        loading: false,
      }));
      return updatedAlert;
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  /**
   * Toggle alert isActive (mode). Updates the matching alert in state from response.
   */
  toggleAlert: async (id) => {
    set({ error: null });
    try {
      const updatedAlert = await alertService.toggleAlert(id);
      set((state) => ({
        alerts: state.alerts.map((a) => (a.id === id ? updatedAlert : a)),
      }));
      return updatedAlert;
    } catch (error) {
      set({ error: error.message });
      throw error;
    }
  },

  deleteAlert: async (id) => {
    set({ loading: true, error: null });
    try {
      await alertService.deleteAlert(id);
      set((state) => ({
        alerts: state.alerts.filter((a) => a.id !== id),
        loading: false
      }));
    } catch (error) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },
  
  // Real-time update helper
  // For complex alerts: updates triggered status (triggered: true, triggeredAt) but keeps isActive: true
  // For price alerts: typically removed via removeAlert, but if updated here, merges partial update
  addOrUpdateAlert: (alertUpdate) => {
      set((state) => {
          const exists = state.alerts.find(a => a.id === alertUpdate.id);
          if (exists) {
              // Merge incoming partial update onto existing alert - preserves all fields
              // Socket payload only has subset (id, name, description, triggered, triggeredAt, alertType, symbol, pctChange)
              // This preserves conditions, symbols, createdAt, notificationOptions, exchange, market, etc.
              return { alerts: state.alerts.map(a => a.id === alertUpdate.id ? { ...a, ...alertUpdate } : a) };
          }
          return { alerts: [alertUpdate, ...state.alerts] };
      });
  },

  // Remove alert from store (for auto-deleted price alerts)
  removeAlert: (id) => {
      set((state) => ({
          alerts: state.alerts.filter((a) => a.id !== id),
      }));
  }
}));
