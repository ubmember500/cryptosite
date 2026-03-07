import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { watchlistService } from '../services/watchlistService';
import { alertService } from '../services/alertService';
import Card from '../components/common/Card';
import { ROUTES } from '../utils/constants';
import { User, Mail, Calendar, Bell, Star, CreditCard, LayoutGrid } from 'lucide-react';
import usePageTitle from '../hooks/usePageTitle';

const Account = () => {
  usePageTitle('Account');
  const { t, i18n } = useTranslation();
  const user = useAuthStore((state) => state.user);

  const [watchlistCount, setWatchlistCount] = useState(0);
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);
  const dateLocale = i18n.language === 'ru' ? 'ru-RU' : 'en';

  useEffect(() => {
    let cancelled = false;
    const loadActiveAlertsCount = async () => {
      try {
        const list = await alertService.getAlerts({ status: 'active' });
        if (!cancelled) setActiveAlertsCount(Array.isArray(list) ? list.length : 0);
      } catch (error) {
        if (!cancelled) setActiveAlertsCount(0);
      }
    };
    loadActiveAlertsCount();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadWatchlistCount = async () => {
      try {
        const data = await watchlistService.getWatchlist();
        const list = data.watchlist || [];
        if (!cancelled) setWatchlistCount(list.length);
      } catch (error) {
        if (!cancelled) setWatchlistCount(0);
      }
    };
    loadWatchlistCount();
    return () => { cancelled = true; };
  }, []);
  const subscriptionLabel =
    user?.subscriptionPlan === 'pro'
      ? t('Pro')
      : user?.subscriptionPlan === 'lite'
        ? t('Lite')
        : t('Free');
  const createdAt = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(dateLocale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-2xl font-bold text-textPrimary tracking-tight">
          {t('Welcome back, {{name}}!', { name: user?.username || t('User') })}
        </h1>
        <p className="text-textSecondary/80 mt-1 text-sm">{t("Here's your account overview.")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Account Information Card */}
        <Card header={t('Account information')}>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500/10 p-1.5 rounded-lg">
                <User className="h-4 w-4 text-blue-400 flex-shrink-0" />
              </div>
              <div>
                <p className="text-xs text-textSecondary/70 uppercase tracking-wider">{t('Username')}</p>
                <p className="text-textPrimary font-medium">{user?.username || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="bg-cyan-500/10 p-1.5 rounded-lg">
                <Mail className="h-4 w-4 text-cyan-400 flex-shrink-0" />
              </div>
              <div>
                <p className="text-xs text-textSecondary/70 uppercase tracking-wider">{t('Email')}</p>
                <p className="text-textPrimary font-medium">{user?.email || '—'}</p>
              </div>
            </div>
            {createdAt && (
              <div className="flex items-center gap-3">
                <div className="bg-purple-500/10 p-1.5 rounded-lg">
                  <Calendar className="h-4 w-4 text-purple-400 flex-shrink-0" />
                </div>
                <div>
                  <p className="text-xs text-textSecondary/70 uppercase tracking-wider">{t('Member since')}</p>
                  <p className="text-textPrimary font-medium">{createdAt}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="bg-pink-500/10 p-1.5 rounded-lg">
                <CreditCard className="h-4 w-4 text-pink-400 flex-shrink-0" />
              </div>
              <div>
                <p className="text-xs text-textSecondary/70 uppercase tracking-wider">{t('Subscription')}</p>
                <p className="text-textPrimary font-medium">{subscriptionLabel}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Quick Stats Card */}
        <Card header={t('Quick stats')}>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-surfaceHover/40 rounded-xl border border-border/30 transition-colors hover:bg-surfaceHover/60">
              <div className="flex items-center gap-3">
                <div className="bg-amber-500/10 p-1.5 rounded-lg">
                  <Bell className="h-4 w-4" style={{ color: '#fbbf24' }} />
                </div>
                <span className="text-textPrimary text-sm">{t('Active alerts')}</span>
              </div>
              <span className="text-xl font-bold text-textPrimary">{activeAlertsCount}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-surfaceHover/40 rounded-xl border border-border/30 transition-colors hover:bg-surfaceHover/60">
              <div className="flex items-center gap-3">
                <div className="bg-violet-500/10 p-1.5 rounded-lg">
                  <Star className="h-4 w-4" style={{ color: '#a78bfa' }} />
                </div>
                <span className="text-textPrimary text-sm">{t('Watchlist items')}</span>
              </div>
              <span className="text-xl font-bold text-textPrimary">{watchlistCount}</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border/40 flex flex-col sm:flex-row gap-4">
            <Link
              to={ROUTES.ALERTS}
              className="text-sm text-accent hover:text-accent/80 transition-colors font-medium"
            >
              {t('Manage alerts')}
            </Link>
            <Link
              to={ROUTES.MARKET}
              className="text-sm text-accent hover:text-accent/80 transition-colors font-medium"
            >
              {t('Market')}
            </Link>
            <Link
              to={ROUTES.FORMATIONS}
              className="text-sm text-accent hover:text-accent/80 transition-colors font-medium"
            >
              {t('Formations')}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Account;
