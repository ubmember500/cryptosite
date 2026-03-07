import React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Link } from 'react-router-dom';
import { TrendingUp, User, LogOut, LayoutGrid } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../../utils/cn';

const Sidebar = () => {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);

  const navItems = [
    { path: '/account', labelKey: 'Account', icon: User, iconColor: '#60a5fa' },
    { path: '/formations', labelKey: 'Formations', icon: LayoutGrid, iconColor: '#34d399' },
  ];

  return (
    <div className="hidden md:flex flex-col w-52 glass-strong border-r border-border/50">
      {/* Logo area */}
      <div className="flex items-center justify-center h-16 border-b border-border/50">
        <Link
          to="/market"
          className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
        >
          <div className="bg-accent/10 p-2 rounded-xl border border-accent/20 group-hover:bg-accent/20 group-hover:border-accent/30 group-hover:shadow-accent-glow transition-all duration-300">
            <TrendingUp className="h-5 w-5 text-accent" />
          </div>
          <span className="text-xl font-bold text-gradient-brand">
            {t('CryptoAlerts')}
          </span>
        </Link>
      </div>
      
      <div className="flex-1 flex flex-col overflow-y-auto py-5">
        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200',
                  isActive
                    ? 'bg-accent/10 text-accent border-l-2 border-accent shadow-sm'
                    : 'text-textSecondary hover:bg-surfaceHover/70 hover:text-textPrimary border-l-2 border-transparent'
                )
              }
            >
              <item.icon className="mr-3 h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110" style={{ color: item.iconColor }} />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="p-3 border-t border-border/50">
        <button
          onClick={logout}
          className="group flex items-center w-full px-3 py-2.5 text-sm font-medium text-textSecondary rounded-lg hover:bg-danger/10 hover:text-danger transition-all duration-200"
        >
          <LogOut className="mr-3 h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110" style={{ color: '#f87171' }} />
          {t('Logout')}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
