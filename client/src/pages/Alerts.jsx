import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AlertsTable from '../components/alerts/AlertsTable';
import CreateAlertModal from '../components/alerts/CreateAlertModal';
import Button from '../components/common/Button';
import { Plus, Trash2 } from 'lucide-react';

const Alerts = () => {
  const { t } = useTranslation();

  const alerts = [];
  const loading = false;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  const editingAlert = null;

  const handleCreateClick = () => {
    setEditingAlertId(null);
    setIsModalOpen(true);
  };

  const handleEdit = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingAlertId(null);
  };

  const handleSuccess = () => {
    handleCloseModal();
  };

  const handleDelete = () => {};

  const handleToggle = () => {};

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    setSelectedIds([]);
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
