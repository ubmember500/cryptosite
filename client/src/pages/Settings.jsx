import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon } from 'lucide-react';
import Tabs from '../components/common/Tabs';
import Card from '../components/common/Card';
import ThemeCard from '../components/common/ThemeCard';
import { useThemeStore } from '../store/themeStore';
import { THEME_DEFINITIONS } from '../config/themes';
import usePageTitle from '../hooks/usePageTitle';

const Settings = () => {
  usePageTitle('Settings');
  const { t } = useTranslation();
  const currentTheme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [themeFilter, setThemeFilter] = useState('all');

  const tabs = useMemo(
    () => [
      { id: 'all', label: t('Theme filter all') },
      { id: 'dark', label: t('Theme filter dark') },
      { id: 'light', label: t('Theme filter light') },
    ],
    [t]
  );

  const filteredThemes = useMemo(() => {
    if (themeFilter === 'all') {
      return THEME_DEFINITIONS;
    }
    return THEME_DEFINITIONS.filter((theme) => theme.category === themeFilter);
  }, [themeFilter]);

  const getStyleLabel = (style) => {
    if (style === 'tech') return t('Theme style tech');
    if (style === 'bold') return t('Theme style bold');
    return t('Theme style professional');
  };

  const getCategoryLabel = (category) => {
    return category === 'dark' ? t('Theme filter dark') : t('Theme filter light');
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-teal-500/10 p-2 rounded-xl border border-teal-500/20">
          <SettingsIcon className="h-5 w-5" style={{ color: '#2dd4bf' }} />
        </div>
        <h1 className="text-2xl font-bold text-textPrimary tracking-tight">{t('Settings')}</h1>
      </div>

      <Card>
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-textPrimary">{t('Themes')}</h2>
          <p className="mt-1 text-sm text-textSecondary/80">{t('Themes subtitle')}</p>
        </div>

        <Tabs tabs={tabs} activeTab={themeFilter} onChange={setThemeFilter} className="mb-6 max-w-sm" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              isActive={currentTheme === theme.id}
              onSelect={setTheme}
              styleLabel={getStyleLabel(theme.style)}
              categoryLabel={getCategoryLabel(theme.category)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
};

export default Settings;
