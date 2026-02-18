import React from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { BellRing } from 'lucide-react';

const fmt = (n) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/**
 * Builds a clear "what happened" line from the triggered alert payload.
 * Payload can be price (symbol, targetValue, currentPrice, initialPrice, condition) or complex (symbol, pctChange).
 * When initialPrice is present, shows "From X to Y" or "From X down to Y".
 */
function formatTimeframe(seconds) {
  if (!seconds) return 'unknown timeframe';
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minute${seconds >= 120 ? 's' : ''}`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour${seconds >= 7200 ? 's' : ''}`;
  return `${Math.floor(seconds / 86400)} day${seconds >= 172800 ? 's' : ''}`;
}

function getWhatHappened(alert) {
  if (!alert) return null;
  const symbol = alert.symbol || alert.coinSymbol;
    if (alert.alertType === 'complex') {
      const pct = alert.pctChange != null ? Number(alert.pctChange) : null;
      const direction = pct !== null ? (pct >= 0 ? 'up' : 'down') : '';
      const pctFormatted = pct !== null ? `${Math.abs(pct).toFixed(2)}%` : '—';
      const windowSec = alert.windowSeconds || alert.timeframe;
      const timeframe = windowSec ? formatTimeframe(windowSec) : 'selected timeframe';
      const baseline = alert.baselinePrice != null ? Number(alert.baselinePrice) : null;
      const current = alert.currentPrice != null ? Number(alert.currentPrice) : null;

      if (symbol) {
        let msg = `${symbol} moved ${pctFormatted} ${direction} in ${timeframe}`;
        if (baseline != null && current != null && Number.isFinite(baseline) && Number.isFinite(current)) {
          msg += ` (from ${fmt(baseline)} to ${fmt(current)})`;
        }
        return msg + '.';
      }
      return `Moved ${pctFormatted} ${direction} in ${timeframe}.`;
    }
  // Price alert: prefer "From initialPrice to target" when both are present
  const initial = alert.initialPrice != null ? Number(alert.initialPrice) : null;
  const target = alert.targetValue != null ? Number(alert.targetValue) : null;
  const current = alert.currentPrice != null ? Number(alert.currentPrice) : null;
  const isBelow = alert.condition === 'below';
  const sym = symbol ? `${symbol}: ` : '';

  if (initial != null && target != null && Number.isFinite(initial) && Number.isFinite(target)) {
    const fromTo = isBelow
      ? `From ${fmt(initial)} down to ${fmt(target)}`
      : `From ${fmt(initial)} to ${fmt(target)}`;
    return sym ? `${sym}${fromTo}` : fromTo;
  }
  if (target != null && current != null) {
    return `${sym}Price reached ${fmt(current)} (your target: ${fmt(target)})`;
  }
  if (current != null) return `${sym}Current price: ${fmt(current)}`;
  if (target != null) return `${sym}Target price was ${fmt(target)}`;
  return null;
}

/**
 * Display name for the alert: user name, or description, or type-based fallback.
 */
function getAlertTitle(alert) {
  const name = (alert.name || '').trim();
  const desc = (alert.description || '').trim();
  if (name) return name;
  if (desc) return desc;
  return alert.alertType === 'complex' ? 'Complex Alert' : 'Price Alert';
}

const AlertTriggeredModal = ({ isOpen, onClose, alert = null }) => {
  const { t } = useTranslation();
  if (!alert) return null;

  const rawTitle = getAlertTitle(alert);
  const title = (rawTitle === 'Complex Alert' || rawTitle === 'Price Alert') ? t(rawTitle) : rawTitle;
  const whatHappened = getWhatHappened(alert);
  const description = (alert.description || '').trim();
  const showDescription = description && description !== title;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('Alert triggered')} size="sm">
      <div className="p-4">
        <div className="flex items-start gap-4 mb-6">
          <BellRing size={40} className="text-warning flex-shrink-0 mt-0.5" />
          <div className="text-left flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-textPrimary mb-1">{title}</h3>
            {whatHappened && (
              <p className="text-textPrimary text-sm font-medium mb-1">{whatHappened}</p>
            )}
            {showDescription && (
              <p className="text-textSecondary text-sm">{description}</p>
            )}
            {!whatHappened && !showDescription && (
              <p className="text-textSecondary text-sm">{t("This alert's condition was met.")}</p>
            )}
            {alert.alertType === 'complex' && (
              <>
                {alert.baselinePrice != null && alert.currentPrice != null && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex justify-between text-xs">
                      <span className="text-textSecondary">{t('Baseline price')}</span>
                      <span className="text-textPrimary font-medium">{fmt(alert.baselinePrice)}</span>
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-textSecondary">{t('Current price')}</span>
                      <span className="text-textPrimary font-medium">{fmt(alert.currentPrice)}</span>
                    </div>
                    {alert.windowSeconds && (
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-textSecondary">{t('Time window')}</span>
                        <span className="text-textPrimary font-medium">{formatTimeframe(alert.windowSeconds)}</span>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-textSecondary text-xs mt-2">
                  {t('Complex alerts fire when any token in scope meets the movement condition.')}
                </p>
              </>
            )}
          </div>
        </div>
        <Button variant="primary" onClick={onClose} className="w-full">
          {t('Dismiss')}
        </Button>
      </div>
    </Modal>
  );
};

export default AlertTriggeredModal;
