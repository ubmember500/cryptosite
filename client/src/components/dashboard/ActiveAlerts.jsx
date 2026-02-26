import React, { useEffect } from 'react';
import { useAlertStore } from '../../store/alertStore';
import Card from '../common/Card';
import Badge from '../common/Badge';
import { Bell, CheckCircle, Clock } from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';

const ActiveAlerts = () => {
  const { alerts, loading, fetchAlerts } = useAlertStore();

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const activeCount = alerts.filter((a) => a.status === 'active').length;
  const triggeredCount = alerts.filter((a) => a.status === 'triggered').length;
  const totalCount = alerts.length;

  if (loading) {
    return (
      <Card header="Active Alerts">
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card header="Active Alerts">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surfaceHover rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-textSecondary text-sm">Total Alerts</span>
            <Bell className="h-5 w-5 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-textPrimary">{totalCount}</div>
        </div>

        <div className="bg-surfaceHover rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-textSecondary text-sm">Active</span>
            <Clock className="h-5 w-5 text-yellow-400" />
          </div>
          <div className="text-2xl font-bold text-textPrimary">{activeCount}</div>
        </div>

        <div className="bg-surfaceHover rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-textSecondary text-sm">Triggered</span>
            <CheckCircle className="h-5 w-5 text-green-400" />
          </div>
          <div className="text-2xl font-bold text-textPrimary">{triggeredCount}</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-sm text-textSecondary mb-2">Recent Activity</div>
          <div className="space-y-2">
            {alerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-textPrimary truncate">
                  {alert.coinId} - {alert.condition}
                </span>
                <Badge variant={alert.status === 'active' ? 'active' : 'triggered'}>
                  {alert.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default ActiveAlerts;
