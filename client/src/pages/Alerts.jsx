import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import AlertsTable from '../components/alerts/AlertsTable';
import CreateAlertModal from '../components/alerts/CreateAlertModal';
import Button from '../components/common/Button';
import { useAlertStore } from '../store/alertStore';
import { useToastStore } from '../store/toastStore';
import { Plus, Trash2 } from 'lucide-react';

const Alerts = () => {
  const { t } = useTranslation();
  const { alerts, loading, fetchAlerts, deleteAlert, toggleAlert } = useAlertStore();
  const addToast = useToastStore((state) => state.addToast);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  const editingAlert = editingAlertId != null ? alerts.find((a) => a.id === editingAlertId) ?? null : null;

  useEffect(() => {
    fetchAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateClick = () => {
    setEditingAlertId(null);
    setIsModalOpen(true);
  };

  const handleEdit = (alert) => {
    setEditingAlertId(alert.id);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingAlertId(null);
  };

  const handleSuccess = () => {
    handleCloseModal();
    fetchAlerts();
  };

  const handleDelete = async (id) => {
    const alert = alerts.find((a) => a.id === id);
    const alertName = alert?.name || 'this alert';
    
    if (window.confirm(t('Are you sure you want to delete "{{name}}"? This action cannot be undone.', { name: alertName }))) {
      try {
        await deleteAlert(id);
        addToast(t('Alert "{{name}}" deleted successfully', { name: alertName }), 'success');
      } catch (error) {
        addToast(error.message || t('Failed to delete alert'), 'error');
        console.error('Failed to delete alert:', error);
      }
    }
  };

  const handleToggle = async (id) => {
    try {
      const alert = alerts.find((a) => a.id === id);
      await toggleAlert(id);
      const newStatus = alert?.isActive ? 'deactivated' : 'activated';
      addToast(t('Alert {{status}} successfully', { status: t(newStatus) }), 'success');
    } catch (error) {
      addToast(error.message || t('Failed to toggle alert'), 'error');
      console.error('Failed to toggle alert:', error);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    
    const count = selectedIds.length;
    if (window.confirm(t('Are you sure you want to delete {{count}} alerts? This action cannot be undone.', { count }))) {
      try {
        await Promise.all(selectedIds.map(id => deleteAlert(id)));
        setSelectedIds([]);
        addToast(t('{{count}} alerts deleted successfully', { count }), 'success');
      } catch (error) {
        addToast(error.message || t('Failed to delete alerts'), 'error');
        console.error('Failed to delete alerts:', error);
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-textPrimary">{t('Alerts')}</h1>
          <p className="text-textSecondary mt-1">{t('Create alerts in order: exchange → market → coin → target. Triggers on first hit since creation.')}</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.length > 0 && (
            <Button
              variant="danger"
              onClick={handleBulkDelete}
              className="flex items-center gap-2"
            >
              <Trash2 size={18} />
              {t('Delete')} ({selectedIds.length})
            </Button>
          )}
          <Button
            variant="primary"
            onClick={handleCreateClick}
            className="flex items-center gap-2"
          >
            <Plus size={18} />
            {t('Create Alert')}
          </Button>
        </div>
      </div>

      {/* Alerts Table */}
      <AlertsTable
        alerts={alerts}
        loading={loading}
        onToggleStatus={handleToggle}
        onEditAlert={handleEdit}
        onDeleteAlert={handleDelete}
        onCreateClick={handleCreateClick}
        selectedIds={selectedIds}
        onSelectChange={setSelectedIds}
      />

      {/* Create/Edit Modal */}
      <CreateAlertModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleSuccess}
        editingAlertId={editingAlertId}
        editingAlert={editingAlert}
      />
    </div>
  );
};

export default Alerts;
