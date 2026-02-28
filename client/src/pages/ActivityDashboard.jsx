import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, MousePointerClick, Users, UserCheck, RefreshCw, KeyRound, CalendarDays, PanelTop } from 'lucide-react';
import Card from '../components/common/Card';
import api from '../services/api';

const SECRET_STORAGE_KEY = 'activity-admin-secret';

const formatDay = (value, lang) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const MetricCard = ({ icon: Icon, title, value, note, color }) => (
  <Card className="h-full">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-textSecondary">{title}</p>
        <p className="mt-2 text-2xl font-semibold text-textPrimary">{value}</p>
        {note ? <p className="mt-1 text-xs text-textSecondary">{note}</p> : null}
      </div>
      <div className="rounded-lg bg-surfaceHover p-2 border border-border">
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
    </div>
  </Card>
);

const ActivityDashboard = () => {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(7);
  const [secret, setSecret] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SECRET_STORAGE_KEY);
      if (stored) setSecret(stored);
    } catch {
      // ignore
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    if (!secret.trim()) {
      setError(t('Enter activity admin secret to load analytics.'));
      setSummary(null);
      return;
    }

    setLoading(true);
    setError('');

    try {
      try {
        localStorage.setItem(SECRET_STORAGE_KEY, secret.trim());
      } catch {
        // ignore
      }

      const { data } = await api.get('/activity/summary', {
        params: {
          days,
          secret: secret.trim(),
        },
      });

      setSummary(data);
    } catch (err) {
      setSummary(null);
      setError(err?.response?.data?.error || t('Failed to load analytics summary.'));
    } finally {
      setLoading(false);
    }
  }, [days, secret, t]);

  useEffect(() => {
    if (!secret.trim()) return;
    fetchSummary();
  }, [days, fetchSummary, secret]);

  const metrics = useMemo(() => {
    const safe = summary || {};
    return [
      {
        key: 'registeredUsers',
        title: t('Registered users'),
        value: safe.registeredUsers ?? 0,
        note: t('All account owners in database'),
        icon: Users,
        color: '#60a5fa',
      },
      {
        key: 'loggedOnUsersToday',
        title: t('Logged-in users today'),
        value: safe.loggedOnUsersToday ?? 0,
        note: t('Registered users who logged in today'),
        icon: UserCheck,
        color: '#34d399',
      },
      {
        key: 'clicksToday',
        title: t('Clicks today'),
        value: safe.clicksToday ?? 0,
        note: t('All tracked click interactions today'),
        icon: MousePointerClick,
        color: '#f59e0b',
      },
      {
        key: 'uniqueVisitorsToday',
        title: t('Unique visitors today'),
        value: safe.uniqueVisitorsToday ?? 0,
        note: t('Unique website sessions today'),
        icon: BarChart3,
        color: '#a78bfa',
      },
    ];
  }, [summary, t]);

  const daily = Array.isArray(summary?.daily) ? summary.daily : [];
  const topPages = Array.isArray(summary?.topPages) ? summary.topPages : [];
  const topElements = Array.isArray(summary?.topElements) ? summary.topElements : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-textPrimary">{t('Website Activity')}</h1>
          <p className="mt-1 text-sm text-textSecondary">
            {t('Clear view of visitors, logins, clicks, and daily usage trends.')}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative">
            <KeyRound className="h-4 w-4 text-textSecondary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={t('Activity admin secret')}
              className="w-full sm:w-72 pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-textPrimary placeholder-textSecondary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-border bg-surface text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value={7}>7 {t('days')}</option>
            <option value={14}>14 {t('days')}</option>
            <option value={30}>30 {t('days')}</option>
            <option value={90}>90 {t('days')}</option>
          </select>

          <button
            type="button"
            onClick={fetchSummary}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? t('Loading...') : t('Refresh')}
          </button>
        </div>
      </div>

      {error ? (
        <Card>
          <p className="text-sm text-red-400">{error}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((item) => (
          <MetricCard
            key={item.key}
            icon={item.icon}
            title={item.title}
            value={item.value}
            note={item.note}
            color={item.color}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card
          header={
            <div className="flex items-center gap-2 text-textPrimary">
              <PanelTop className="h-5 w-5" style={{ color: '#22d3ee' }} />
              <span className="font-semibold">{t('What users opened')}</span>
            </div>
          }
        >
          {topPages.length === 0 ? (
            <p className="text-sm text-textSecondary">{t('No page data yet.')}</p>
          ) : (
            <div className="space-y-2">
              {topPages.map((row) => (
                <div key={row.pagePath} className="flex items-center justify-between p-3 rounded-lg bg-surfaceHover border border-border">
                  <span className="text-sm text-textPrimary truncate max-w-[70%]">{row.pagePath}</span>
                  <span className="text-sm font-medium text-textPrimary">{row.views}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          header={
            <div className="flex items-center gap-2 text-textPrimary">
              <MousePointerClick className="h-5 w-5" style={{ color: '#f59e0b' }} />
              <span className="font-semibold">{t('What they used')}</span>
            </div>
          }
        >
          {topElements.length === 0 ? (
            <p className="text-sm text-textSecondary">{t('No click element data yet.')}</p>
          ) : (
            <div className="space-y-2">
              {topElements.map((row) => (
                <div key={row.element} className="flex items-center justify-between p-3 rounded-lg bg-surfaceHover border border-border">
                  <span className="text-sm text-textPrimary">{row.element || 'unknown'}</span>
                  <span className="text-sm font-medium text-textPrimary">{row.clicks}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        header={
          <div className="flex items-center gap-2 text-textPrimary">
            <CalendarDays className="h-5 w-5" style={{ color: '#a78bfa' }} />
            <span className="font-semibold">{t('Visitors per day')}</span>
          </div>
        }
      >
        {daily.length === 0 ? (
          <p className="text-sm text-textSecondary">{t('No daily statistics yet.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-textSecondary border-b border-border">
                  <th className="py-2 pr-4">{t('Day')}</th>
                  <th className="py-2 pr-4">{t('Visitors')}</th>
                  <th className="py-2 pr-4">{t('Logged users')}</th>
                  <th className="py-2 pr-4">{t('Page views')}</th>
                  <th className="py-2 pr-4">{t('Clicks')}</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((row) => (
                  <tr key={row.day} className="border-b border-border/60 text-textPrimary">
                    <td className="py-2 pr-4">{formatDay(row.day, i18n.language)}</td>
                    <td className="py-2 pr-4 font-medium">{row.uniqueVisitors ?? 0}</td>
                    <td className="py-2 pr-4">{row.uniqueUsers ?? 0}</td>
                    <td className="py-2 pr-4">{row.pageViewCount ?? 0}</td>
                    <td className="py-2 pr-4">{row.clickCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ActivityDashboard;
