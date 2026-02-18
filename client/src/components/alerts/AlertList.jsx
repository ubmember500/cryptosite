import React, { useEffect } from 'react';
import { useAlertStore } from '../../store/alertStore';
import AlertCard from './AlertCard';
import LoadingSpinner from '../common/LoadingSpinner';

const AlertList = ({ onEdit, onDelete, onToggle, alerts: alertsProp, loading: loadingProp }) => {
  const storeAlerts = useAlertStore((state) => state.alerts);
  const storeLoading = useAlertStore((state) => state.loading);
  const fetchAlerts = useAlertStore((state) => state.fetchAlerts);

  const alerts = alertsProp ?? storeAlerts;
  const loading = loadingProp ?? storeLoading;

  useEffect(() => {
    if (alertsProp == null) {
      fetchAlerts({});
    }
  }, [fetchAlerts, alertsProp]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {alerts.length === 0 ? (
        <div className="text-center py-12 bg-gray-800 border border-gray-700 rounded-lg">
          <p className="text-gray-400">No alerts created yet.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AlertList;
