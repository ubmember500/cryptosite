import React from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@headlessui/react';
import { Edit, Trash2, BellOff, PlusCircle } from 'lucide-react';
import { cn } from '../../utils/cn';
import Table from '../common/Table';
import LoadingSpinner from '../common/LoadingSpinner';
import Badge from '../common/Badge';

const AlertsTable = ({
  alerts = [],
  loading = false,
  onToggleStatus,
  onEditAlert,
  onDeleteAlert,
  onCreateClick,
  className,
  selectedIds = [],
  onSelectChange,
}) => {
  const { t } = useTranslation();
  const allSelected = alerts.length > 0 && selectedIds.length === alerts.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < alerts.length;

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      onSelectChange?.(alerts.map((a) => a.id));
    } else {
      onSelectChange?.([]);
    }
  };

  const handleSelectOne = (id, checked) => {
    if (checked) {
      onSelectChange?.([...selectedIds, id]);
    } else {
      onSelectChange?.(selectedIds.filter((selectedId) => selectedId !== id));
    }
  };

  const columns = [
    {
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={allSelected}
          ref={(input) => {
            if (input) input.indeterminate = someSelected;
          }}
          onChange={handleSelectAll}
          className="h-4 w-4 text-accent bg-surface border-border rounded focus:ring-accent cursor-pointer"
          aria-label={t('Select all alerts')}
        />
      ),
      render: (text, row) => (
        <input
          type="checkbox"
          checked={selectedIds.includes(row.id)}
          onChange={(e) => handleSelectOne(row.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 text-accent bg-surface border-border rounded focus:ring-accent cursor-pointer"
          aria-label={t('Select alert {{name}}', { name: row.name || row.id })}
        />
      ),
    },
    { key: 'name', label: t('Alert name'), sortable: true },
    { key: 'exchange', label: t('Exchange'), sortable: true },
    { key: 'market', label: t('Market'), sortable: true },
    { 
      key: 'type', 
      label: t('Type'), 
      sortable: true,
      render: (type, row) => (
        <div className="flex items-center gap-2">
          <Badge variant="active">
            {type === 'price' ? t('Price') : t('Complex')}
          </Badge>
          {row.triggered && (
            <div className="flex flex-col items-start">
              <Badge variant="success" className="mb-0.5">
                {t('Triggered')}
              </Badge>
              {row.triggeredAt && (
                <span className="text-textSecondary text-xs">
                  {new Date(row.triggeredAt).toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>
      ),
    },
    { 
      key: 'description', 
      label: t('Description'), 
      render: (description, row) => {
        // Enhanced description for price alerts showing monitoring direction
        let displayDescription = description;
        if (row.alertType === 'price' && row.initialPrice != null && row.targetValue != null) {
          const init = Number(row.initialPrice);
          const tgt = Number(row.targetValue);
          if (Number.isFinite(init) && Number.isFinite(tgt)) {
            const tStr = tgt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
            const iStr = init.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
            if (row.condition === 'below') {
              displayDescription = t('Monitoring drop to {{target}} (initial {{initial}})', { target: tStr, initial: iStr });
            } else if (row.condition === 'above') {
              displayDescription = t('Monitoring rise to {{target}} (initial {{initial}})', { target: tStr, initial: iStr });
            }
          }
        }
        
        return (
          <div className="flex flex-col items-start">
            <span className="text-textSecondary text-sm line-clamp-1" title={displayDescription || description}>
              {displayDescription || description}
            </span>
            {row.triggered && row.alertType === 'complex' && (row.triggeringSymbol || row.symbol) && row.pctChange != null && (
              <span className="text-textSecondary text-xs mt-1">
                {t('Triggered by {{symbol}}: {{pct}}%', { symbol: row.triggeringSymbol || row.symbol, pct: Number(row.pctChange).toFixed(2) })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'isActive',
      label: t('Mode'),
      // For triggered complex alerts, isActive should remain true (toggle stays ON)
      render: (isActive, row) => (
        <Switch
          checked={isActive}
          onChange={() => onToggleStatus(row.id)}
          className={cn(
            isActive ? 'bg-accent' : 'bg-surfaceHover',
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background'
          )}
        >
          <span className="sr-only">{t('Enable notifications')}</span>
          <span
            className={cn(
              isActive ? 'translate-x-6' : 'translate-x-1',
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform'
            )}
          />
        </Switch>
      ),
    },
    {
      key: 'actions',
      label: t('Actions'),
      render: (text, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEditAlert(row)}
            className="text-textSecondary hover:text-accent transition-colors"
            title={t('Edit alert')}
            aria-label={t('Edit alert')}
          >
            <Edit size={18} />
          </button>
          <button
            onClick={() => onDeleteAlert(row.id)}
            className="text-textSecondary hover:text-danger transition-colors"
            title={t('Delete alert')}
            aria-label={t('Delete alert')}
          >
            <Trash2 size={18} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64 bg-surface rounded-xl border border-border">
        <LoadingSpinner size="lg" />
        <p className="ml-4 text-textSecondary">{t('Loading alerts...')}</p>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-surface rounded-xl border border-border p-4 text-center">
        <BellOff size={48} className="text-textSecondary mb-4" />
        <h3 className="text-lg font-semibold text-textPrimary mb-2">{t('No alerts yet')}</h3>
        <p className="text-textSecondary text-sm mb-4">{t('Create your first alert to get notified when prices hit your targets.')}</p>
        {onCreateClick ? (
          <button
            type="button"
            onClick={onCreateClick}
            className="inline-flex items-center gap-2 text-accent hover:text-accent/80 font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            <PlusCircle size={16} /> {t('Create new alert')}
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 text-textSecondary text-sm">
            <PlusCircle size={16} /> {t('Use the button above to create one.')}
          </span>
        )}
      </div>
    );
  }

  // Normalize for table: support both type and alertType, name fallback
  // All other fields (exchange, market, triggered, triggeredAt, isActive, etc.) are preserved via spread
  const tableData = alerts.map((a) => ({
    ...a,
    type: a.type ?? a.alertType ?? 'price',
    name: a.name ?? a.coinSymbol ?? a.coinId ?? '—',
    description: a.description ?? '',
    // Ensure exchange and market are preserved (for complex alerts)
    exchange: a.exchange ?? a.exchanges?.[0] ?? '—',
    market: a.market ?? '—',
  }));

  return (
    <div className={cn("bg-surface rounded-xl border border-border", className)}>
      <Table
        columns={columns}
        data={tableData}
        onRowClick={(row) => console.log('Alert clicked:', row)}
      />
    </div>
  );
};

export default AlertsTable;
