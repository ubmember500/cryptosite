import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import i18n from '../i18n';
import { useLanguageStore } from '../store/languageStore';
import {
  TrendingUp, ArrowLeft, Menu, X, ChevronRight,
  LayoutGrid, Bell, Bot, Layers, List, Star,
  CreditCard, User, BookOpen, Zap, AlertTriangle,
  CheckCircle, Info, Monitor, Globe, Clock
} from 'lucide-react';

/* ─────────────────────────────────────────────
   TABLE OF CONTENTS CONFIG
───────────────────────────────────────────── */
const TOC_BY_LANG = {
  en: [
    { id: 'welcome',        label: '👋 Welcome',            group: 'Getting Started' },
    { id: 'market',         label: '📊 Market',              group: 'Features' },
    { id: 'market-map',     label: '🗺️ Market Map',          group: 'Features' },
    { id: 'alerts',         label: '🔔 Alerts Overview',     group: 'Features' },
    { id: 'price-alerts',   label: '🎯 Price Alerts',        group: 'Features' },
    { id: 'complex-alerts', label: '⚡ Complex Alerts',      group: 'Features' },
    { id: 'telegram',       label: '📱 Telegram Bots',       group: 'Notifications' },
    { id: 'wall-scanner',   label: '🧱 Wall Scanner',        group: 'Features' },
    { id: 'listings',       label: '📋 Listings',            group: 'Features' },
    { id: 'watchlist',      label: '⭐ Watchlist',           group: 'Tools' },
    { id: 'subscription',   label: '💎 Subscription',        group: 'Account' },
    { id: 'account',        label: '👤 Account & Profile',   group: 'Account' },
  ],
  ru: [
    { id: 'welcome',        label: '👋 Добро пожаловать',    group: 'Начало работы' },
    { id: 'market',         label: '📊 Рынок',               group: 'Функции' },
    { id: 'market-map',     label: '🗺️ Карта рынка',         group: 'Функции' },
    { id: 'alerts',         label: '🔔 Обзор оповещений',    group: 'Функции' },
    { id: 'price-alerts',   label: '🎯 Ценовые оповещения',  group: 'Функции' },
    { id: 'complex-alerts', label: '⚡ Сложные оповещения',   group: 'Функции' },
    { id: 'telegram',       label: '📱 Telegram-боты',       group: 'Уведомления' },
    { id: 'wall-scanner',   label: '🧱 Сканер стенок',       group: 'Функции' },
    { id: 'listings',       label: '📋 Листинги',            group: 'Функции' },
    { id: 'watchlist',      label: '⭐ Вотчлист',            group: 'Инструменты' },
    { id: 'subscription',   label: '💎 Подписка',            group: 'Аккаунт' },
    { id: 'account',        label: '👤 Аккаунт и профиль',   group: 'Аккаунт' },
  ],
};

