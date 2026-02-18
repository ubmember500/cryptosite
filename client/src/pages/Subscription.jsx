import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Info, Copy, ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';
import api from '../services/api';
import Modal from '../components/common/Modal';
import { useToastStore } from '../store/toastStore';

// Curated payment currencies: label for display, ticker for API (must match NOWPayments)
const PAYMENT_CURRENCIES = [
  { ticker: 'btc', label: 'Bitcoin (BTC)' },
  { ticker: 'eth', label: 'Ethereum (ETH)' },
  { ticker: 'ltc', label: 'Litecoin (LTC)' },
  { ticker: 'bnb', label: 'BNB (BNB)' },
  { ticker: 'xrp', label: 'XRP (XRP)' },
  { ticker: 'sol', label: 'Solana (SOL)' },
  { ticker: 'doge', label: 'Dogecoin (DOGE)' },
  { ticker: 'ada', label: 'Cardano (ADA)' },
  { ticker: 'dot', label: 'Polkadot (DOT)' },
  { ticker: 'matic', label: 'Polygon (MATIC)' },
  { ticker: 'zec', label: 'Zcash (ZEC)' },
  { ticker: 'usdttrc20', label: 'USDT (TRC-20)' },
  { ticker: 'usdtbep20', label: 'USDT (BEP-20)' },
  { ticker: 'usdtarbitrum', label: 'USDT (Arbitrum)' },
  { ticker: 'usdtsol', label: 'USDT (SOL)' },
];

