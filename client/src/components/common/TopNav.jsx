import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell, List, Layers, TrendingUp, LayoutGrid,
  Bot, CreditCard, BookOpen, Settings, BarChart3,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/alerts',        labelKey: 'Alerts',        icon: Bell,       color: '#fbbf24' },
  { path: '/listings',      labelKey: 'Listings',      icon: List,       color: '#34d399' },
  { path: '/wall-scanner',  labelKey: 'Wall Scanner',  icon: Layers,     color: '#fb923c' },
  { path: '/market',        labelKey: 'Market',        icon: TrendingUp, color: '#22d3ee' },
  { path: '/market-map',    labelKey: 'Market Map',    icon: LayoutGrid, color: '#a78bfa' },
  { path: '/telegram-bots', labelKey: 'Telegram',      icon: Bot,        color: '#38bdf8' },
  { path: '/subscription',  labelKey: 'Subscription',  icon: CreditCard, color: '#f472b6' },
  { path: '/instructions',  labelKey: 'User Guide',    icon: BookOpen,   color: '#e879f9' },
  { path: '/activity',      labelKey: 'Activity',      icon: BarChart3,  color: '#60a5fa' },
  { path: '/settings',      labelKey: 'Settings',      icon: Settings,   color: '#2dd4bf' },
];

/**
 * Horizontal center navigation bar — rendered inside the top header on every
 * page except /market-map (which is excluded by the caller).
 */
const TopNav = () => {
  const { t } = useTranslation();

  return (
    <nav className="flex items-center gap-0.5">
      {NAV_ITEMS.map(({ path, labelKey, icon: Icon, color }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            [
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-textSecondary hover:bg-surfaceHover hover:text-textPrimary',
            ].join(' ')
          }
        >
          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
};

export default TopNav;
