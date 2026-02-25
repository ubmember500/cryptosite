import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Select from '../common/Select';
import TokenSelector from './TokenSelector';
import { useMarketStore } from '../../store/marketStore';
import { useAlertStore } from '../../store/alertStore';
import { AlertCircle, Info, Lock, X } from 'lucide-react';
import { cn } from '../../utils/cn';

const CreateAlertModal = ({ isOpen, onClose, onSuccess, editingAlertId, editingAlert, initialData = null }) => {
  const { t } = useTranslation();
  const { fetchBinanceTokens, binanceTokens, loadingBinance, setExchange } = useMarketStore();
  const { createAlert, updateAlert } = useAlertStore();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [complexTokenSearch, setComplexTokenSearch] = useState('');
  const [whitelistInput, setWhitelistInput] = useState(''); // For whitelist tag input
  const [alertForMode, setAlertForMode] = useState('all'); // 'all' | 'whitelist'
  
  const [formData, setFormData] = useState({
    alertType: 'price', // 'price' | 'complex'
    name: '',
    exchanges: ['binance'],
    market: 'futures', // 'futures' | 'spot'
    notificationOptions: {},
    symbols: [],
    conditions: [],
    targetValue: '',
    condition: 'above',
  });

  // Load editing alert data
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (editingAlert) {
      try {
        const symbols = editingAlert.symbols 
          ? (typeof editingAlert.symbols === 'string' ? JSON.parse(editingAlert.symbols) : editingAlert.symbols)
          : [];
        const conditions = editingAlert.conditions
          ? (typeof editingAlert.conditions === 'string' ? JSON.parse(editingAlert.conditions) : editingAlert.conditions)
          : [];
        
        const notifOptions = editingAlert.notificationOptions 
          ? (typeof editingAlert.notificationOptions === 'string' ? JSON.parse(editingAlert.notificationOptions) : editingAlert.notificationOptions)
          : {};
        
        setFormData({
          alertType: editingAlert.alertType || 'price',
          name: editingAlert.name || '',
          exchanges: editingAlert.exchanges || [editingAlert.exchange || 'binance'],
          market: editingAlert.market || 'futures',
          notificationOptions: notifOptions,
          symbols,
          conditions: Array.isArray(conditions) && conditions.length > 0 ? [conditions[0]] : [{ type: 'pct_change', value: '', timeframe: '1m' }],
          targetValue: editingAlert.targetValue || '',
          condition: editingAlert.condition || 'above',
        });
        
        // Detect alertForMode from notificationOptions or symbols count
        if (editingAlert.alertType === 'complex') {
          const mode = notifOptions.alertForMode || (symbols.length > 0 && symbols.length < 100 ? 'whitelist' : 'all');
          setAlertForMode(mode);
        }
      } catch (err) {
        console.error('Error parsing editing alert:', err);
      }
    } else {
      const presetExchange = initialData?.exchange || 'binance';
      const presetMarket = initialData?.market || 'futures';
      const presetSymbol = initialData?.symbol || '';
      const presetTargetValue = initialData?.targetValue != null ? String(initialData.targetValue) : '';

      // Reset form for new alert
      setFormData({
        alertType: 'price',
        name: '',
        exchanges: [presetExchange],
        market: presetMarket,
        notificationOptions: {},
        symbols: presetSymbol ? [presetSymbol] : [],
        conditions: [{ type: 'pct_change', value: '', timeframe: '1m' }],
        targetValue: presetTargetValue,
        condition: 'above',
      });
      setAlertForMode('all');
      setWhitelistInput('');
      setStep(presetSymbol ? 3 : 1);
    }
  }, [editingAlert, isOpen]);

  // Fetch tokens for selected exchange + market (so Bybit/Binance show correct list)
  useEffect(() => {
    if (formData.market && formData.exchanges?.length) {
      const exchange = formData.exchanges[0] || 'binance';
      setExchange(exchange);
      const exchangeType = formData.market === 'spot' ? 'spot' : 'futures';
      fetchBinanceTokens(exchangeType, '');
    }
  }, [formData.market, formData.exchanges, fetchBinanceTokens, setExchange]);

  // Complex alerts: when entering Step 3 with tokens loaded and "all" mode, set all tokens (new alert only)
  useEffect(() => {
    if (
      step === 3 &&
      formData.alertType === 'complex' &&
      !editingAlertId &&
      binanceTokens.length > 0 &&
      alertForMode === 'all' &&
      formData.symbols.length === 0
    ) {
      const allSymbols = binanceTokens.map((t) => t.fullSymbol || t.symbol || '').filter(Boolean);
      setFormData((prev) => ({ ...prev, symbols: allSymbols }));
    }
  }, [step, formData.alertType, formData.symbols.length, editingAlertId, binanceTokens, alertForMode]);

  // Update symbols when alertForMode changes
  useEffect(() => {
    if (step === 3 && formData.alertType === 'complex' && binanceTokens.length > 0) {
      if (alertForMode === 'all') {
        const allSymbols = binanceTokens.map((t) => t.fullSymbol || t.symbol || '').filter(Boolean);
        setFormData((prev) => ({ ...prev, symbols: allSymbols }));
      } else if (alertForMode === 'whitelist' && formData.symbols.length === binanceTokens.length) {
        // Switching from "all" to "whitelist" - clear symbols
        setFormData((prev) => ({ ...prev, symbols: [] }));
      }
    }
  }, [alertForMode, step, formData.alertType, binanceTokens.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredComplexTokens = useMemo(() => {
    if (!binanceTokens.length) return [];
    const q = (complexTokenSearch || '').trim().toUpperCase();
    if (!q) return binanceTokens;
    return binanceTokens.filter((t) => {
      const full = (t.fullSymbol || t.symbol || '').toUpperCase();
      const sym = (t.symbol || '').toUpperCase();
      return full.includes(q) || sym.includes(q);
    });
  }, [binanceTokens, complexTokenSearch]);

  const isStep1Valid = formData.alertType === 'price' || formData.alertType === 'complex';
  const isStep2Valid = formData.exchanges.length > 0 && formData.market;
  const isStep3Valid = 
    formData.alertType === 'price' 
      ? formData.symbols.length > 0 && formData.targetValue
      : (alertForMode === 'all' || formData.symbols.length > 0) && (() => {
          const c = formData.conditions?.[0];
          const v = c?.value != null && c.value !== '' ? parseFloat(c.value) : NaN;
          return Number.isFinite(v) && v > 0 && c?.timeframe;
        })();

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      let payload;
      if (formData.alertType === 'price') {
        payload = {
          alertType: 'price',
          name: formData.name || '',
          exchange: formData.exchanges[0] || 'binance',
          market: formData.market,
          symbols: formData.symbols,
          targetValue: Number(formData.targetValue),
        };
      } else {
        payload = {
          alertType: 'complex',
          name: formData.name || '',
          exchange: formData.exchanges[0] || 'binance',
          market: formData.market,
          symbols: formData.symbols,
          conditions: formData.conditions,
          notificationOptions: { ...formData.notificationOptions, alertForMode },
        };
      }

      if (editingAlertId) {
        // Price alert: only name is editable (backend constraint — symbol/target are immutable)
        const editPayload = formData.alertType === 'price' ? { name: formData.name } : payload;
        await updateAlert(editingAlertId, editPayload);
      } else {
        await createAlert(payload);
      }
      onSuccess();
    } catch (err) {
      setError(err?.message || t('Failed to save alert. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const title = editingAlertId ? t('Edit alert') : t('Create alert');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <div className="p-4 flex flex-col h-full">
        {/* Step Tabs */}
        <div className="flex justify-around border-b border-border mb-6">
          <button 
            className={cn(
              "py-3 px-4 text-sm font-medium transition-colors",
              step === 1 ? 'text-accent border-b-2 border-accent' : 'text-textSecondary hover:text-textPrimary'
            )}
            onClick={() => setStep(1)}
          >
            {t('Alert type')}
          </button>
          <button 
            className={cn(
              "py-3 px-4 text-sm font-medium transition-colors",
              step === 2 ? 'text-accent border-b-2 border-accent' : 'text-textSecondary hover:text-textPrimary',
              !isStep1Valid && 'cursor-not-allowed opacity-50'
            )}
            onClick={() => isStep1Valid && setStep(2)}
            disabled={!isStep1Valid}
          >
            {t('Exchanges & notifications')}
          </button>
          <button 
            className={cn(
              "py-3 px-4 text-sm font-medium transition-colors",
              step === 3 ? 'text-accent border-b-2 border-accent' : 'text-textSecondary hover:text-textPrimary',
              (!isStep1Valid || !isStep2Valid) && 'cursor-not-allowed opacity-50'
            )}
            onClick={() => isStep1Valid && isStep2Valid && setStep(3)}
            disabled={!isStep1Valid || !isStep2Valid}
          >
            {t('Alert settings')}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm flex items-center">
            <AlertCircle size={16} className="mr-2" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Alert Type */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-textPrimary mb-2">
                {t('Alert Type')}
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, alertType: 'price' })}
                  className={cn(
                    "p-4 border-2 rounded-lg transition-all text-left",
                    formData.alertType === 'price'
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-accent/50'
                  )}
                >
                  <div className="font-semibold text-textPrimary">{t('Price alert')}</div>
                  <div className="text-sm text-textSecondary mt-1">{t('Get notified when a token hits a target price.')}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, alertType: 'complex' })}
                  className={cn(
                    "p-4 border-2 rounded-lg transition-all text-left",
                    formData.alertType === 'complex'
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-accent/50'
                  )}
                >
                  <div className="font-semibold text-textPrimary">{t('Complex alert')}</div>
                  <div className="text-sm text-textSecondary mt-1">{t('Notify when any token moves by X% in a timeframe.')}</div>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button 
                variant="primary" 
                onClick={() => setStep(2)}
                disabled={!isStep1Valid}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Exchanges & Notifications */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-textPrimary mb-2">
                {t('Exchange')}
              </label>
              <Select
                value={formData.exchanges[0] || 'binance'}
                onChange={(e) => setFormData({ ...formData, exchanges: [e.target.value] })}
                options={[
                  { value: 'binance', label: t('Binance') },
                  { value: 'bybit', label: t('Bybit') },
                  { value: 'okx', label: t('OKX') },
                  { value: 'gate', label: t('Gate.io') },
                  { value: 'mexc', label: t('MEXC') },
                  { value: 'bitget', label: t('Bitget') },
                ]}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-textPrimary mb-2">
                {t('Market')}
              </label>
              <Select
                value={formData.market}
                onChange={(e) => setFormData({ ...formData, market: e.target.value })}
                options={[
                  { value: 'futures', label: t('Futures') },
                  { value: 'spot', label: t('Spot') },
                ]}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-textPrimary mb-2">
                {t('Alert name (optional)')}
              </label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('e.g. BTC target')}
              />
            </div>

            <div className="flex justify-between gap-3 pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                {t('Back')}
              </Button>
              <Button 
                variant="primary" 
                onClick={() => setStep(3)}
                disabled={!isStep2Valid}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Alert Settings */}
        {step === 3 && (
          <div className="space-y-4">
            {formData.alertType === 'price' ? (
              <>
                {editingAlertId && (
                  <div className="flex items-center gap-2 p-3 bg-surface/50 border border-border rounded-lg text-sm text-textSecondary mb-2">
                    <Lock size={14} className="flex-shrink-0" />
                    {t('Symbol and target price are locked after creation. Only the name can be changed.')}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-textPrimary mb-2">
                    {t('Token / symbol')}
                  </label>
                  {editingAlertId ? (
                    <div className="w-full bg-surface/50 border border-border rounded-lg px-4 py-2 text-textSecondary opacity-75">
                      {formData.symbols[0] || '—'}
                    </div>
                  ) : (
                    <TokenSelector
                      tokens={binanceTokens}
                      value={formData.symbols[0] || ''}
                      onChange={(symbol) => setFormData({ ...formData, symbols: [symbol] })}
                      placeholder={t('Search or select token')}
                      loading={loadingBinance}
                    />
                  )}
                  {!editingAlertId && (
                    <p className="text-xs text-textSecondary mt-1">
                      {t('Select from {{count}} tokens.', { count: binanceTokens.length })}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-textPrimary mb-2">
                    {t('Target price')}
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.targetValue}
                    onChange={(e) => !editingAlertId && setFormData({ ...formData, targetValue: e.target.value })}
                    placeholder={t('e.g. 50000')}
                    disabled={!!editingAlertId}
                  />
                  {!editingAlertId && (
                    <p className="text-xs text-textSecondary mt-1">
                      {t('Alert triggers the first time price crosses your target (up or down).')}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Alert for: All coins or Whitelist */}
                <div>
                  <label className="block text-sm font-medium text-textPrimary mb-2">
                    {t('Alert for')}
                  </label>
                  <div className="flex gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => setAlertForMode('all')}
                      className={cn(
                        'flex-1 px-4 py-2 rounded-lg border-2 transition-colors text-sm font-medium',
                        alertForMode === 'all'
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-surface text-textSecondary hover:border-accent/50 hover:text-textPrimary'
                      )}
                    >
                      {t('All coins')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAlertForMode('whitelist')}
                      className={cn(
                        'flex-1 px-4 py-2 rounded-lg border-2 transition-colors text-sm font-medium',
                        alertForMode === 'whitelist'
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-surface text-textSecondary hover:border-accent/50 hover:text-textPrimary'
                      )}
                    >
                      {t('One or more coins')}
                    </button>
                  </div>

                  {alertForMode === 'all' ? (
                    <div className="p-3 bg-surface/50 border border-border rounded-lg">
                      <p className="text-sm text-textSecondary">
                        {t('Monitor all {{count}} tokens on {{market}}.', { count: binanceTokens.length, market: formData.market === 'spot' ? t('Spot') : t('Futures') })}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-textPrimary mb-2 flex items-center gap-2">
                        {t('Whitelist')}
                        <Info size={14} className="text-textSecondary" title="Add symbols to watch. Only these will trigger the alert." />
                      </label>
                      <div className="border border-border rounded-lg bg-surface p-2 min-h-[60px] flex flex-wrap gap-2">
                        {formData.symbols.map((symbol) => {
                          const token = binanceTokens.find((t) => (t.fullSymbol || t.symbol) === symbol);
                          const displaySymbol = token?.symbol || symbol.replace(/USDT$/i, '');
                          return (
                            <div
                              key={symbol}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 border border-accent/20 rounded-md text-sm"
                            >
                              <span className="text-textPrimary font-medium">{displaySymbol}</span>
                              <span className="text-xs text-textSecondary">{symbol}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setFormData({
                                    ...formData,
                                    symbols: formData.symbols.filter((s) => s !== symbol),
                                  });
                                }}
                                className="text-textSecondary hover:text-danger transition-colors ml-0.5"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })}
                        <div className="flex-1 min-w-[200px]">
                          <TokenSelector
                            tokens={binanceTokens}
                            value=""
                            onChange={(symbol) => {
                              if (symbol && !formData.symbols.includes(symbol)) {
                                setFormData({
                                  ...formData,
                                  symbols: [...formData.symbols, symbol].sort(),
                                });
                              }
                            }}
                            placeholder={t('Search and add tokens')}
                            loading={loadingBinance}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-textSecondary mt-1">
                        {formData.symbols.length === 0 
                          ? t('No tokens in whitelist.') 
                          : t('{{count}} token(s) in whitelist.', { count: formData.symbols.length })}
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-textPrimary mb-2 flex items-center gap-2">
                    {t('Movement condition')}
                    <Info size={14} className="text-textSecondary" title="Alert fires when price moves by this % in the selected timeframe." />
                  </label>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-textSecondary mb-1">{t('% move')}</label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={formData.conditions?.[0]?.value ?? ''}
                        onChange={(e) => {
                          const cond = formData.conditions?.[0] || { type: 'pct_change', value: '', timeframe: '1m' };
                          setFormData({
                            ...formData,
                            conditions: [{ ...cond, value: e.target.value }],
                          });
                        }}
                        placeholder="e.g. 5"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-textSecondary mb-1">{t('Timeframe')}</label>
                      <Select
                        value={formData.conditions?.[0]?.timeframe ?? '1m'}
                        onChange={(e) => {
                          const cond = formData.conditions?.[0] || { type: 'pct_change', value: '', timeframe: '1m' };
                          setFormData({
                            ...formData,
                            conditions: [{ ...cond, timeframe: e.target.value }],
                          });
                        }}
                        options={[
                          { value: '1m', label: t('1 minute') },
                          { value: '5m', label: t('5 minutes') },
                          { value: '15m', label: t('15 minutes') },
                          { value: '30m', label: t('30 minutes') },
                          { value: '1h', label: t('1 hour') },
                          { value: '4h', label: t('4 hours') },
                          { value: '1d', label: t('1 day') },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-between gap-3 pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>
                {t('Back')}
              </Button>
              <Button 
                variant="primary" 
                onClick={handleSubmit}
                disabled={!isStep3Valid || loading}
              >
                {loading ? t('Saving...') : editingAlertId ? t('Update alert') : t('Create alert')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CreateAlertModal;