const Subscription = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [step, setStep] = useState('currency'); // 'currency' | 'payment'
  const [currencies, setCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [payment, setPayment] = useState(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only show currencies that NOWPayments supports, in our preferred order; use API ticker for create-payment
  const availableOptions = PAYMENT_CURRENCIES.map((item) => {
    const apiTicker = currencies.find((c) => {
      const raw = String(c).toLowerCase();
      const normalized = raw.replace(/_/g, '');
      const want = item.ticker.replace(/_/g, '');
      return normalized === want || raw === item.ticker;
    });
    return apiTicker ? { apiTicker: String(apiTicker).toLowerCase(), label: item.label } : null;
  }).filter(Boolean);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleSubscribe = (plan) => {
    if (plan !== 'Pro') {
      console.log(`Subscribing to ${plan} plan`);
      return;
    }
    openCurrencyModal();
  };

  const openCurrencyModal = useCallback(async () => {
    setPaymentModalOpen(true);
    setStep('currency');
    setPayment(null);
    setSelectedCurrency(null);
    setCurrenciesLoading(true);
    try {
      const { data } = await api.get('/subscription/currencies');
      setCurrencies(Array.isArray(data.currencies) ? data.currencies : []);
    } catch (err) {
      const message = err.response?.data?.message || err.response?.data?.error || 'Could not load payment options.';
      addToast(message, 'error');
      setPaymentModalOpen(false);
    } finally {
      setCurrenciesLoading(false);
    }
  }, [addToast]);

  const handleCreatePayment = useCallback(async () => {
    if (!selectedCurrency) return;
    setCreateLoading(true);
    try {
      const { data } = await api.post('/subscription/create-pro-payment', {
        pay_currency: selectedCurrency,
      });
      setPayment({
        pay_address: data.pay_address,
        pay_amount: data.pay_amount,
        pay_currency: data.pay_currency,
        payment_id: data.payment_id,
      });
      setStep('payment');
    } catch (err) {
      const message = err.response?.data?.message || err.response?.data?.error || 'Payment could not be created. Try again later.';
      addToast(message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }, [selectedCurrency, addToast]);

  const closePaymentModal = useCallback(() => {
    setPaymentModalOpen(false);
    setStep('currency');
    setPayment(null);
    setSelectedCurrency(null);
    setCopied(false);
  }, []);

  const copyAddress = useCallback(() => {
    if (!payment?.pay_address) return;
    navigator.clipboard.writeText(payment.pay_address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [payment?.pay_address]);

  const FeatureItem = ({ text, tooltip }) => (
    <div className="flex items-center py-2 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={18} className="text-emerald-500" />
        <span className="text-textPrimary">{t(text)}</span>
        {tooltip && <Info size={14} className="text-textSecondary" title={t(tooltip)} />}
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-8">
      {/* Top Navigation */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center space-x-6">
          <button className="text-textPrimary font-medium border-b-2 border-accent pb-2">{t('My plan')}</button>
          <button className="text-textSecondary hover:text-textPrimary pb-2">{t('Payment history')}</button>
          <button className="text-accent hover:text-accent/80 pb-2">{t('Get Pro subscription')}</button>
        </div>
        <button className="text-accent hover:text-accent/80 flex items-center gap-2">{t('Activate promocode')}</button>
      </div>

      {/* Pricing Tiers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Free Plan Card */}
        <div className="bg-surface p-6 rounded-lg shadow-lg border border-border flex flex-col">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-textPrimary mb-2">{t('Free')}</h2>
            <p className="text-textSecondary text-sm mb-4">
              {t('Want to try the screener before buying? Request trial access for 3 days!')}
            </p>
            <p className="text-4xl font-bold text-textPrimary mb-2">
              $0<span className="text-lg text-textSecondary"> / {t('month')}</span>
            </p>
            <a
              href="https://t.me/Fahey_contrary"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-md transition-colors inline-block text-center"
            >
              YOUR VERSION
            </a>
          </div>
          <div className="flex-1 space-y-1">
            <FeatureItem text="Popular" available={true} />
            <FeatureItem text="All exchanges and markets" available={false} />
            <FeatureItem text="Alerts" available={false} />
            <FeatureItem text="Densities" available={false} />
            <FeatureItem text="Market overview" available={false} />
            <FeatureItem text="Filters" available={false} />
            <FeatureItem text="Secondary candles" available={false} />
            <FeatureItem text="Open interest" available={false} />
            <FeatureItem text="Exchanges and platforms" available={false} />
            <FeatureItem text="Market map" available={false} />
            <FeatureItem text="Overview" available={false} />
            <FeatureItem text="Densities again" available={false} />
            <FeatureItem text="Alerts again" available={false} />
            <FeatureItem text="Graphs and candles" available={false} />
            <FeatureItem text="Open interest again" available={false} />
            <FeatureItem text="Filters again" available={false} />
            <FeatureItem text="Calculations for" available={false} />
          </div>
        </div>

        {/* Pro Plan Card */}
        <div className="bg-surface p-6 rounded-lg shadow-lg border border-border flex flex-col">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-textPrimary mb-2">{t('Pro')}</h2>
            <p className="text-textSecondary text-sm mb-4">
              {t('Go for full Pro access - up to 14$ or through trading, enough the required commission!')}
            </p>
            <p className="text-4xl font-bold text-textPrimary mb-2">
              $14<span className="text-lg text-textSecondary"> / {t('month')}</span>
            </p>
            <button
              onClick={() => handleSubscribe('Pro')}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 rounded-md transition-colors"
            >
              {t('Pro')}
            </button>
          </div>
          <div className="flex-1 space-y-1">
            <FeatureItem text="Popular" available={true} />
            <FeatureItem text="All exchanges and markets" available={true} />
            <FeatureItem text="Alerts" available={true} />
            <FeatureItem text="Densities" available={true} />
            <FeatureItem text="Market overview" available={true} />
            <FeatureItem text="Filters" available={true} />
            <FeatureItem text="Secondary candles" available={true} />
            <FeatureItem text="Open interest" available={true} />
            <FeatureItem text="Exchanges and platforms" available={true} />
            <FeatureItem text="Market map" available={true} />
            <FeatureItem text="Overview" available={true} />
            <FeatureItem text="Densities again" available={true} />
            <FeatureItem text="Alerts again" available={true} />
            <FeatureItem text="Graphs and candles" available={true} />
            <FeatureItem text="Open interest again" available={true} />
            <FeatureItem text="Filters again" available={true} />
            <FeatureItem text="Calculations for" available={true} />
          </div>
        </div>
      </div>

      {/* Payment modal: step 1 = choose crypto, step 2 = show address and amount */}
      <Modal
        isOpen={paymentModalOpen}
        onClose={closePaymentModal}
        title={t('Pay for Pro')}
        size="md"
      >
        {step === 'currency' && (
          <div className="space-y-5">
            <p className="text-textSecondary text-sm">
              {t('Choose the cryptocurrency you want to pay with.')}
            </p>
            {currenciesLoading ? (
              <div className="py-8 flex items-center justify-center">
                <span className="text-textSecondary text-sm">{t('Loading...')}</span>
              </div>
            ) : (
              <>
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen((v) => !v)}
                    className={cn(
                      'w-full flex items-center justify-between gap-3 rounded-xl border bg-surface-dark px-5 py-3.5 text-left text-lg transition-colors duration-200',
                      'focus:outline-none focus:ring-2 focus:ring-accent/60 focus:ring-offset-2 focus:ring-offset-surface-dark',
                      dropdownOpen
                        ? 'border-accent shadow-accent-glow'
                        : 'border-border hover:border-textSecondary/50',
                      selectedCurrency ? 'text-textPrimary' : 'text-textSecondary' // Ensure selected text is always primary
                    )}
                  >
                    <span className={cn(
                      'font-medium',
                      selectedCurrency
                        ? 'text-textPrimary'
                        : 'text-textSecondary'
                    )}>
                      {selectedCurrency
                        ? availableOptions.find((o) => o.apiTicker === selectedCurrency)?.label || selectedCurrency.toUpperCase()
                        : t('Select currency')}
                    </span>
                    <ChevronDown
                      size={20}
                      className={cn(
                        'text-textSecondary shrink-0 transition-transform',
                        dropdownOpen && 'rotate-180'
                      )}
                    />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute z-10 mt-2 w-full rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
                      <ul className="max-h-56 overflow-y-auto py-2">
                        {availableOptions.map((item) => {
                          const isSelected = selectedCurrency === item.apiTicker;
                          return (
                            <li key={item.apiTicker}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCurrency(item.apiTicker);
                                  setDropdownOpen(false);
                                }}
                                className={cn(
                                  'w-full px-5 py-3 text-left text-base font-medium transition-colors duration-200',
                                  isSelected
                                    ? 'bg-accent/20 text-accent'
                                    : 'text-textPrimary hover:bg-surface-hover'
                                )}
                              >
                                {item.label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleCreatePayment}
                  disabled={!selectedCurrency || createLoading}
                  className={cn(
                    'w-full py-3.5 rounded-xl font-semibold text-white transition-all duration-200',
                    'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed',
                    'focus:outline-none focus:ring-2 focus:ring-emerald-500/60 focus:ring-offset-2 focus:ring-offset-surface-dark'
                  )}
                >
                  {createLoading ? t('Creating…') : t('Continue')}
                </button>
              </>
            )}
          </div>
        )}
        {step === 'payment' && payment && (
          <div className="space-y-4">
            <p className="text-textSecondary text-sm">
              {t('Send exactly this amount to the address below.')}
            </p>
            <div className="rounded-xl bg-background/60 border border-border p-5">
              <p className="text-textSecondary text-xs uppercase tracking-wider mb-2">{t('Amount')}</p>
              <p className="text-textPrimary font-mono text-xl font-bold">
                {payment.pay_amount} {payment.pay_currency.toUpperCase()}
              </p>
            </div>
            <div className="rounded-xl bg-background/60 border border-border p-5">
              <p className="text-textSecondary text-xs uppercase tracking-wider mb-2">{t('Address')}</p>
              <p className="text-textPrimary font-mono text-base break-all mb-4">{payment.pay_address}</p>
              <button
                type="button"
                onClick={copyAddress}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-accent/20 text-accent hover:bg-accent/30 transition-colors duration-200 text-sm font-semibold border border-accent/40"
              >
                <Copy size={18} />
                {copied ? t('Copied!') : t('Copy address')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Subscription;
