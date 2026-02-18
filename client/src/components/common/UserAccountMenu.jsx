import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { User, Bell, CreditCard, LogOut, TrendingUp, Bot, List, Layers } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import UserAccountChip from './UserAccountChip';

const UserAccountMenu = ({ chipClassName = '', menuClassName = '' }) => {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
    navigate('/login');
  };

  const closeMenu = () => setUserMenuOpen(false);

  return (
    <div className="relative" ref={userMenuRef}>
      <UserAccountChip
        onClick={() => setUserMenuOpen((current) => !current)}
        className={chipClassName}
        aria-expanded={userMenuOpen}
        aria-haspopup="true"
      />

      {userMenuOpen && (
        <div className={[
          'absolute right-0 mt-2 w-56 rounded-lg border border-gray-600 bg-gray-800 shadow-lg py-1 z-50',
          menuClassName,
        ].join(' ').trim()}>
          <div className="px-4 py-2 border-b border-gray-700">
            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
          </div>

          <Link to="/account" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
            <User className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Account')}
          </Link>
          <Link to="/alerts" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
            <Bell className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Alerts')}
          </Link>
          <Link to="/listings" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
            <List className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Listings')}
          </Link>
          <Link to="/subscription" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
            <CreditCard className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Subscription')}
          </Link>
          <Link to="/wall-scanner" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
            <Layers className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Wall Scanner')}
          </Link>
          <Link to="/market" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
            <TrendingUp className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Market')}
          </Link>
          <Link to="/telegram-bots" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors">
            <Bot className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Telegram Bots')}
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700 hover:text-white transition-colors text-left"
          >
            <LogOut className="h-4 w-4 text-gray-400 shrink-0" />
            {t('Logout')}
          </button>
        </div>
      )}
    </div>
  );
};

export default UserAccountMenu;
