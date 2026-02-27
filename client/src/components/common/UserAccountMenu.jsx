import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { User, Bell, CreditCard, LogOut, TrendingUp, Bot, List, Layers, LayoutGrid } from 'lucide-react';
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
          'absolute right-0 mt-2 w-56 rounded-lg border border-border bg-surface shadow-lg py-1 z-50',
          menuClassName,
        ].join(' ').trim()}>
          <div className="px-4 py-2 border-b border-border">
            <p className="text-xs text-textSecondary truncate">{user?.email}</p>
          </div>

          <Link to="/account" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <User className="h-4 w-4 shrink-0" style={{ color: '#60a5fa' }} />
            {t('Account')}
          </Link>
          <Link to="/alerts" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <Bell className="h-4 w-4 shrink-0" style={{ color: '#fbbf24' }} />
            {t('Alerts')}
          </Link>
          <Link to="/listings" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <List className="h-4 w-4 shrink-0" style={{ color: '#34d399' }} />
            {t('Listings')}
          </Link>
          <Link to="/wall-scanner" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <Layers className="h-4 w-4 shrink-0" style={{ color: '#fb923c' }} />
            {t('Wall Scanner')}
          </Link>
          <Link to="/market" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <TrendingUp className="h-4 w-4 shrink-0" style={{ color: '#22d3ee' }} />
            {t('Market')}
          </Link>
          <Link to="/market-map" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <LayoutGrid className="h-4 w-4 shrink-0" style={{ color: '#a78bfa' }} />
            {t('Market Map')}
          </Link>
          <Link to="/telegram-bots" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <Bot className="h-4 w-4 shrink-0" style={{ color: '#38bdf8' }} />
            {t('Telegram Bots')}
          </Link>
          <Link to="/subscription" onClick={closeMenu} className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors">
            <CreditCard className="h-4 w-4 shrink-0" style={{ color: '#f472b6' }} />
            {t('Subscription')}
          </Link>
          <a
            href="https://t.me/ManagerAlan"
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="#229ED9" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.93l-2.956-.924c-.64-.203-.654-.64.136-.95l11.57-4.461c.537-.194 1.006.131.974.626z"/>
            </svg>
            {t('Support')}
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-textPrimary hover:bg-surfaceHover transition-colors text-left"
          >
            <LogOut className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
            {t('Logout')}
          </button>
        </div>
      )}
    </div>
  );
};

export default UserAccountMenu;
