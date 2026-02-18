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
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Total Alerts</span>
            <Bell className="h-5 w-5 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-gray-200">{totalCount}</div>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Active</span>
            <Clock className="h-5 w-5 text-yellow-400" />
          </div>
          <div className="text-2xl font-bold text-gray-200">{activeCount}</div>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Triggered</span>
            <CheckCircle className="h-5 w-5 text-green-400" />
          </div>
          <div className="text-2xl font-bold text-gray-200">{triggeredCount}</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="text-sm text-gray-400 mb-2">Recent Activity</div>
          <div className="space-y-2">
            {alerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-gray-300 truncate">
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
