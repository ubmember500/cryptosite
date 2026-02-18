import React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Link } from 'react-router-dom';
import { Bell, TrendingUp, User, LogOut, Bot, CreditCard, List, Layers } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../utils/cn';

const Sidebar = () => {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);

  const navItems = [
    { path: '/account', labelKey: 'Account', icon: User },
    { path: '/alerts', labelKey: 'Alerts', icon: Bell },
    { path: '/listings', labelKey: 'Listings', icon: List },
    { path: '/wall-scanner', labelKey: 'Wall Scanner', icon: Layers },
    { path: '/market', labelKey: 'Market', icon: TrendingUp },
    { path: '/telegram-bots', labelKey: 'Telegram Bots', icon: Bot },
    { path: '/subscription', labelKey: 'Subscription', icon: CreditCard },
  ];

  return (
    <div className="hidden md:flex flex-col w-64 bg-gray-800 border-r border-gray-700">
      <div className="flex items-center justify-center h-16 border-b border-gray-700">
        <Link
          to="/market"
          className="group flex items-center gap-2.5 rounded px-1 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        >
          <div className="bg-blue-500/10 p-1.5 rounded-lg border border-blue-500/20 group-hover:bg-blue-500/20 transition-colors">
            <TrendingUp className="h-5 w-5 text-blue-400" />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
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
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                )
              }
            >
              <item.icon className="mr-3 h-5 w-5" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-gray-700 space-y-2">
        <NavLink
          to="/listings"
          className={({ isActive }) =>
            cn(
              'flex items-center w-full px-4 py-2 text-sm font-medium rounded-md transition-colors',
              isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            )
          }
        >
          <List className="mr-3 h-5 w-5" />
          {t('Listings')}
        </NavLink>
        <button
          onClick={logout}
          className="flex items-center w-full px-4 py-2 text-sm font-medium text-gray-300 rounded-md hover:bg-gray-700 hover:text-white transition-colors"
        >
          <LogOut className="mr-3 h-5 w-5" />
          {t('Logout')}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
