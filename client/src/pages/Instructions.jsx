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
  const tr = (en, ru) => (language === 'ru' ? ru : en);

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
              {language === 'ru' ? (
                <>
                  CryptoAlerts — это <strong className="text-textPrimary">платформа мониторинга крипторынка и оповещений в реальном времени</strong>,
                  которая подключается напрямую к крупнейшим мировым биржам, чтобы вы всегда видели живые цены,
                  свечные графики, самые активные рынки и сильные движения цены — всё в одном едином тёмном интерфейсе.
                </>
              ) : (
                <>
                  CryptoAlerts is a <strong className="text-textPrimary">real-time cryptocurrency monitoring and alerting platform</strong> that connects
                  directly to the world's major exchanges so you always see live prices, candlestick charts, the most
                  active markets, and any big price moves — all in one unified, dark-themed interface.
                </>
              )}
            </p>

            <Callout type="tip">
              {tr(
                'No more watching multiple exchange tabs. Set your conditions once and let CryptoAlerts notify you the instant something happens.',
                'Больше не нужно следить за десятками вкладок бирж. Настройте условия один раз, и CryptoAlerts мгновенно уведомит вас, как только что-то произойдёт.'
              )}
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
              <FeatureCard icon={TrendingUp} color="#22d3ee" title={tr('Live Market Charts', 'Живые рыночные графики')} desc={tr('Real-time candlestick charts for any token on any exchange, spot or futures.', 'Свечные графики в реальном времени для любого токена на любой бирже, спот и фьючерсы.')} />
              <FeatureCard icon={LayoutGrid} color="#a78bfa" title={tr('Market Map', 'Карта рынка')} desc={tr('See the most volatile tokens right now, ranked by activity — updated every 5 seconds.', 'Смотрите самые волатильные токены прямо сейчас, ранжированные по активности — обновление каждые 5 секунд.')} />
              <FeatureCard icon={Bell} color="#fbbf24" title={tr('Smart Alerts', 'Умные оповещения')} desc={tr('Price crossing alerts and % change alerts with per-tick detection — zero delay.', 'Оповещения о пересечении цены и % движении с проверкой на каждом тике — без задержек.')} />
              <FeatureCard icon={Bot} color="#38bdf8" title={tr('Telegram Bot', 'Telegram-бот')} desc={tr('Instant push notifications to your Telegram when any alert fires.', 'Мгновенные push-уведомления в Telegram при срабатывании любого оповещения.')} />
              <FeatureCard icon={Layers} color="#fb923c" title={tr('Wall Scanner', 'Сканер стенок')} desc={tr('Detect large limit orders on Binance, Bybit and OKX in real time.', 'Определяйте крупные лимитные заявки на Binance, Bybit и OKX в реальном времени.')} />
              <FeatureCard icon={List} color="#34d399" title={tr('Listings', 'Листинги')} desc={tr('Upcoming futures contract launches across all major exchanges.', 'Предстоящие запуски фьючерсных контрактов на всех крупных биржах.')} />
            </div>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              2. MARKET
          ══════════════════════════════════════ */}
          <section id="market">
            <SectionHeading id="market" emoji="📊" title={tr('Market', 'Рынок')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Страница Market</strong> — это ваш торговый терминал в реальном времени.
                  Выберите биржу, рынок (спот или фьючерсы), нужный токен — и сразу получите профессиональный свечной график
                  с прямым потоком данных от этой биржи.
                </>
              ) : (
                <>
                  The <strong className="text-textPrimary">Market page</strong> is your live trading terminal. Pick any exchange, choose
                  spot or futures, select a token, and you instantly get a professional candlestick chart
                  streaming real-time data directly from that exchange.
                </>
              )}
            </p>

            <SubHeading>{tr('How it works', 'Как это работает')}</SubHeading>
            <ol className="space-y-2 text-sm text-textSecondary list-none mb-4">
              {(language === 'ru' ? [
                'Вы выбираете биржу (Binance, Bybit, OKX, Gate, MEXC, Bitget) и тип рынка (спот или фьючерсы).',
                'Приложение загружает полный список токенов этой биржи, доступный для быстрого поиска по вводу.',
                'При выборе токена загружается до 500 исторических свечей через REST API биржи и мгновенно отображается на графике.',
                'Открывается WebSocket-подписка. Каждый новый тик свечи приходит в браузер менее чем за секунду.',
                'Зелёная точка "Live" подтверждает, что соединение в реальном времени активно.',
              ] : [
                'You select an exchange (Binance, Bybit, OKX, Gate, MEXC, Bitget) and a market type (Spot or Futures).',
                'The app loads the full token list for that exchange, which you can search by typing.',
                'Clicking a token fetches up to 500 historical candles from the exchange REST API and renders them instantly.',
                'A WebSocket subscription is opened. Any new candle tick from the exchange is pushed to your browser in under a second.',
                'A green "Live" dot in the corner confirms the real-time connection is active.',
              ]).map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>{tr('What you can do', 'Что можно делать')}</SubHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <FeatureCard icon={Globe} color="#22d3ee" title={tr('Switch Exchanges', 'Переключение бирж')} desc={tr('Jump between Binance, Bybit, OKX, Gate, MEXC and Bitget with one click.', 'Переключайтесь между Binance, Bybit, OKX, Gate, MEXC и Bitget одним кликом.')} />
              <FeatureCard icon={Clock} color="#a78bfa" title={tr('Change Intervals', 'Смена таймфрейма')} desc={tr('Choose 1m, 5m, 15m, 30m, 1h, 4h, or 1d. The chart reloads immediately.', 'Выбирайте 1m, 5m, 15m, 30m, 1h, 4h или 1d. График обновляется сразу.')} />
              <FeatureCard icon={Monitor} color="#34d399" title={tr('Multi-Chart Layout', 'Мульти-графики')} desc={tr('View 1, 2, 4, or more charts at once to compare tokens side-by-side.', 'Открывайте 1, 2, 4 и более графиков одновременно для сравнения токенов.')} />
              <FeatureCard icon={Zap} color="#fbbf24" title={tr('Drawing Tools', 'Инструменты рисования')} desc={tr('Measure price/time ranges with the scissors tool. Text annotations, line tools and shapes.', 'Измеряйте диапазоны цены/времени, добавляйте текст, линии и фигуры.')} />
              <FeatureCard icon={Bell} color="#fb923c" title={tr('Create Alert from Chart', 'Оповещение с графика')} desc={tr('Open the alert creation modal directly from the chart with the token pre-filled.', 'Открывайте окно создания оповещения прямо с графика с уже выбранным токеном.')} />
              <FeatureCard icon={Star} color="#f472b6" title={tr('Add to Watchlist', 'Добавить в вотчлист')} desc={tr('Save any token to a named watchlist for instant access in future sessions.', 'Сохраняйте любой токен в именованный вотчлист для быстрого доступа в будущем.')} />
            </div>

            <Callout type="tip">
              {tr(
                'You can type any ticker directly with your keyboard while viewing a chart — the token search filters instantly without needing to click the search box first.',
                'Вы можете печатать тикер прямо с клавиатуры во время просмотра графика — поиск по токенам фильтруется мгновенно без клика по полю поиска.'
              )}
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              3. MARKET MAP
          ══════════════════════════════════════ */}
          <section id="market-map">
            <SectionHeading id="market-map" emoji="🗺️" title={tr('Market Map', 'Карта рынка')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Карта рынка</strong> — это ваш <em>дашборд самых активных движений</em>.
                  Вместо ручного анализа сотен токенов она автоматически показывает самые волатильные фьючерсные токены
                  прямо сейчас — обновление каждые 5 секунд.
                </>
              ) : (
                <>
                  The <strong className="text-textPrimary">Market Map</strong> is your <em>top movers dashboard</em>. Instead of scanning hundreds of tokens
                  manually, it automatically surfaces the most volatile futures tokens right now — updated every 5 seconds.
                </>
              )}
            </p>

            <SubHeading>{tr('How it works', 'Как это работает')}</SubHeading>
            <p className="text-sm text-textSecondary mb-3">
              {language === 'ru' ? (
                <>
                  Бэкенд одновременно подписывается на <strong className="text-textPrimary">все тикер-потоки</strong> Binance и Bybit.
                  Каждые несколько секунд он обновляет историю цен по каждому символу и считает метрику <strong className="text-textPrimary">NATR%</strong> (Normalized Average True Range):
                </>
              ) : (
                <>
                  The backend subscribes to <strong className="text-textPrimary">all ticker streams</strong> from Binance and Bybit simultaneously.
                  Every few seconds it records price history for every symbol, then calculates a score called <strong className="text-textPrimary">NATR%</strong> (Normalized Average True Range):
                </>
              )}
            </p>
            <div className="rounded-xl border border-border bg-surface/80 px-5 py-4 mb-4 font-mono text-sm text-accent text-center">
              NATR% = ( max_high − min_low ) ÷ last_close × 100
            </div>
            <p className="text-sm text-textSecondary mb-4">
              {language === 'ru' ? (
                <>
                  Эта формула показывает, насколько токен изменился за последние 5 минут в процентах от текущей цены.
                  Токены сортируются от большего NATR% к меньшему — самый активный всегда на позиции №1.
                  В каждой карточке также идёт <strong className="text-textPrimary">живой мини-график</strong> (свечи 5m) через тот же real-time пайплайн, что и на странице Market.
                </>
              ) : (
                <>
                  This measures how much a token has moved in the last 5 minutes as a percentage of its current price.
                  Tokens are sorted from highest to lowest NATR% — so the most active token is always in position #1.
                  Each card also streams a <strong className="text-textPrimary">live mini-chart</strong> (5m candles) via the same real-time pipeline as the Market page.
                </>
              )}
            </p>

            <SubHeading>{tr('What you can do', 'Что можно делать')}</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {(language === 'ru' ? [
                'Переключаться между картами Binance Futures и Bybit Futures.',
                'Выбирать количество карточек: 3, 6, 8, 9, 12 или 16 токенов одновременно.',
                'Нажимать на карточку и сразу переходить на полный график токена на странице Market.',
                'Видеть цветовую подсветку карточек при резком движении цены — подсветка держится ~12 секунд.',
                'Смотреть живой объём и метрику активности NATR% на каждой карточке.',
              ] : [
                'Switch between Binance Futures and Bybit Futures market maps.',
                'Choose how many cards to show: 3, 6, 8, 9, 12, or 16 tokens at once.',
                'Click any card to jump directly to that token\'s full chart on the Market page.',
                'Watch cards flash with a color highlight when price moves significantly — the highlight lasts ~12 seconds.',
                'See live volume alongside the NATR% activity score on each card.',
              ]).map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <Callout type="info">
              {tr(
                'NATR% is more useful than volume alone. A small-cap token pumping 3% ranks higher than a large-cap token drifting 0.1%. This means you catch real momentum, not just big-name noise.',
                'NATR% полезнее, чем один только объём. Токен с малой капитализацией и движением +3% будет выше, чем крупный токен с +0.1%. Это помогает ловить реальный импульс, а не шум популярных монет.'
              )}
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              4. ALERTS OVERVIEW
          ══════════════════════════════════════ */}
          <section id="alerts">
            <SectionHeading id="alerts" emoji="🔔" title={tr('Alerts Overview', 'Обзор оповещений')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Система оповещений</strong> отслеживает цены криптовалют 24/7 за вас и уведомляет
                  сразу, как только выполняется условие — будь то конкретный уровень цены или резкое процентное движение.
                  Вам больше не нужно постоянно смотреть в экран.
                </>
              ) : (
                <>
                  The <strong className="text-textPrimary">Alerts system</strong> watches crypto prices 24/7 on your behalf and notifies you the moment
                  your condition is met — whether that's a specific price level or a sudden percentage move.
                  You never need to stare at a screen waiting.
                </>
              )}
            </p>

            <SubHeading>{tr('Two alert types', 'Два типа оповещений')}</SubHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Bell className="h-4 w-4 text-amber-400" />
                  <span className="font-semibold text-amber-300 text-sm">{tr('Price Alert', 'Ценовое оповещение')}</span>
                </div>
                <p className="text-xs text-textSecondary leading-relaxed">
                  {tr(
                    'Trigger when a token crosses a specific price level — either going above or falling below your target. Simple, precise, and instant.',
                    'Срабатывает, когда токен пересекает заданный уровень цены — вверх или вниз. Просто, точно и мгновенно.'
                  )}
                </p>
              </div>
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-purple-400" />
                  <span className="font-semibold text-purple-300 text-sm">{tr('Complex Alert', 'Сложное оповещение')}</span>
                </div>
                <p className="text-xs text-textSecondary leading-relaxed">
                  {tr(
                    'Trigger when any token (or a specific list) moves by a set % within a chosen time window. Great for catching explosive breakouts the moment they start.',
                    'Срабатывает, когда любой токен (или токены из списка) проходит заданный % в выбранном временном окне. Отлично подходит для ловли резких пробоев в самом начале.'
                  )}
                </p>
              </div>
            </div>

            <SubHeading>{tr('When an alert fires', 'Когда срабатывает оповещение')}</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {(language === 'ru' ? [
                'Появляется модальное окно с деталями: токен, направление и цена.',
                'Сразу проигрывается громкое аудио-уведомление.',
                'Вверху экрана появляется toast-уведомление.',
                'Если подключён Telegram: сообщение мгновенно отправляется в ваш Telegram.',
                'Оповещение переносится в историю, чтобы вы могли анализировать прошлые срабатывания.',
              ] : [
                'An in-app modal pops up showing exactly what happened — token, direction, and price.',
                'A loud audio notification plays immediately.',
                'A toast banner appears at the top of the screen.',
                'If Telegram is connected: a message is sent to your Telegram app instantly.',
                'The alert moves to your history so you can review all past triggers.',
              ]).map((point, i) => (
                <li key={i} className="flex gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <SubHeading>{tr('Managing alerts', 'Управление оповещениями')}</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary">
              {(language === 'ru' ? [
                'Фильтруйте список по статусу (active / triggered / expired), бирже, типу рынка и типу оповещения.',
                'Включайте/выключайте оповещение, чтобы поставить его на паузу без удаления.',
                'Редактируйте имя, описание и цель оповещения в любой момент.',
                'Выделяйте несколько оповещений и удаляйте их массово.',
                'Давайте понятные названия, чтобы всегда понимать, что именно вы отслеживаете.',
              ] : [
                'Filter your alert list by status (active / triggered / expired), exchange, market type, or alert type.',
                'Toggle any alert on or off to pause it without deleting it.',
                'Edit an alert\'s name, description, or target at any time.',
                'Bulk-select multiple alerts and delete them all at once.',
                'Give each alert a descriptive name so you always know what you\'re tracking.',
              ]).map((point, i) => (
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
            <SectionHeading id="price-alerts" emoji="🎯" title={tr('Price Alerts', 'Ценовые оповещения')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Ценовое оповещение</strong> уведомляет вас, когда выбранный токен пересекает указанную вами цену.
                  Вы задаёте направление — <em>выше</em> или <em>ниже</em> — остальное делает движок.
                </>
              ) : (
                <>
                  A <strong className="text-textPrimary">Price Alert</strong> notifies you when a specific token crosses an exact price you choose.
                  You pick a direction — <em>above</em> or <em>below</em> — and the engine does the rest.
                </>
              )}
            </p>

            <SubHeading>{tr('How to set one up', 'Как настроить')}</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {(language === 'ru' ? [
                'Откройте страницу Alerts и нажмите "Create Alert", затем выберите "Price Alert".',
                'Выберите биржу (например, Binance) и тип рынка (Spot или Futures).',
                'Найдите и выберите токен — например, BTCUSDT.',
                'Введите целевую цену и направление: "Above" или "Below".',
                'Задайте имя оповещения (опционально, но рекомендуется) и сохраните.',
              ] : [
                'Go to the Alerts page and click "Create Alert", then choose "Price Alert".',
                'Select the exchange (e.g. Binance) and market type (Spot or Futures).',
                'Search for and select the token — e.g. BTCUSDT.',
                'Enter your target price and choose the direction: "Above" or "Below".',
                'Give the alert a name (optional but recommended) and save it.',
              ]).map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>{tr('How the engine detects it', 'Как это определяет движок')}</SubHeading>
            <p className="text-sm text-textSecondary mb-3">
              {language === 'ru' ? (
                <>
                  Когда вы создаёте ценовое оповещение, сервер записывает <strong className="text-textPrimary">текущую цену как базовую</strong>.
                  Оповещение сработает только если на момент создания цена была по другую сторону цели и затем пересекла её —
                  это защищает от ложных срабатываний, если цель уже была пройдена до создания.
                  Проверка идёт на каждом входящем тике через WebSocket, плюс страхующий проход каждые 10 секунд.
                </>
              ) : (
                <>
                  When you create a price alert, the server records the <strong className="text-textPrimary">current price as the baseline</strong>.
                  The alert only fires if the price was on the opposite side of your target at creation time and then crosses it —
                  this prevents false triggers if the price already passed your target before you created the alert.
                  The engine checks on every incoming price tick via WebSocket, plus a safety sweep every 10 seconds.
                </>
              )}
            </p>

            <Callout type="warning">
              {tr(
                'If the current price is already beyond your target when you create the alert, it will not trigger immediately — you need to set a target that the price still needs to reach.',
                'Если на момент создания оповещения текущая цена уже за пределами вашей цели, оно не сработает сразу — нужно указать цель, до которой цена ещё должна дойти.'
              )}
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              6. COMPLEX ALERTS
          ══════════════════════════════════════ */}
          <section id="complex-alerts">
            <SectionHeading id="complex-alerts" emoji="⚡" title={tr('Complex (% Change) Alerts', 'Сложные оповещения (% изменения)')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Сложное оповещение</strong> отслеживает резкие процентные движения, а не фиксированную цену.
                  Вы задаёте порог (например, 5%) и временное окно (например, 10 минут), затем выбираете,
                  отслеживать ли конкретный список токенов или <em>все USDT-пары</em> на бирже.
                  Как только любой токен проходит это движение в рамках окна — вы получаете уведомление.
                </>
              ) : (
                <>
                  A <strong className="text-textPrimary">Complex Alert</strong> watches for sudden percentage moves rather than fixed prices.
                  You define a threshold (e.g. 5%) and a time window (e.g. 10 minutes), then choose
                  whether to watch a specific list of tokens or <em>all USDT pairs</em> on an exchange.
                  The moment any token moves that much within that window, you're notified.
                </>
              )}
            </p>

            <SubHeading>{tr('How to set one up', 'Как настроить')}</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {(language === 'ru' ? [
                'Откройте страницу Alerts и нажмите "Create Alert", затем выберите "Complex Alert".',
                'Выберите биржу и тип рынка (Spot или Futures).',
                'Задайте процентный порог — например, 3% означает, что сработает любой токен с движением 3% и выше.',
                'Задайте окно времени — например, 5 минут, значит движение должно произойти в пределах 5 минут.',
                'Выберите охват: "All USDT pairs" или собственный whitelist токенов.',
                'Укажите имя оповещения и сохраните.',
              ] : [
                'Go to the Alerts page and click "Create Alert", then choose "Complex Alert".',
                'Select the exchange and market type (Spot or Futures).',
                'Set a percentage threshold — e.g. 3% means any token moving 3% or more will trigger.',
                'Set a time window — e.g. 5 minutes means the move must happen within 5 minutes.',
                'Choose scope: "All USDT pairs" or a custom whitelist of specific tokens.',
                'Name the alert and save it.',
              ]).map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>{tr('How the engine detects it', 'Как это определяет движок')}</SubHeading>
            <p className="text-sm text-textSecondary mb-3">
              {language === 'ru' ? (
                <>
                  Сервер хранит <strong className="text-textPrimary">скользящую историю цен</strong> по каждому токену на каждой подписанной бирже.
                  На каждом тике WebSocket (субсекундно) он проверяет, отличается ли самая старая цена в вашем окне
                  от текущей на величину ≥ порога. На этапе проверки нет сетевых запросов —
                  всё читается из памяти. Дополнительно есть страхующая проверка каждые 10 секунд.
                </>
              ) : (
                <>
                  The server maintains a <strong className="text-textPrimary">rolling price history</strong> for every token on every subscribed exchange.
                  On every WebSocket price tick (sub-second), it checks whether the oldest price in your window
                  differs from the current price by ≥ your threshold. There is zero network I/O per evaluation —
                  everything reads from memory. A backup sweep also runs every 10 seconds.
                </>
              )}
            </p>

            <Callout type="tip">
              {tr(
                'Complex alerts are ideal for catching breakouts before they\'re over. Instead of setting fixed targets you\'d have to update constantly, a "5% in 5 minutes" rule catches any token that suddenly explodes — automatically.',
                'Сложные оповещения идеально подходят для ловли пробоев до того, как движение закончится. Вместо постоянного обновления фиксированных целей правило "5% за 5 минут" автоматически ловит любой резко выстреливший токен.'
              )}
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              7. TELEGRAM BOTS
          ══════════════════════════════════════ */}
          <section id="telegram">
            <SectionHeading id="telegram" emoji="📱" title={tr('Telegram Bots', 'Telegram-боты')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  Подключите аккаунт к <strong className="text-textPrimary">Telegram-боту</strong>, чтобы получать мгновенные push-уведомления
                  на телефон при каждом срабатывании оповещения — даже когда приложение закрыто, а экран выключен.
                </>
              ) : (
                <>
                  Connect your account to a <strong className="text-textPrimary">Telegram bot</strong> to receive instant push notifications
                  on your phone every time an alert fires — even when the app is closed or your screen is off.
                </>
              )}
            </p>

            <SubHeading>{tr('How to connect', 'Как подключить')}</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {(language === 'ru' ? [
                'Откройте страницу Telegram Bots в боковом меню.',
                'Нажмите "Connect" на карточке Alert Bot.',
                'Вас перекинет в Telegram — нажмите "Start" в чате бота.',
                'Telegram-аккаунт подключён. Все будущие срабатывания будут приходить туда.',
              ] : [
                'Go to the Telegram Bots page from the sidebar.',
                'Click "Connect" on the Alert Bot card.',
                'You\'ll be redirected to Telegram — press "Start" in the bot chat.',
                'Your Telegram account is now linked. All future alert triggers will be sent there.',
              ]).map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <SubHeading>{tr('What a notification looks like', 'Как выглядит уведомление')}</SubHeading>
            <div className="rounded-xl border border-border bg-surface/80 px-4 py-3 text-sm font-mono text-textPrimary mb-4">
              <div className="text-xs text-textSecondary mb-1">{tr('Telegram message', 'Сообщение в Telegram')}</div>
              🔔 <strong>BTC Resistance Break</strong><br />
              {tr('BTCUSDT — Price crossed above $91,000', 'BTCUSDT — Цена пересекла $91,000 вверх')}<br />
              {tr('From: $87,420 → Now: $91,055', 'Было: $87,420 → Сейчас: $91,055')}<br />
              {tr('Exchange: Binance Futures', 'Биржа: Binance Futures')}
            </div>

            <Callout type="tip">
              {tr(
                'Telegram notifications work even if you close the browser or turn your computer off. The server sends the message directly to your Telegram account the instant the alert triggers.',
                'Telegram-уведомления работают даже если вы закрыли браузер или выключили компьютер. Сервер отправляет сообщение прямо в ваш Telegram в момент срабатывания оповещения.'
              )}
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              8. WALL SCANNER
          ══════════════════════════════════════ */}
          <section id="wall-scanner">
            <SectionHeading id="wall-scanner" emoji="🧱" title={tr('Wall Scanner', 'Сканер стенок')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Сканер стенок</strong> показывает необычно крупные лимитные заявки ("стенки")
                  в стаканах Binance, Bybit и OKX — в реальном времени и в удобном формате.
                </>
              ) : (
                <>
                  The <strong className="text-textPrimary">Wall Scanner</strong> lets you see unusually large limit orders (known as "walls")
                  sitting in the order books of Binance, Bybit, and OKX — in real time and in a readable format.
                </>
              )}
            </p>

            <SubHeading>{tr('Why walls matter', 'Почему стенки важны')}</SubHeading>
            <p className="text-sm text-textSecondary mb-4">
              {tr(
                'Large limit orders act as price magnets or barriers. A massive buy wall at $90,000 often acts as support — price bounces off it. A large sell wall at $92,000 creates resistance. Spotting these early gives you context that isn\'t visible on a standard candlestick chart.',
                'Крупные лимитные заявки работают как магниты или барьеры для цены. Мощная стенка на покупку у $90,000 часто выступает поддержкой — цена отскакивает. Крупная стенка на продажу у $92,000 создаёт сопротивление. Раннее обнаружение даёт контекст, которого не видно на обычном свечном графике.'
              )}
            </p>

            <SubHeading>{tr('What you can do', 'Что можно делать')}</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary">
              {(language === 'ru' ? [
                'Смотреть крупнейшие открытые лимитные заявки сразу по нескольким токенам.',
                'Фильтровать по бирже: Binance, Bybit, OKX.',
                'Видеть размер заявки в USD и уровень цены, на котором она стоит.',
                'Обновлять в реальном времени — отменённые или исполненные стенки исчезают автоматически.',
                'Использовать данные для поиска сильных уровней поддержки/сопротивления перед входом в сделку.',
              ] : [
                'View the largest open limit orders across multiple tokens at once.',
                'Filter by exchange: Binance, Bybit, OKX.',
                'See the order size in USD and the price level it sits at.',
                'Refresh in real time — walls that are cancelled or filled disappear automatically.',
                'Use it to identify strong support/resistance levels before entering a trade.',
              ]).map((point, i) => (
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
            <SectionHeading id="listings" emoji="📋" title={tr('Listings', 'Листинги')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Страница Listings</strong> показывает предстоящие и недавние запуски фьючерсных контрактов
                  на Binance, Bybit и OKX. Новые листинги часто сопровождаются высокой волатильностью —
                  если знать о них заранее, можно подготовиться.
                </>
              ) : (
                <>
                  The <strong className="text-textPrimary">Listings page</strong> shows upcoming and recently added futures contract launches
                  across Binance, Bybit, and OKX. New listings frequently come with large price volatility —
                  knowing about them in advance lets you prepare.
                </>
              )}
            </p>

            <SubHeading>{tr('What you see', 'Что вы видите')}</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {(language === 'ru' ? [
                'Название токена, тикер и биржа, где происходит листинг.',
                'Запланированная дата и время запуска новых фьючерсных контрактов.',
                'Недавние листинги за последние дни.',
                'Брендинг бирж, чтобы сразу понимать, где проходит листинг.',
              ] : [
                'Token name, ticker, and the exchange it\'s listing on.',
                'The scheduled launch date and time for new futures contracts.',
                'Recent listings from the past several days.',
                'Exchange branding so you can instantly tell where each listing is happening.',
              ]).map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <Callout type="info">
              {tr(
                'When a new token gets a futures listing on Binance or Bybit, it often moves 20–100%+ in the first hours. This page helps you know what\'s coming so you can set up alerts or watch the chart at launch time.',
                'Когда новый токен получает фьючерсный листинг на Binance или Bybit, он часто проходит 20–100%+ в первые часы. Эта страница помогает заранее узнать, что будет, чтобы вы могли настроить оповещения или следить за графиком в момент запуска.'
              )}
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              10. WATCHLIST
          ══════════════════════════════════════ */}
          <section id="watchlist">
            <SectionHeading id="watchlist" emoji="⭐" title={tr('Watchlist', 'Вотчлист')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  <strong className="text-textPrimary">Вотчлист</strong> — это сохранённая группа токенов, за которыми вы следите регулярно.
                  Вместо постоянного поиска одних и тех же монет в каждой сессии, сохраните их один раз и открывайте мгновенно.
                </>
              ) : (
                <>
                  A <strong className="text-textPrimary">Watchlist</strong> is a saved group of tokens you follow regularly.
                  Instead of searching for the same coins every session, save them once and access them instantly.
                </>
              )}
            </p>

            <SubHeading>{tr('How to use it', 'Как пользоваться')}</SubHeading>
            <ol className="space-y-2.5 text-sm text-textSecondary list-none mb-4">
              {(language === 'ru' ? [
                'На странице Market найдите токен, который хотите отслеживать.',
                'Нажмите иконку звезды рядом с токеном, чтобы добавить его в основной вотчлист.',
                'Вы можете создать несколько именованных вотчлистов для разных стратегий.',
                'Переключайтесь между вотчлистами в панели токенов, чтобы видеть только сохранённые активы.',
              ] : [
                'On the Market page, find any token you want to track.',
                'Click the star icon next to the token to add it to your default watchlist.',
                'You can create multiple named watchlists to keep different strategies separate.',
                'Switch to any watchlist in the token panel to see only your saved tokens.',
              ]).map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <Callout type="tip">
              {tr(
                'Use separate watchlists for different strategies — e.g. one for large-caps you hold, another for high-volatility tokens you scalp, and a third for tokens you\'re watching for breakouts.',
                'Используйте отдельные вотчлисты для разных стратегий — например, один для крупных активов, второй для высоковолатильных монет под скальпинг и третий для токенов на пробой.'
              )}
            </Callout>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              11. SUBSCRIPTION
          ══════════════════════════════════════ */}
          <section id="subscription">
            <SectionHeading id="subscription" emoji="💎" title={tr('Subscription', 'Подписка')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  В CryptoAlerts есть <strong className="text-textPrimary">Free-тариф</strong> и <strong className="text-textPrimary">Pro-тариф</strong>.
                  Free даёт доступ к популярным токенам. Pro открывает полный функционал.
                </>
              ) : (
                <>
                  CryptoAlerts has a <strong className="text-textPrimary">Free tier</strong> and a <strong className="text-textPrimary">Pro tier</strong>.
                  The Free tier gives you access to popular tokens. Pro unlocks everything.
                </>
              )}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="rounded-xl border border-border bg-surface/60 p-4">
                <div className="text-sm font-bold text-textPrimary mb-2">{tr('Free', 'Бесплатный')}</div>
                <ul className="space-y-1 text-xs text-textSecondary">
                  {(language === 'ru' ? ['Только популярные токены', 'Базовые рыночные графики', 'Базовые функции сообщества'] : ['Popular tokens only', 'Basic market charts', 'Community features']).map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />{f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-pink-500/40 bg-pink-500/5 p-4">
                <div className="text-sm font-bold text-pink-300 mb-2">Pro ✨</div>
                <ul className="space-y-1 text-xs text-textSecondary">
                  {(language === 'ru' ? [
                    'Все биржи и рынки',
                    'Ценовые и сложные оповещения',
                    'Market Map (живой рейтинг)',
                    'Сканер стенок',
                    'Трекер листингов',
                    'Telegram-уведомления',
                    'Вотчлисты',
                    'Мульти-графики',
                  ] : [
                    'All exchanges & markets',
                    'Price alerts & complex alerts',
                    'Market Map (live rankings)',
                    'Wall Scanner',
                    'Listings tracker',
                    'Telegram notifications',
                    'Watchlists',
                    'Multi-chart layout',
                  ]).map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-pink-400 shrink-0" />{f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="text-sm text-textSecondary">
              {language === 'ru' ? (
                <>
                  Оплата обрабатывается через <strong className="text-textPrimary">NOWPayments</strong> и поддерживает
                  BTC, ETH, SOL, USDT (TRC-20, BEP-20, Arbitrum) и многие другие криптовалюты.
                  Подписка активируется автоматически после on-chain подтверждения платежа.
                </>
              ) : (
                <>
                  Payment is handled via <strong className="text-textPrimary">NOWPayments</strong> and supports
                  BTC, ETH, SOL, USDT (TRC-20, BEP-20, Arbitrum), and many other cryptocurrencies.
                  Your subscription is activated automatically after payment is confirmed on-chain.
                </>
              )}
            </p>
          </section>

          <Divider />

          {/* ══════════════════════════════════════
              12. ACCOUNT & PROFILE
          ══════════════════════════════════════ */}
          <section id="account">
            <SectionHeading id="account" emoji="👤" title={tr('Account & Profile', 'Аккаунт и профиль')} />
            <p className="text-textSecondary leading-relaxed mb-4">
              {language === 'ru' ? (
                <>
                  Ваша <strong className="text-textPrimary">страница Account</strong> — это домашний дашборд: статус подписки,
                  количество активных оповещений и размер вотчлиста видны с первого взгляда.
                </>
              ) : (
                <>
                  Your <strong className="text-textPrimary">Account page</strong> is the home dashboard — it shows your subscription status,
                  how many active alerts you have, and your watchlist count at a glance.
                </>
              )}
            </p>

            <SubHeading>{tr('What you can manage', 'Что можно настроить')}</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary mb-4">
              {(language === 'ru' ? [
                'Обновляйте отображаемое имя и email.',
                'Меняйте пароль в любой момент на странице Profile.',
                'Смотрите тариф (Free / Pro) и дату создания аккаунта.',
                'Следите за ключевыми метриками: активные оповещения, размер вотчлиста и уровень аккаунта.',
              ] : [
                'Update your display name and email address.',
                'Change your password at any time from the Profile page.',
                'See your subscription plan (Free / Pro) and the date your account was created.',
                'Track at a glance: active alert count, watchlist size, and account tier.',
              ]).map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <SubHeading>{tr('Authentication', 'Аутентификация')}</SubHeading>
            <ul className="space-y-1.5 text-sm text-textSecondary">
              {(language === 'ru' ? [
                'Регистрируйте новый аккаунт по email и паролю.',
                'Забыли пароль? Используйте ссылку "Forgot Password" на странице входа, чтобы получить reset-ссылку на email.',
                'Все сессии работают на защищённых JWT-токенах с автообновлением.',
                'Выход из аккаунта в боковом меню сразу отзывает текущую сессию.',
              ] : [
                'Register a new account with email and password.',
                'Forgot your password? Use the "Forgot Password" link on the login page to receive a reset link by email.',
                'All sessions use secure JWT tokens with automatic refresh.',
                'Logging out from the sidebar revokes your session immediately.',
              ]).map((point, i) => (
                <li key={i} className="flex gap-2">
                  <ChevronRight className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <Callout type="info">
              {tr(
                'The Market page and Market Map are publicly accessible — no login required. Alerts, Telegram Bots, Wall Scanner, Listings, and Watchlists require an account.',
                'Страницы Market и Market Map доступны публично — вход не требуется. Для Alerts, Telegram Bots, Wall Scanner, Listings и Watchlists нужен аккаунт.'
              )}
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
