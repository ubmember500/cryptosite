import React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Link } from 'react-router-dom';
import { Bell, TrendingUp, User, LogOut, Bot, CreditCard, List, Layers, LayoutGrid, Settings, BookOpen } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../utils/cn';

const Sidebar = () => {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);

  const navItems = [
    { path: '/account',       labelKey: 'Account',       icon: User,       iconColor: '#60a5fa' }, // blue-400
    { path: '/alerts',        labelKey: 'Alerts',        icon: Bell,       iconColor: '#fbbf24' }, // amber-400
    { path: '/listings',      labelKey: 'Listings',      icon: List,       iconColor: '#34d399' }, // emerald-400
    { path: '/wall-scanner',  labelKey: 'Wall Scanner',  icon: Layers,     iconColor: '#fb923c' }, // orange-400
    { path: '/market',        labelKey: 'Market',        icon: TrendingUp, iconColor: '#22d3ee' }, // cyan-400
    { path: '/market-map',    labelKey: 'Market Map',    icon: LayoutGrid, iconColor: '#a78bfa' }, // violet-400
    { path: '/telegram-bots', labelKey: 'Telegram Bots', icon: Bot,        iconColor: '#38bdf8' }, // sky-400
    { path: '/subscription',  labelKey: 'Subscription',  icon: CreditCard, iconColor: '#f472b6' }, // pink-400
    { path: '/instructions',  labelKey: 'User Guide',    icon: BookOpen,   iconColor: '#e879f9' }, // fuchsia-400
    { path: '/settings',      labelKey: 'Settings',      icon: Settings,   iconColor: '#2dd4bf' }, // teal-400
  ];

  return (
    <div className="hidden md:flex flex-col w-64 bg-surface border-r border-border">
      <div className="flex items-center justify-center h-16 border-b border-border">
        <Link
          to="/market"
          className="group flex items-center gap-2.5 rounded px-1 py-1 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface"
        >
          <div className="bg-accent/10 p-1.5 rounded-lg border border-accent/20 group-hover:bg-accent/20 transition-colors">
            <TrendingUp className="h-5 w-5 text-accent" />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
            {t('CryptoAlerts')}
          </span>
        </Link>
      </div>
      
      <div className="flex-1 flex flex-col overflow-y-auto py-4">
        <nav className="flex-1 px-2 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors',
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-textSecondary hover:bg-surfaceHover hover:text-textPrimary'
                )
              }
            >
              <item.icon className="mr-3 h-5 w-5 shrink-0" style={{ color: item.iconColor }} />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-border space-y-2">
        <NavLink
          to="/listings"
          className={({ isActive }) =>
            cn(
              'flex items-center w-full px-4 py-2 text-sm font-medium rounded-md transition-colors',
              isActive ? 'bg-accent/10 text-accent' : 'text-textSecondary hover:bg-surfaceHover hover:text-textPrimary'
            )
          }
        >
          <List className="mr-3 h-5 w-5 shrink-0" style={{ color: '#34d399' }} />
          {t('Listings')}
        </NavLink>
        <button
          onClick={logout}
          className="flex items-center w-full px-4 py-2 text-sm font-medium text-textSecondary rounded-md hover:bg-surfaceHover hover:text-textPrimary transition-colors"
        >
          <LogOut className="mr-3 h-5 w-5 shrink-0" style={{ color: '#f87171' }} />
          {t('Logout')}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