/* ─────────────────────────────────────────────
   SMALL REUSABLE COMPONENTS
───────────────────────────────────────────── */
const Callout = ({ type = 'info', children }) => {
  const styles = {
    info:    { bg: 'bg-blue-500/10  border-blue-500/30  text-blue-300',  Icon: Info },
    tip:     { bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', Icon: CheckCircle },
    warning: { bg: 'bg-amber-500/10 border-amber-500/30 text-amber-300', Icon: AlertTriangle },
  };
  const { bg, Icon } = styles[type] || styles.info;
  return (
    <div className={`flex gap-3 rounded-lg border px-4 py-3 my-4 text-sm ${bg}`}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
};

const FeatureCard = ({ icon: Icon, color, title, desc }) => (
  <div className="rounded-xl border border-border bg-surface/60 p-4 flex gap-3 items-start">
    <div className="shrink-0 rounded-lg p-2" style={{ background: `${color}18` }}>
      <Icon className="h-5 w-5" style={{ color }} />
    </div>
    <div>
      <div className="font-semibold text-textPrimary text-sm mb-0.5">{title}</div>
      <div className="text-xs text-textSecondary leading-relaxed">{desc}</div>
    </div>
  </div>
);

const SectionHeading = ({ id, emoji, title }) => (
  <h2
    id={id}
    className="scroll-mt-20 text-2xl font-bold text-textPrimary mb-1 flex items-center gap-2.5 pt-2"
  >
    <span>{emoji}</span>
    <span>{title}</span>
  </h2>
);

const SubHeading = ({ children }) => (
  <h3 className="text-base font-semibold text-accent mt-6 mb-2">{children}</h3>
);

const Divider = () => <hr className="border-border my-10" />;

/* ─────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────── */
const Instructions = () => {
  const [activeId, setActiveId] = useState('welcome');
  const [mobileOpen, setMobileOpen] = useState(false);
  const contentRef = useRef(null);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const currentTOC = TOC_BY_LANG[language] || TOC_BY_LANG.en;

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  /* IntersectionObserver: highlight active TOC item while scrolling */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 }
    );
    currentTOC.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [currentTOC]);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileOpen(false);
  };

  /* Group TOC items */
  const groups = currentTOC.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background text-textPrimary flex flex-col">

      {/* ── TOP HEADER ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 md:px-6 bg-surface border-b border-border shadow-sm">
        {/* Left: logo + doc title */}
        <div className="flex items-center gap-3">
          <button
            className="md:hidden p-1.5 rounded-md text-textSecondary hover:text-textPrimary"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-accent/10 p-1.5 rounded-lg border border-accent/20">
              <TrendingUp className="h-4 w-4 text-accent" />
            </div>
            <span className="text-sm font-bold bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
              CryptoAlerts
            </span>
            <ChevronRight className="h-4 w-4 text-textSecondary" />
            <span className="text-sm font-medium text-textSecondary">{language === 'ru' ? 'Руководство' : 'User Guide'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surfaceHover/50 p-0.5" role="group" aria-label="Language">
            <button
              type="button"
              onClick={() => handleLanguageChange('en')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface focus:ring-accent ${language === 'en' ? 'bg-accent text-white' : 'text-textSecondary hover:text-textPrimary'}`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => handleLanguageChange('ru')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface focus:ring-accent ${language === 'ru' ? 'bg-accent text-white' : 'text-textSecondary hover:text-textPrimary'}`}
            >
              RUS
            </button>
          </div>

          <Link
            to="/account"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surfaceHover px-3 py-1.5 text-xs font-medium text-textSecondary hover:text-textPrimary hover:bg-surface transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {language === 'ru' ? 'Назад в приложение' : 'Back to App'}
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR (TOC) ──────────────────────────────── */}
        {/* Mobile overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} />
        )}

        <aside
          className={`
            fixed md:sticky top-14 z-20 md:z-auto
            h-[calc(100vh-3.5rem)] w-64 shrink-0
            bg-surface border-r border-border
            overflow-y-auto py-6 px-3
            transition-transform duration-200
            ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'}
          `}
        >
          <div className="mb-4 px-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-textSecondary">
              {language === 'ru' ? 'Документация' : 'Documentation'}
            </span>
          </div>

          {Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName} className="mb-4">
              <div className="px-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-textSecondary/60">
                {groupName}
              </div>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className={`
                    w-full text-left flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors mb-0.5
                    ${activeId === item.id
                      ? 'bg-accent/15 text-accent'
                      : 'text-textSecondary hover:bg-surfaceHover hover:text-textPrimary'
                    }
                  `}
                >
                  {activeId === item.id && (
                    <div className="w-1 h-1 rounded-full bg-accent shrink-0" />
                  )}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* ── MAIN CONTENT ────────────────────────────────────── */}
        <main
          ref={contentRef}
          className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-16 pb-24 pt-8 max-w-4xl mx-auto w-full"
        >

          {/* ══════════════════════════════════════
              1. WELCOME
          ══════════════════════════════════════ */}
          <section id="welcome">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent mb-4">
              <BookOpen className="h-3.5 w-3.5" />
              {language === 'ru' ? 'Руководство — Февраль 2026' : 'User Guide — February 2026'}
            </div>
            <h1 className="text-4xl font-extrabold text-textPrimary mb-4 leading-tight">
              {language === 'ru' ? '👋 Добро пожаловать в CryptoAlerts' : '👋 Welcome to CryptoAlerts'}
            </h1>
            <p className="text-lg text-textSecondary leading-relaxed mb-6">
              CryptoAlerts is a <strong className="text-textPrimary">real-time cryptocurrency monitoring and alerting platform</strong> that connects
              directly to the world's major exchanges so you always see live prices, candlestick charts, the most
              active markets, and any big price moves — all in one unified, dark-themed interface.
            </p>

            <Callout type="tip">
              No more watching multiple exchange tabs. Set your conditions once and let CryptoAlerts notify you the instant something happens.
            </Callout>

            <SubHeading>{language === 'ru' ? 'Поддерживаемые биржи' : 'Supported Exchanges'}</SubHeading>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              {['Binance', 'Bybit', 'OKX', 'Gate.io', 'MEXC', 'Bitget'].map((ex) => (
                <div key={ex} className="flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm font-medium text-textPrimary">
                  <Globe className="h-4 w-4 text-accent shrink-0" />
                  {ex}
                </div>
              ))}
            </div>

            <SubHeading>{language === 'ru' ? 'Что внутри' : "What's inside"}</SubHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FeatureCard icon={TrendingUp} color="#22d3ee" title="Live Market Charts" desc="Real-time candlestick charts for any token on any exchange, spot or futures." />
              <FeatureCard icon={LayoutGrid} color="#a78bfa" title="Market Map" desc="See the most volatile tokens right now, ranked by activity — updated every 5 seconds." />
              <FeatureCard icon={Bell} color="#fbbf24" title="Smart Alerts" desc="Price crossing alerts and % change alerts with per-tick detection — zero delay." />
              <FeatureCard icon={Bot} color="#38bdf8" title="Telegram Bot" desc="Instant push notifications to your Telegram when any alert fires." />
              <FeatureCard icon={Layers} color="#fb923c" title="Wall Scanner" desc="Detect large limit orders on Binance, Bybit and OKX in real time." />
              <FeatureCard icon={List} color="#34d399" title="Listings" desc="Upcoming futures contract launches across all major exchanges." />
            </div>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              2. MARKET
          ══════════════════════════════════════ */}
          <section id="market">
            <SectionHeading id="market" emoji="📊" title="Market" />
            <p className="text-textSecondary leading-relaxed mb-4">
              The <strong className="text-textPrimary">Market page</strong> is your live trading terminal. Pick any exchange, choose
              spot or futures, select a token, and you instantly get a professional candlestick chart
              streaming real-time data directly from that exchange.
            </p>

            <SubHeading>How it works</SubHeading>
            <ol className="space-y-2 text-sm text-textSecondary list-none mb-4">
              {[
                'You select an exchange (Binance, Bybit, OKX, Gate, MEXC, Bitget) and a market type (Spot or Futures).',
                'The app loads the full token list for that exchange, which you can search by typing.',
                'Clicking a token fetches up to 500 historical candles from the exchange REST API and renders them instantly.',
                'A WebSocket subscription is opened. Any new candle tick from the exchange is pushed to your browser in under a second.',
                'A green "Live" dot in the corner confirms the real-time connection is active.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>What you can do</SubHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <FeatureCard icon={Globe} color="#22d3ee" title="Switch Exchanges" desc="Jump between Binance, Bybit, OKX, Gate, MEXC and Bitget with one click." />
              <FeatureCard icon={Clock} color="#a78bfa" title="Change Intervals" desc="Choose 1m, 5m, 15m, 30m, 1h, 4h, or 1d. The chart reloads immediately." />
              <FeatureCard icon={Monitor} color="#34d399" title="Multi-Chart Layout" desc="View 1, 2, 4, or more charts at once to compare tokens side-by-side." />
              <FeatureCard icon={Zap} color="#fbbf24" title="Drawing Tools" desc="Measure price/time ranges with the scissors tool. Text annotations, line tools and shapes." />
              <FeatureCard icon={Bell} color="#fb923c" title="Create Alert from Chart" desc="Open the alert creation modal directly from the chart with the token pre-filled." />
              <FeatureCard icon={Star} color="#f472b6" title="Add to Watchlist" desc="Save any token to a named watchlist for instant access in future sessions." />
            </div>

            <Callout type="tip">
              You can type any ticker directly with your keyboard while viewing a chart — the token search filters instantly without needing to click the search box first.
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              3. MARKET MAP
          ══════════════════════════════════════ */}
          <section id="market-map">
            <SectionHeading id="market-map" emoji="🗺️" title="Market Map" />
            <p className="text-textSecondary leading-relaxed mb-4">
              The <strong className="text-textPrimary">Market Map</strong> is your <em>top movers dashboard</em>. Instead of scanning hundreds of tokens
              manually, it automatically surfaces the most volatile futures tokens right now — updated every 5 seconds.
            </p>

            <SubHeading>How it works</SubHeading>
            <p className="text-sm text-textSecondary mb-3">
              The backend subscribes to <strong className="text-textPrimary">all ticker streams</strong> from Binance and Bybit simultaneously.
              Every few seconds it records price history for every symbol, then calculates a score called <strong className="text-textPrimary">NATR%</strong> (Normalized Average True Range):
            </p>
            <div className="rounded-xl border border-border bg-surface/80 px-5 py-4 mb-4 font-mono text-sm text-accent text-center">
              NATR% = ( max_high − min_low ) ÷ last_close × 100
            </div>
            <p className="text-sm text-textSecondary mb-4">
              This measures how much a token has moved in the last 5 minutes as a percentage of its current price.
              Tokens are sorted from highest to lowest NATR% — so the most active token is always in position #1.
              Each card also streams a <strong className="text-textPrimary">live mini-chart</strong> (5m candles) via the same real-time pipeline as the Market page.
            </p>

            <SubHeading>What you can do</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {[
                'Switch between Binance Futures and Bybit Futures market maps.',
                'Choose how many cards to show: 3, 6, 8, 9, 12, or 16 tokens at once.',
                'Click any card to jump directly to that token\'s full chart on the Market page.',
                'Watch cards flash with a color highlight when price moves significantly — the highlight lasts ~12 seconds.',
                'See live volume alongside the NATR% activity score on each card.',
              ].map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <Callout type="info">
              NATR% is more useful than volume alone. A small-cap token pumping 3% ranks higher than a large-cap token drifting 0.1%. This means you catch real momentum, not just big-name noise.
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              4. ALERTS OVERVIEW
          ══════════════════════════════════════ */}
          <section id="alerts">
            <SectionHeading id="alerts" emoji="🔔" title="Alerts Overview" />
            <p className="text-textSecondary leading-relaxed mb-4">
              The <strong className="text-textPrimary">Alerts system</strong> watches crypto prices 24/7 on your behalf and notifies you the moment
              your condition is met — whether that's a specific price level or a sudden percentage move.
              You never need to stare at a screen waiting.
            </p>

            <SubHeading>Two alert types</SubHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Bell className="h-4 w-4 text-amber-400" />
                  <span className="font-semibold text-amber-300 text-sm">Price Alert</span>
                </div>
                <p className="text-xs text-textSecondary leading-relaxed">
                  Trigger when a token crosses a specific price level — either going above or falling below your target.
                  Simple, precise, and instant.
                </p>
              </div>
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-purple-400" />
                  <span className="font-semibold text-purple-300 text-sm">Complex Alert</span>
                </div>
                <p className="text-xs text-textSecondary leading-relaxed">
                  Trigger when any token (or a specific list) moves by a set % within a chosen time window.
                  Great for catching explosive breakouts the moment they start.
                </p>
              </div>
            </div>

            <SubHeading>When an alert fires</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {[
                'An in-app modal pops up showing exactly what happened — token, direction, and price.',
                'A loud audio notification plays immediately.',
                'A toast banner appears at the top of the screen.',
                'If Telegram is connected: a message is sent to your Telegram app instantly.',
                'The alert moves to your history so you can review all past triggers.',
              ].map((point, i) => (
                <li key={i} className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <SubHeading>Managing alerts</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary">
              {[
                'Filter your alert list by status (active / triggered / expired), exchange, market type, or alert type.',
                'Toggle any alert on or off to pause it without deleting it.',
                'Edit an alert\'s name, description, or target at any time.',
                'Bulk-select multiple alerts and delete them all at once.',
                'Give each alert a descriptive name so you always know what you\'re tracking.',
              ].map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              5. PRICE ALERTS
          ══════════════════════════════════════ */}
          <section id="price-alerts">
            <SectionHeading id="price-alerts" emoji="🎯" title="Price Alerts" />
            <p className="text-textSecondary leading-relaxed mb-4">
              A <strong className="text-textPrimary">Price Alert</strong> notifies you when a specific token crosses an exact price you choose.
              You pick a direction — <em>above</em> or <em>below</em> — and the engine does the rest.
            </p>

            <SubHeading>How to set one up</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {[
                'Go to the Alerts page and click "Create Alert", then choose "Price Alert".',
                'Select the exchange (e.g. Binance) and market type (Spot or Futures).',
                'Search for and select the token — e.g. BTCUSDT.',
                'Enter your target price and choose the direction: "Above" or "Below".',
                'Give the alert a name (optional but recommended) and save it.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>How the engine detects it</SubHeading>
            <p className="text-sm text-textSecondary mb-3">
              When you create a price alert, the server records the <strong className="text-textPrimary">current price as the baseline</strong>.
              The alert only fires if the price was on the opposite side of your target at creation time and then crosses it —
              this prevents false triggers if the price already passed your target before you created the alert.
              The engine checks on every incoming price tick via WebSocket, plus a safety sweep every 10 seconds.
            </p>

            <Callout type="warning">
              If the current price is already beyond your target when you create the alert, it will not trigger immediately — you need to set a target that the price still needs to reach.
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              6. COMPLEX ALERTS
          ══════════════════════════════════════ */}
          <section id="complex-alerts">
            <SectionHeading id="complex-alerts" emoji="⚡" title="Complex (% Change) Alerts" />
            <p className="text-textSecondary leading-relaxed mb-4">
              A <strong className="text-textPrimary">Complex Alert</strong> watches for sudden percentage moves rather than fixed prices.
              You define a threshold (e.g. 5%) and a time window (e.g. 10 minutes), then choose
              whether to watch a specific list of tokens or <em>all USDT pairs</em> on an exchange.
              The moment any token moves that much within that window, you're notified.
            </p>

            <SubHeading>How to set one up</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {[
                'Go to the Alerts page and click "Create Alert", then choose "Complex Alert".',
                'Select the exchange and market type (Spot or Futures).',
                'Set a percentage threshold — e.g. 3% means any token moving 3% or more will trigger.',
                'Set a time window — e.g. 5 minutes means the move must happen within 5 minutes.',
                'Choose scope: "All USDT pairs" or a custom whitelist of specific tokens.',
                'Name the alert and save it.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>How the engine detects it</SubHeading>
            <p className="text-sm text-textSecondary mb-3">
              The server maintains a <strong className="text-textPrimary">rolling price history</strong> for every token on every subscribed exchange.
              On every WebSocket price tick (sub-second), it checks whether the oldest price in your window
              differs from the current price by ≥ your threshold. There is zero network I/O per evaluation —
              everything reads from memory. A backup sweep also runs every 10 seconds.
            </p>

            <Callout type="tip">
              Complex alerts are ideal for catching breakouts before they're over. Instead of setting fixed targets you'd have to update constantly, a "5% in 5 minutes" rule catches any token that suddenly explodes — automatically.
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              7. TELEGRAM BOTS
          ══════════════════════════════════════ */}
          <section id="telegram">
            <SectionHeading id="telegram" emoji="📱" title="Telegram Bots" />
            <p className="text-textSecondary leading-relaxed mb-4">
              Connect your account to a <strong className="text-textPrimary">Telegram bot</strong> to receive instant push notifications
              on your phone every time an alert fires — even when the app is closed or your screen is off.
            </p>

            <SubHeading>How to connect</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {[
                'Go to the Telegram Bots page from the sidebar.',
                'Click "Connect" on the Alert Bot card.',
                'You\'ll be redirected to Telegram — press "Start" in the bot chat.',
                'Your Telegram account is now linked. All future alert triggers will be sent there.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>What a notification looks like</SubHeading>
            <div className="rounded-xl border border-border bg-surface/80 px-4 py-3 text-sm font-mono text-textPrimary mb-4">
              <div className="text-xs text-textSecondary mb-1">Telegram message</div>
              🔔 <strong>BTC Resistance Break</strong><br />
              BTCUSDT — Price crossed above $91,000<br />
              From: $87,420 → Now: $91,055<br />
              Exchange: Binance Futures
            </div>

            <Callout type="tip">
              Telegram notifications work even if you close the browser or turn your computer off. The server sends the message directly to your Telegram account the instant the alert triggers.
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              8. WALL SCANNER
          ══════════════════════════════════════ */}
          <section id="wall-scanner">
            <SectionHeading id="wall-scanner" emoji="🧱" title="Wall Scanner" />
            <p className="text-textSecondary leading-relaxed mb-4">
              The <strong className="text-textPrimary">Wall Scanner</strong> lets you see unusually large limit orders (known as "walls")
              sitting in the order books of Binance, Bybit, and OKX — in real time and in a readable format.
            </p>

            <SubHeading>Why walls matter</SubHeading>
            <p className="text-sm text-textSecondary mb-4">
              Large limit orders act as price magnets or barriers. A massive buy wall at $90,000 often
              acts as support — price bounces off it. A large sell wall at $92,000 creates resistance.
              Spotting these early gives you context that isn't visible on a standard candlestick chart.
            </p>

            <SubHeading>What you can do</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary">
              {[
                'View the largest open limit orders across multiple tokens at once.',
                'Filter by exchange: Binance, Bybit, OKX.',
                'See the order size in USD and the price level it sits at.',
                'Refresh in real time — walls that are cancelled or filled disappear automatically.',
                'Use it to identify strong support/resistance levels before entering a trade.',
              ].map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              9. LISTINGS
          ══════════════════════════════════════ */}
          <section id="listings">
            <SectionHeading id="listings" emoji="📋" title="Listings" />
            <p className="text-textSecondary leading-relaxed mb-4">
              The <strong className="text-textPrimary">Listings page</strong> shows upcoming and recently added futures contract launches
              across Binance, Bybit, and OKX. New listings frequently come with large price volatility —
              knowing about them in advance lets you prepare.
            </p>

            <SubHeading>What you see</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {[
                'Token name, ticker, and the exchange it\'s listing on.',
                'The scheduled launch date and time for new futures contracts.',
                'Recent listings from the past several days.',
                'Exchange branding so you can instantly tell where each listing is happening.',
              ].map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <Callout type="info">
              When a new token gets a futures listing on Binance or Bybit, it often moves 20–100%+ in the first hours. This page helps you know what's coming so you can set up alerts or watch the chart at launch time.
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              10. WATCHLIST
          ══════════════════════════════════════ */}
          <section id="watchlist">
            <SectionHeading id="watchlist" emoji="⭐" title="Watchlist" />
            <p className="text-textSecondary leading-relaxed mb-4">
              A <strong className="text-textPrimary">Watchlist</strong> is a saved group of tokens you follow regularly.
              Instead of searching for the same coins every session, save them once and access them instantly.
            </p>

            <SubHeading>How to use it</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {[
                'On the Market page, find any token you want to track.',
                'Click the star icon next to the token to add it to your default watchlist.',
                'You can create multiple named watchlists to keep different strategies separate.',
                'Switch to any watchlist in the token panel to see only your saved tokens.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <Callout type="tip">
              Use separate watchlists for different strategies — e.g. one for large-caps you hold, another for high-volatility tokens you scalp, and a third for tokens you're watching for breakouts.
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              11. SUBSCRIPTION
          ══════════════════════════════════════ */}
          <section id="subscription">
            <SectionHeading id="subscription" emoji="💎" title="Subscription" />
            <p className="text-textSecondary leading-relaxed mb-4">
              CryptoAlerts has a <strong className="text-textPrimary">Free tier</strong> and a <strong className="text-textPrimary">Pro tier</strong>.
              The Free tier gives you access to popular tokens. Pro unlocks everything.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="rounded-xl border border-border bg-surface/60 p-4">
                <div className="text-sm font-bold text-textPrimary mb-2">Free</div>
                <ul className="space-y-1 text-xs text-textSecondary">
                  {['Popular tokens only', 'Basic market charts', 'Community features'].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />{f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-pink-500/40 bg-pink-500/5 p-4">
                <div className="text-sm font-bold text-pink-300 mb-2">Pro ✨</div>
                <ul className="space-y-1 text-xs text-textSecondary">
                  {[
                    'All exchanges & markets',
                    'Price alerts & complex alerts',
                    'Market Map (live rankings)',
                    'Wall Scanner',
                    'Listings tracker',
                    'Telegram notifications',
                    'Watchlists',
                    'Multi-chart layout',
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-pink-400 shrink-0" />{f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="text-sm text-textSecondary">
              Payment is handled via <strong className="text-textPrimary">NOWPayments</strong> and supports
              BTC, ETH, SOL, USDT (TRC-20, BEP-20, Arbitrum), and many other cryptocurrencies.
              Your subscription is activated automatically after payment is confirmed on-chain.
            </p>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              12. ACCOUNT & PROFILE
          ══════════════════════════════════════ */}
          <section id="account">
            <SectionHeading id="account" emoji="👤" title="Account & Profile" />
            <p className="text-textSecondary leading-relaxed mb-4">
              Your <strong className="text-textPrimary">Account page</strong> is the home dashboard — it shows your subscription status,
              how many active alerts you have, and your watchlist count at a glance.
            </p>

            <SubHeading>What you can manage</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {[
                'Update your display name and email address.',
                'Change your password at any time from the Profile page.',
                'See your subscription plan (Free / Pro) and the date your account was created.',
                'Track at a glance: active alert count, watchlist size, and account tier.',
              ].map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <SubHeading>Authentication</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary">
              {[
                'Register a new account with email and password.',
                'Forgot your password? Use the "Forgot Password" link on the login page to receive a reset link by email.',
                'All sessions use secure JWT tokens with automatic refresh.',
                'Logging out from the sidebar revokes your session immediately.',
              ].map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <Callout type="info">
              The Market page and Market Map are publicly accessible — no login required. Alerts, Telegram Bots, Wall Scanner, Listings, and Watchlists require an account.
            </Callout>
          </section>

          <Divider />

          {/* Footer */}
          <div className="text-center text-xs text-textSecondary pb-8">
            <p>{language === 'ru' ? 'Руководство CryptoAlerts · Обновлено в феврале 2026' : 'CryptoAlerts User Guide · Last updated February 2026'}</p>
            <Link to="/account" className="inline-flex items-center gap-1 mt-2 text-accent hover:underline">
              <ArrowLeft className="h-3 w-3" />
              {language === 'ru' ? 'Назад в приложение' : 'Back to the app'}
            </Link>
          </div>

        </main>
      </div>
    </div>
  );
};

export default Instructions;
