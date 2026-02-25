import { create } from 'zustand';
import { alertService } from '../services/alertService';

export const useAlertStore = create((set, get) => ({
  alerts: [],
  history: [],
  processedTriggerKeys: {},
  loading: false,
  error: null,
  pendingTriggerAlert: null,

  setPendingTriggerAlert: (alert) => set({ pendingTriggerAlert: alert }),
  clearPendingTriggerAlert: () => set({ pendingTriggerAlert: null }),

  /**
   * Fetch alerts with filters. filters: { status, exchange, market, type }
   */
  fetchAlerts: async (filters = {}) => {
    set({ loading: true, error: null });
    try {
      const { alerts, sweptTriggers } = await alertService.getAlerts(filters);
      set({ alerts: Array.isArray(alerts) ? alerts : [], loading: false });

      // Process sweep-detected triggers that may have been missed by the socket
      // (race condition: socket might not have joined the room yet when the sweep fired)
      if (Array.isArray(sweptTriggers) && sweptTriggers.length > 0) {
        for (const payload of sweptTriggers) {
          const applied = get().applyTriggeredEvent(payload);
          if (applied) {
            set({ pendingTriggerAlert: payload });
            // Only show the first one; user can dismiss and next fetch will show next if needed
            break;
          }
        }
      }
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },
  
  fetchHistory: async () => {
      set({ loading: true, error: null });
      try {
        const data = await alertService.getHistory();
        set({ history: Array.isArray(data) ? data : [], loading: false });
      } catch (error) {
        set({ error: error.message, loading: false });
      }
  },

  createAlert: async (alertData) => {
    set({ loading: true, error: null });
    try {
      const response = await alertService.createAlert(alertData);
      const newAlert = response?.alert ?? response;

      set((state) => {
        const isPriceImmediateTrigger = response?.immediateTrigger && newAlert?.alertType === 'price';
        if (isPriceImmediateTrigger) {
          const nextHistory = [newAlert, ...state.history.filter((item) => item.id !== newAlert.id)];
          return {
            history: nextHistory,
            alerts: state.alerts.filter((a) => a.id !== newAlert.id),
            loading: false,
          };
        }

        return {
          alerts: [newAlert, ...state.alerts.filter((a) => a.id !== newAlert.id)],
          loading: false,
        };
      });
      return response;
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

  applyTriggeredEvent: (payload) => {
    const alertId = payload?.id || payload?.alertId;
    if (!alertId) return false;

    const triggeredAtRaw = payload?.triggeredAt ? new Date(payload.triggeredAt).toISOString() : 'na';
    const dedupeKey = `${alertId}:${triggeredAtRaw}`;
    let applied = false;

    set((state) => {
      if (state.processedTriggerKeys[dedupeKey]) {
        return state;
      }

      const baseAlert = state.alerts.find((a) => a.id === alertId) || state.history.find((a) => a.id === alertId) || {};
      const mergedAlert = {
        ...baseAlert,
        ...payload,
        id: alertId,
        alertId,
        triggered: true,
        triggeredAt: payload?.triggeredAt || new Date().toISOString(),
      };

      const isPrice = (mergedAlert.alertType || '').toLowerCase() === 'price';
      const nextAlerts = isPrice
        ? state.alerts.filter((a) => a.id !== alertId)
        : state.alerts.map((a) => (a.id === alertId ? { ...a, ...mergedAlert, isActive: true } : a));

      const existingHistoryIndex = state.history.findIndex((item) => item.id === alertId);
      const nextHistory = existingHistoryIndex >= 0
        ? state.history.map((item) => (item.id === alertId ? { ...item, ...mergedAlert } : item))
        : [mergedAlert, ...state.history];

      applied = true;
      return {
        alerts: nextAlerts,
        history: nextHistory,
        processedTriggerKeys: {
          ...state.processedTriggerKeys,
          [dedupeKey]: true,
        },
      };
    });

    return applied;
  },

  // Remove alert from store (for auto-deleted price alerts)
  removeAlert: (id) => {
      set((state) => ({
          alerts: state.alerts.filter((a) => a.id !== id),
      }));
  }
}));
