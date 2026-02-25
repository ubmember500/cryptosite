import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import AlertsTable from '../components/alerts/AlertsTable';
import AlertsFilter from '../components/alerts/AlertsFilter';
import CreateAlertModal from '../components/alerts/CreateAlertModal';
import Button from '../components/common/Button';
import { Plus, Trash2 } from 'lucide-react';
import { useAlertStore } from '../store/alertStore';

const Alerts = () => {
  const { t } = useTranslation();

  const { alerts, loading, fetchAlerts, deleteAlert, toggleAlert } = useAlertStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [filters, setFilters] = useState({ status: 'active', exchange: 'all', market: 'all', type: 'all' });

  const editingAlert = editingAlertId ? (alerts.find((a) => a.id === editingAlertId) ?? null) : null;

  useEffect(() => {
    fetchAlerts(filters);
  }, [filters, fetchAlerts]);

  const handleFilterChange = (category, value) => {
    setFilters((prev) => ({ ...prev, [category]: value }));
  };

  const handleCreateClick = () => {
    setEditingAlertId(null);
    setIsModalOpen(true);
  };

  const handleEdit = (row) => {
    setEditingAlertId(row.id);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingAlertId(null);
  };

  const handleSuccess = () => {
    handleCloseModal();
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('Delete this alert?'))) return;
    try {
      await deleteAlert(id);
      setSelectedIds((prev) => prev.filter((sid) => sid !== id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleToggle = async (id) => {
    try {
      await toggleAlert(id);
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(t('Delete {{count}} selected alerts?', { count: selectedIds.length }))) return;
    try {
      await Promise.all(selectedIds.map((id) => deleteAlert(id)));
      setSelectedIds([]);
    } catch (err) {
      console.error('Bulk delete failed:', err);
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

      {/* Filters */}
      <AlertsFilter filters={filters} onFilterChange={handleFilterChange} />

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
