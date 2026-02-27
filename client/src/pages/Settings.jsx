import React from 'react';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon } from 'lucide-react';

const Settings = () => {
  const { t } = useTranslation();

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="h-6 w-6" style={{ color: '#2dd4bf' }} />
        <h1 className="text-2xl font-bold text-textPrimary">{t('Settings')}</h1>
      </div>
    </div>
  );
};

export default Settings;
