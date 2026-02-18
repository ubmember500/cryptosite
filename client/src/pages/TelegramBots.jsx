import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, ListFilter, Power, Settings, Send, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { telegramService } from '../services/telegramService';

const TelegramBots = () => {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const fetchUser = useAuthStore((state) => state.fetchUser);
  const addToast = useToastStore((state) => state.addToast);

  const alertBotConnected = !!user?.telegramChatId || !!user?.telegramConnectedAt;

  const [connectLoading, setConnectLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [connectError, setConnectError] = useState(null);

  const handleConnectAlertBot = useCallback(async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const { connectLink } = await telegramService.getConnectLink();
      if (connectLink) {
        window.location.href = connectLink;
      } else {
        setConnectError(t('Failed to get connect link'));
      }
    } catch (err) {
      const data = err.response?.data;
      const is503 = err.response?.status === 503;
      let message = err.message || t('Error getting link');
      if (is503 || data?.error) {
        message = data?.error || message;
        if (data?.hint) message += ' ' + data.hint;
      }
      setConnectError(message);
    } finally {
      setConnectLoading(false);
    }
  }, [addToast, t]);

  const handleDisconnectAlertBot = useCallback(async () => {
    setDisconnectLoading(true);
    try {
      await telegramService.disconnectTelegram();
      await fetchUser();
      addToast(t('Telegram disconnected'), 'success');
    } catch (err) {
      addToast(err.response?.data?.error || err.message || t('Error disconnecting'), 'error');
    } finally {
      setDisconnectLoading(false);
    }
  }, [fetchUser, addToast, t]);

  const handleTestNotification = useCallback(async () => {
    if (!alertBotConnected) return;
    setTestLoading(true);
    try {
      await telegramService.sendTestNotification();
      addToast(t('Test message sent to Telegram'), 'success');
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.error || err.message || t('Error');
      const hint = data?.hint ? ` ${data.hint}` : '';
      addToast(msg + hint, 'error');
    } finally {
      setTestLoading(false);
    }
  }, [alertBotConnected, addToast, t]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (alertBotConnected) setConnectError(null);
  }, [alertBotConnected]);

  return (
    <div className="p-6 space-y-6">
      {/* Header Section */}
      <div className="flex items-center space-x-3">
        <MessageSquare className="h-8 w-8 text-blue-400" />
        <div>
          <h1 className="text-3xl font-bold text-textPrimary">{t('Telegram Bots page title')}</h1>
          <p className="text-textSecondary mt-1">{t('Manage your Telegram bots for alerts and listings.')}</p>
        </div>
      </div>

      {/* Bots Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        {/* Alert Bot Card */}
        <div className="bg-surface p-6 rounded-lg shadow-lg border border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-textPrimary flex items-center gap-2">
              <Send className="h-6 w-6 text-blue-400" /> {t('Alert bot Telegram')}
            </h2>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${alertBotConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {alertBotConnected ? t('Connected') : t('Disconnected')}
            </span>
          </div>
          <p className="text-textSecondary mb-4">
            {t('Get instant notifications about price changes and market events.')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={alertBotConnected ? handleDisconnectAlertBot : handleConnectAlertBot}
              disabled={connectLoading || disconnectLoading}
              aria-label={alertBotConnected ? t('Disconnect') : t('Connect')}
              aria-busy={connectLoading || disconnectLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                alertBotConnected
                  ? 'bg-red-600 hover:bg-red-700 text-white focus-visible:ring-red-500'
                  : 'bg-blue-600 hover:bg-blue-700 text-white focus-visible:ring-blue-400'
              }`}
            >
              {(connectLoading || disconnectLoading) ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Power className="h-4 w-4" aria-hidden />
              )}
              {connectLoading ? t('Opening...') : disconnectLoading ? t('Disconnecting...') : alertBotConnected ? t('Disconnect') : t('Connect')}
            </button>
            {alertBotConnected && (
              <button
                type="button"
                onClick={handleTestNotification}
                disabled={testLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:ring-emerald-400"
                aria-label={t('Test in Telegram')}
              >
                {testLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {testLoading ? t('Sending...') : t('Test in Telegram')}
              </button>
            )}
          </div>
          {connectError && (
            <p className="mt-3 text-sm text-red-400" role="alert">
              {connectError}
            </p>
          )}
          <p className="mt-3 text-sm text-textSecondary">
            {alertBotConnected
              ? t('Alerts are also sent to your Telegram.')
              : t('You will be redirected to Telegram to authorize the bot. After tapping Start you will receive alerts here and in Telegram.')}
          </p>
        </div>

        {/* Listing Bot Card — Coming soon */}
        <div className="bg-surface p-6 rounded-lg shadow-lg border border-border opacity-90">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-xl font-semibold text-textPrimary flex items-center gap-2">
              <ListFilter className="h-6 w-6 text-purple-400" aria-hidden /> {t('Listing bot')}
            </h2>
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400" aria-label={t('Soon in development')}>
              {t('Soon')}
            </span>
          </div>
          <p className="text-textSecondary mb-4">
            {t('Stay up to date with new listings on exchanges and important project info. Only the alert bot is active now.')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label={t('Connect listing bot (soon)')}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-gray-600 text-gray-400 cursor-not-allowed"
            >
              <Power className="h-4 w-4" aria-hidden /> {t('Connect')}
            </button>
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label={t('Listing bot settings (soon)')}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-gray-700 text-gray-500 cursor-not-allowed"
            >
              <Settings className="h-4 w-4" aria-hidden /> {t('Settings')}
            </button>
          </div>
          <p className="mt-3 text-sm text-textSecondary italic">{t('Coming soon')}</p>
        </div>
      </div>
    </div>
  );
};

export default TelegramBots;
