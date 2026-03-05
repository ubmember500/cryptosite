import React from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import usePageTitle from '../hooks/usePageTitle';

const Formations = () => {
  usePageTitle('Formations');
  const { t } = useTranslation();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-textPrimary">{t('Formations')}</h1>
        <p className="text-textSecondary mt-1">
          {t('Your personal chart list — add, remove and swap pairs any time you want.')}
        </p>
      </div>

      {/* Placeholder content */}
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-textSecondary border border-dashed border-border rounded-xl">
        <LayoutGrid className="h-12 w-12 opacity-30" />
        <p className="text-lg font-medium opacity-50">{t('No formations yet')}</p>
        <p className="text-sm opacity-40">{t('Charts you add will appear here.')}</p>
      </div>
    </div>
  );
};

export default Formations;
