import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { init, dispose, registerIndicator } from 'klinecharts';
import { registerCustomShapeOverlays } from './overlays/customShapeOverlays';
import { cn } from '../../utils/cn';
import LoadingSpinner from '../common/LoadingSpinner';
import Button from '../common/Button';
import { RefreshCw, AlertCircle, X } from 'lucide-react';
import ChartToolbar from './ChartToolbar';
import IndicatorsModal from './IndicatorsModal';
import ChartSettingsModal from './ChartSettingsModal';
import CreateAlertModal from '../alerts/CreateAlertModal';
import RealtimeIndicator from '../market/RealtimeIndicator';
import OverlayContextMenu from './OverlayContextMenu';
import IndicatorsButton from './IndicatorsButton';
import { useToastStore } from '../../store/toastStore';
import { getThemePalette } from '../../utils/themePalette';

// Drawing tool constants
export const DRAWING_TOOLS = {
  STRAIGHT_LINE: 'straightLine',
  RAY_LINE: 'rayLine',
  SEGMENT: 'segment',
  HORIZONTAL_STRAIGHT_LINE: 'horizontalStraightLine',
  HORIZONTAL_RAY_LINE: 'horizontalRayLine',
  HORIZONTAL_SEGMENT: 'horizontalSegment',
  VERTICAL_STRAIGHT_LINE: 'verticalStraightLine',
  VERTICAL_RAY_LINE: 'verticalRayLine',
  VERTICAL_SEGMENT: 'verticalSegment',
  PRICE_LINE: 'priceLine',
  PRICE_CHANNEL_LINE: 'priceChannelLine',
  PARALLEL_LINE: 'parallelLine',
  PARALLEL_STRAIGHT_LINE: 'parallelStraightLine',
  FIBONACCI_LINE: 'fibonacciLine',
  CIRCLE: 'circle',
  TRIANGLE: 'triangle',
  RANGE_MEASUREMENT: 'rangeMeasurement',
  SIMPLE_ANNOTATION: 'simpleAnnotation',
  SIMPLE_TAG: 'simpleTag',
};

// Indicator constants
export const INDICATORS = {
  // Moving Averages (can be stacked on candlestick)
  MA: 'MA',           // Moving Average
  EMA: 'EMA',         // Exponential Moving Average
  SMA: 'SMA',         // Simple Moving Average
  BBI: 'BBI',         // Bull and Bear Index
  
  // Bollinger Bands (can be stacked)
  BOLL: 'BOLL',       // Bollinger Bands
  
  // Trend Indicators
  SAR: 'SAR',         // Parabolic SAR (can be stacked)
  MACD: 'MACD',       // Moving Average Convergence Divergence
  DMI: 'DMI',         // Directional Movement Index
  
  // Momentum Indicators
  RSI: 'RSI',         // Relative Strength Index
  KDJ: 'KDJ',         // Stochastic Oscillator
  CCI: 'CCI',         // Commodity Channel Index
  WR: 'WR',           // Williams %R
  
  // Volume Indicators
  VOL: 'VOL',         // Volume
  MAVOL: 'MAVOL',     // Moving Average Volume
  
  // Other
  OBV: 'OBV',         // On Balance Volume
  ATR: 'ATR',         // Average True Range
};

// Returns appropriate decimal precision for a given price value.
// Prevents e.g. BTC showing '68,752.30000000' on compact cards.
const calcPricePrecision = (price) => {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 2;
  if (p >= 100) return 2;
  if (p >= 10) return 3;
  if (p >= 1) return 4;
  if (p >= 0.1) return 5;
  if (p >= 0.01) return 6;
  return 8;
};

// ===========================================================================
// Indicator tooltip $ currency formatting helpers
// ===========================================================================

// Indicators whose values are in price (USDT) units — show "$" prefix
const PRICE_TOOLTIP_INDICATORS = new Set([
  'MA', 'EMA', 'SMA', 'BBI', 'BOLL', 'SAR', 'DMA', 'AO', 'MACD', 'ATR', 'EMV', 'MTM',
]);
// Indicators whose values are in USDT volume (large numbers) — show "$" with compact suffix
const VOLUME_TOOLTIP_INDICATORS = new Set(['VOL', 'MAVOL', 'OBV', 'PVT']);

/**
 * Format a price/delta value with a $ prefix and sensible decimal places.
 * Handles negative MACD-style values: shows "-$0.0012" instead of "$-0.0012".
 */
function formatIndicatorPriceValue(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  let decimals;
  if (abs >= 100) decimals = 2;
  else if (abs >= 10) decimals = 3;
  else if (abs >= 1) decimals = 4;
  else if (abs >= 0.1) decimals = 5;
  else decimals = 6;
  return `${sign}$${abs.toFixed(decimals)}`;
}

/**
 * Format a USDT volume value with compact suffix (K/M/B/T) and $ prefix.
 */
function formatIndicatorVolumeValue(value) {
  if (!Number.isFinite(value) || value < 0) return 'n/a';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(3)}T`;
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(3)}B`;
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(3)}M`;
  if (value >= 1e3)  return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * createTooltipDataSource for price-denominated indicators.
 * Reads indicator.result at crosshair.dataIndex and formats each figure value with $.
 */
function createPriceIndicatorTooltip({ indicator, crosshair }) {
  const data = indicator.result?.[crosshair.dataIndex];
  if (!data) return {};
  const legends = (indicator.figures ?? [])
    .filter(f => typeof f.title === 'string' && f.title.length > 0)
    .map(f => ({
      title: f.title,
      value: formatIndicatorPriceValue(data[f.key]),
    }));
  return legends.length > 0 ? { legends } : {};
}

/**
 * createTooltipDataSource for USDT-volume indicators (VOL, OBV, etc.).
 */
function createVolumeIndicatorTooltip({ indicator, crosshair }) {
  const data = indicator.result?.[crosshair.dataIndex];
  if (!data) return {};
  const legends = (indicator.figures ?? [])
    .filter(f => typeof f.title === 'string' && f.title.length > 0)
    .map(f => ({
      title: f.title,
      value: formatIndicatorVolumeValue(data[f.key]),
    }));
  return legends.length > 0 ? { legends } : {};
}

// Register a custom VOL indicator that uses only the `volume` field.
// This keeps Market Map volume behavior consistent with live websocket updates.
// Registered once at module load so every chart instance shares the same definition.
(function registerCustomVolIndicator() {
  try {
    registerIndicator({
      name: 'VOL',
      shortName: 'VOL',
      series: 'volume',
      calcParams: [5, 10, 20],
      shouldFormatBigNumber: true,
      precision: 0,
      minValue: 0,
      regenerateFigures: (params) => {
        const maFigures = params.map((p, i) => ({
          key: `ma${i + 1}`,
          title: `MA${p}: `,
          type: 'line',
        }));
        maFigures.push({
          key: 'volume',
          title: 'VOLUME: ',
          type: 'bar',
          baseValue: 0,
          styles: ({ data }) => {
            const cur = data?.current;
            if (!cur) return {};
            return {
              color: cur.close >= cur.open
                ? 'rgba(38, 166, 154, 0.9)'
                : 'rgba(239, 83, 80, 0.9)',
            };
          },
        });
        return maFigures;
      },
      calc: (dataList, indicator) => {
        const { calcParams: params } = indicator;
        const volSums = new Array(params.length).fill(0);
        return dataList.map((kLineData, i) => {
          const vol = kLineData.volume ?? 0;
          const result = { volume: vol, open: kLineData.open, close: kLineData.close };
          params.forEach((p, idx) => {
            volSums[idx] += vol;
            if (i >= p - 1) {
              result[`ma${idx + 1}`] = volSums[idx] / p;
              volSums[idx] -= (dataList[i - (p - 1)].volume ?? 0);
            }
          });
          return result;
        });
      },
      // Show $ prefix on all VOL tooltip values (volume bar + MA lines)
      createTooltipDataSource: createVolumeIndicatorTooltip,
    });
  } catch (e) {
    // Silently ignore if already registered or API unavailable
  }
}());

const KLineChart = ({
  data,
  symbol = 'BTCUSDT',
  interval = '15m',
  loading = false,
  error = null,
  className,
  onTimeframeChange,
  isRealtimeConnected = false,
  isRealtimeSubscribed = false,
  instanceId = 'default',
  compact = false,
  onHeaderClick = null,
  timeframePosition = 'right',
  alertExchange = 'binance',
  alertMarket = 'futures',
  alertCurrentPrice = null,
  headerRightActions = null,
  hasMoreHistory = false,
  onLoadMoreHistory,
  showVolumeIndicator = false,
  stackVolumeInMainPane = false,
  showInlineVolumeOverlay = false,
  showCenterWatermark = false,
  watermarkText = '',
  watermarkOpacity = 0.08,
  hideCompactHeader = false,
}) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const chartIdRef = useRef(`kline-chart-${symbol}-${instanceId}-${Date.now()}`);
  const [isInitialized, setIsInitialized] = useState(false);
  const dataRef = useRef(data || []); // Keep data in ref for data loader access
  const lastAppliedDataRef = useRef({
    count: 0,
    lastTime: null,
    lastClose: null,
  });
  const pendingResetRafRef = useRef(null);
  // Set to true when interval changes so the next data update does a full
  // resetData() (replacing all candles) rather than just pushing the latest candle.
  const pendingIntervalChangeRef = useRef(false);
  const onLoadMoreHistoryRef = useRef(onLoadMoreHistory);
  const hasMoreHistoryRef = useRef(hasMoreHistory);
  const canLoadMoreHistoryRef = useRef(true);
  // Holds the subscribeBar push callback provided by klinecharts.
  // Pushing a single candle object through this callback updates the chart
  // in-place WITHOUT resetting the viewport (unlike resetData() which snaps
  // the view back to the latest candle every time).
  const realtimeBarCallbackRef = useRef(null);
  // Tracks the pricePrecision last applied via setSymbol so we only re-call
  // it when the precision actually changes (avoids redundant redraws).
  const appliedPrecisionRef = useRef(null);
  const autoVolumeIndicatorIdRef = useRef(null);

  const centerWatermarkLabel = useMemo(() => {
    if (typeof watermarkText === 'string' && watermarkText.trim().length > 0) {
      return watermarkText.trim().toUpperCase();
    }

    const normalizedSymbol = String(symbol || '').toUpperCase();
    if (!normalizedSymbol) return '';

    const quoteSuffixes = ['USDT', 'USDC', 'USD', 'BUSD', 'FDUSD', 'TUSD', 'USDE'];
    const matchedSuffix = quoteSuffixes.find((suffix) => normalizedSymbol.endsWith(suffix));
    if (matchedSuffix) {
      const base = normalizedSymbol.slice(0, -matchedSuffix.length);
      return base || normalizedSymbol;
    }

    return normalizedSymbol;
  }, [watermarkText, symbol]);

  // Drawing tools state management
  const [activeDrawingTool, setActiveDrawingTool] = useState(null);
  const overlaysRef = useRef([]); // Store overlay IDs: [{ id, type, name, visible, locked }]
  const [drawingsLocked, setDrawingsLocked] = useState(false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [magnetMode, setMagnetMode] = useState('normal'); // 'normal' | 'weak_magnet' | 'strong_magnet'

  // Indicators state management
  const [indicators, setIndicators] = useState([]); // Store indicator configs: [{ id, name, params, visible, isStack }]
  const indicatorsRef = useRef([]); // Ref for cleanup access
  // intervalRef keeps the current interval accessible inside callbacks (like
  // handleGetBars) that are wrapped in useCallback without re-creating them on
  // every interval change – avoiding unnecessary chart re-initialisation.
  const intervalRef = useRef(interval);
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCreateAlertModal, setShowCreateAlertModal] = useState(false);

  // Overlay context menu state
  const [contextMenu, setContextMenu] = useState(null); // { position: { x, y }, overlay: { id, type, ... } }

  // Stable overlay event handler: shows context menu on click/right-click
  const showOverlayContextMenu = useCallback((event) => {
    if (!event || !event.overlay) return;

    const overlay = event.overlay;
    const position = {
      x: event.pageX ?? event.x ?? 200,
      y: event.pageY ?? event.y ?? 200,
    };

    setContextMenu({
      position,
      overlay: {
        id: overlay.id,
        type: overlay.name,
        name: overlay.name,
        styles: overlay.styles || {},
      },
    });
  }, []);

  // Shared event handlers object passed to every createOverlay / overrideOverlay call
  const overlayEventHandlersRef = useRef(null);
  overlayEventHandlersRef.current = {
    onClick: showOverlayContextMenu,
    onRightClick: showOverlayContextMenu,
    onDrawEnd: (event) => {
      if (!event?.overlay) return;
      const overlay = event.overlay;
      // Track the newly finished overlay
      const exists = overlaysRef.current.some(o => o.id === overlay.id);
      if (!exists) {
        overlaysRef.current.push({
          id: overlay.id,
          type: overlay.name,
          name: overlay.name,
          visible: true,
          locked: false,
        });
      }
    },
  };

  const addToast = useToastStore((state) => state.addToast);

  // Map interval to KLineChart period format (klinecharts supports type: 'second')
  const mapIntervalToPeriod = (interval) => {
    const intervalMap = {
      '1s': { span: 1, type: 'second' },
      '5s': { span: 5, type: 'second' },
      '15s': { span: 15, type: 'second' },
      '1m': { span: 1, type: 'minute' },
      '5m': { span: 5, type: 'minute' },
      '15m': { span: 15, type: 'minute' },
      '30m': { span: 30, type: 'minute' },
      '1h': { span: 1, type: 'hour' },
      '4h': { span: 4, type: 'hour' },
      '1d': { span: 1, type: 'day' },
    };
    return intervalMap[interval] || { span: 15, type: 'minute' };
  };

  // Available timeframes for the selector (must match mapIntervalToPeriod keys)
  const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];
  const isTimeframeLeft = timeframePosition === 'left';
  const shouldShowHeader = !(compact && hideCompactHeader);
  const applyCompactViewportDefaults = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || !compact) return;

    try {
      if (typeof chart.setOffsetRightDistance === 'function') {
        chart.setOffsetRightDistance(6);
      }
      if (typeof chart.setBarSpace === 'function') {
        chart.setBarSpace(4);
      }
      if (typeof chart.scrollToRealTime === 'function') {
        chart.scrollToRealTime();
      }
    } catch {
      // noop for incompatible klinecharts builds
    }
  }, [compact]);
  const inlineVolumeBars = useMemo(() => {
    if (!showInlineVolumeOverlay || !Array.isArray(data) || data.length === 0) return [];

    const tail = data.slice(-110);
    const maxVolume = tail.reduce((max, candle) => {
      const vol = Number(candle?.volume || 0);
      return Number.isFinite(vol) && vol > max ? vol : max;
    }, 0);

    if (!Number.isFinite(maxVolume) || maxVolume <= 0) return [];

    return tail.map((candle, index) => {
      const open = Number(candle?.open || 0);
      const close = Number(candle?.close || 0);
      const volume = Number(candle?.volume || 0);
      const ratio = Math.max(0.04, Math.min(1, volume / maxVolume));

      return {
        key: `${Number(candle?.time || index)}-${index}`,
        ratio,
        isUp: close >= open,
      };
    });
  }, [data, showInlineVolumeOverlay]);
  const explicitAlertPrice = useMemo(() => {
    const value = Number(alertCurrentPrice);
    return Number.isFinite(value) && value > 0 ? String(value) : '';
  }, [alertCurrentPrice]);
  const latestClose = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return '';
    const lastCandle = data[data.length - 1];
    const candidate = Number(lastCandle?.close);
    return Number.isFinite(candidate) ? String(candidate) : '';
  }, [data]);
  const effectiveAlertPrice = explicitAlertPrice || latestClose;
  const alertInitialData = useMemo(
    () => ({
      symbol,
      exchange: alertExchange,
      market: alertMarket,
      currentPrice: effectiveAlertPrice,
      targetValue: effectiveAlertPrice,
    }),
    [symbol, alertExchange, alertMarket, effectiveAlertPrice]
  );

  // Transform backend data to KLineChart format
  const transformDataForKLineChart = useCallback((backendData) => {
    if (!backendData || !Array.isArray(backendData)) {
      console.warn('[KLineChart] Invalid backend data:', backendData);
      return [];
    }

    const transformedData = [];
    const invalidIndices = [];

    backendData.forEach((candle, index) => {
      // Backend format: { time: UnixSeconds, open, high, low, close, volume }
      // KLineChart format: { timestamp: milliseconds, open, high, low, close, volume }
      
      let timestamp = candle.time;
      
      // Convert to number if string
      if (typeof timestamp === 'string') {
        timestamp = parseFloat(timestamp);
      }
      
      // Convert seconds to milliseconds if needed (Unix seconds < 10000000000)
      if (timestamp < 10000000000) {
        timestamp = timestamp * 1000;
      }
      
      // Ensure all values are numbers
      const open = typeof candle.open === 'string' ? parseFloat(candle.open) : Number(candle.open);
      const high = typeof candle.high === 'string' ? parseFloat(candle.high) : Number(candle.high);
      const low = typeof candle.low === 'string' ? parseFloat(candle.low) : Number(candle.low);
      const close = typeof candle.close === 'string' ? parseFloat(candle.close) : Number(candle.close);
      const volume = typeof candle.volume === 'string' ? parseFloat(candle.volume) : Number(candle.volume || 0);
      const turnover = typeof candle.turnover === 'string' ? parseFloat(candle.turnover) : Number(candle.turnover || 0);

      // Validate data
      if (
        isNaN(timestamp) || !isFinite(timestamp) ||
        isNaN(open) || !isFinite(open) ||
        isNaN(high) || !isFinite(high) ||
        isNaN(low) || !isFinite(low) ||
        isNaN(close) || !isFinite(close) ||
        isNaN(volume) || !isFinite(volume)
      ) {
        console.warn(`[KLineChart] Invalid data at index ${index}:`, candle);
        invalidIndices.push(index);
        return; // Skip invalid data point
      }

      // Validate OHLC logic
      if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
        console.warn(`[KLineChart] Invalid OHLC logic at index ${index}:`, {
          open, high, low, close
        });
        invalidIndices.push(index);
        return; // Skip invalid data point
      }

      // Validate positive prices
      if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
        console.warn(`[KLineChart] Invalid price values at index ${index}:`, {
          open, high, low, close
        });
        invalidIndices.push(index);
        return; // Skip invalid data point
      }

      transformedData.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume,
        turnover,
      });
    });

    if (invalidIndices.length > 0) {
      console.warn(`[KLineChart] Filtered out ${invalidIndices.length} invalid data points out of ${backendData.length} total`);
    }

    return transformedData;
  }, []);

  useEffect(() => {
    onLoadMoreHistoryRef.current = onLoadMoreHistory;
  }, [onLoadMoreHistory]);

  useEffect(() => {
    hasMoreHistoryRef.current = !!hasMoreHistory;
    // When the store says there IS more history, re-enable scrolling in case it
    // was previously blocked by an empty response (e.g. a transient network error
    // or the first cross-exchange fallback page having no results).
    if (hasMoreHistory) {
      canLoadMoreHistoryRef.current = true;
    }
  }, [hasMoreHistory]);

  useEffect(() => {
    canLoadMoreHistoryRef.current = true;
    // Reset so the precision-sync effect re-applies correct decimals for the
    // new symbol (e.g. switching from BTC ~65000 → XRP ~1.44 needs precision 4).
    appliedPrecisionRef.current = null;
    // Also reset data signature so the realtime-update effect applies the new
    // interval's candles even if the array length happens to be identical.
    lastAppliedDataRef.current = { count: 0, lastTime: null, lastClose: null };
    intervalRef.current = interval;
    // Mark that the next data update needs a full resetData() to replace all
    // historical candles for the new interval (not just the latest candle).
    pendingIntervalChangeRef.current = true;
  }, [symbol, interval]);

  const handleGetBars = useCallback(async ({ type, timestamp, callback }) => {
    if (typeof callback !== 'function') return;

    if (type === 'forward') {
      const loadMoreFn = onLoadMoreHistoryRef.current;
      if (!canLoadMoreHistoryRef.current || typeof loadMoreFn !== 'function') {
        callback([], { forward: false, backward: false });
        return;
      }

      try {
        const olderCandles = await loadMoreFn({
          type,
          timestamp,
          symbol,
          interval: intervalRef.current,
        });
        const transformedOlder = transformDataForKLineChart(olderCandles || []);
        if (transformedOlder.length === 0) {
          // No older data returned. Disable further scrolling UNLESS the store
          // still says there is more history (the store updates after each fetch).
          // We check hasMoreHistoryRef which is kept in sync with the prop.
          canLoadMoreHistoryRef.current = hasMoreHistoryRef.current;
          callback([], { forward: hasMoreHistoryRef.current, backward: false });
          return;
        }
        callback(transformedOlder, {
          forward: true,
          backward: false,
        });
      } catch (error) {
        console.error('[KLineChart] Failed to load older history:', error);
        // On error, don't permanently disable – allow retry on next scroll.
        // The store will have set loadingOlder=false so the next scroll can proceed.
        canLoadMoreHistoryRef.current = hasMoreHistoryRef.current;
        callback([], { forward: hasMoreHistoryRef.current, backward: false });
      }
      return;
    }

    if (type === 'backward') {
      callback([], { forward: canLoadMoreHistoryRef.current, backward: false });
      return;
    }

    const transformedData = transformDataForKLineChart(dataRef.current);
    callback(transformedData, {
      forward: false,
      backward: false,
    });
  }, [symbol, transformDataForKLineChart]);

  // When interval changes (but symbol stays the same) update the period label
  // and reload data without destroying and re-creating the chart instance.
  // This preserves user-added indicators, drawings, and scroll position.
  useEffect(() => {
    if (!chartRef.current || !isInitialized) return;
    try {
      const period = mapIntervalToPeriod(interval);
      chartRef.current.setPeriod({ span: period.span, type: period.type });
      chartRef.current.resetData();
      requestAnimationFrame(() => applyCompactViewportDefaults());
    } catch (e) {
      // ignore – chart may be mid-dispose
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, isInitialized]);

  // ==================== Drawing Tools Functions ====================
  
  /**
   * Map ChartToolbar tool IDs to KLineChart overlay types
   */
  const mapToolbarIdToOverlayType = (toolbarId) => {
    const toolMap = {
      // Line tools from LineToolButton
      'line': DRAWING_TOOLS.STRAIGHT_LINE,
      'ray-line': DRAWING_TOOLS.RAY_LINE,
      'segment': DRAWING_TOOLS.SEGMENT,
      'horizontal-line': DRAWING_TOOLS.HORIZONTAL_STRAIGHT_LINE,
      'vertical-line': DRAWING_TOOLS.VERTICAL_STRAIGHT_LINE,
      // Shape tools from ShapeToolButton
      'circle': DRAWING_TOOLS.CIRCLE,
      'rectangle': DRAWING_TOOLS.PRICE_CHANNEL_LINE,
      'parallelogram': DRAWING_TOOLS.PARALLEL_STRAIGHT_LINE,
      'triangle': DRAWING_TOOLS.TRIANGLE,
      'range-measurement': DRAWING_TOOLS.RANGE_MEASUREMENT,
      // Other tools
      'fibonacci': DRAWING_TOOLS.FIBONACCI_LINE,
      'text': DRAWING_TOOLS.SIMPLE_ANNOTATION,
      'crosshair': null,
    };
    return toolMap[toolbarId] || null;
  };

  /**
   * Map KLineChart overlay types back to ChartToolbar tool IDs
   */
  const mapOverlayTypeToToolbarId = (overlayType) => {
    const reverseMap = {
      [DRAWING_TOOLS.STRAIGHT_LINE]: 'line',
      [DRAWING_TOOLS.RAY_LINE]: 'ray-line',
      [DRAWING_TOOLS.SEGMENT]: 'segment',
      [DRAWING_TOOLS.HORIZONTAL_STRAIGHT_LINE]: 'horizontal-line',
      [DRAWING_TOOLS.VERTICAL_STRAIGHT_LINE]: 'vertical-line',
      [DRAWING_TOOLS.PRICE_CHANNEL_LINE]: 'rectangle',
      [DRAWING_TOOLS.PARALLEL_STRAIGHT_LINE]: 'parallelogram',
      [DRAWING_TOOLS.CIRCLE]: 'circle',
      [DRAWING_TOOLS.TRIANGLE]: 'triangle',
      [DRAWING_TOOLS.RANGE_MEASUREMENT]: 'range-measurement',
      [DRAWING_TOOLS.FIBONACCI_LINE]: 'fibonacci',
      [DRAWING_TOOLS.SIMPLE_ANNOTATION]: 'text',
    };
    return reverseMap[overlayType] || null;
  };

  /**
   * Set the active drawing tool.
   * KLineCharts v10: calling createOverlay({ name }) without points enters
   * interactive draw mode — the user clicks on the chart to place the points.
   * Event handlers are attached at creation time so clicks work immediately.
   */
  const setDrawingTool = (toolName) => {
    if (!chartRef.current) return;

    setActiveDrawingTool(toolName);
    setContextMenu(null); // Close any open context menu

    try {
      if (toolName) {
        const handlers = overlayEventHandlersRef.current || {};
        const overlayId = chartRef.current.createOverlay({
          name: toolName,
          lock: false,
          mode: magnetMode,
          modeSensitivity: 8,
          ...handlers,
        });

        if (overlayId) {
          // onDrawEnd will add it to overlaysRef once drawing finishes
          console.log('[KLineChart] Drawing mode active:', toolName, overlayId);
        }
      }
      // When toolName is null we just clear activeDrawingTool state — 
      // KLineCharts exits draw mode automatically after a drawing is completed.
    } catch (error) {
      console.error('[KLineChart] Error setting drawing tool:', error);
    }
  };

  /**
   * Handle tool selection from ChartToolbar
   * @param {string|null} toolbarId - Tool ID from ChartToolbar
   */
  const handleToolSelect = (toolbarId) => {
    if (toolbarId === 'crosshair') {
      // Crosshair is a built-in chart feature, not an overlay
      // Toggle crosshair visibility if needed
      console.log('[KLineChart] Crosshair tool selected (handled by chart)');
      setActiveDrawingTool(null);
      return;
    }

    const overlayType = mapToolbarIdToOverlayType(toolbarId);
    setDrawingTool(overlayType);
  };

  /**
   * Create an overlay (drawing tool) on the chart.
   * Event handlers are attached at creation time so click/right-click work.
   */
  const createOverlay = (overlayType, options = {}) => {
    if (!chartRef.current) return null;

    try {
      const handlers = overlayEventHandlersRef.current || {};
      const overlayId = chartRef.current.createOverlay({
        name: overlayType,
        lock: false,
        mode: magnetMode,
        modeSensitivity: 8,
        ...handlers,
        ...options,
      });

      if (overlayId) {
        overlaysRef.current.push({
          id: overlayId,
          type: overlayType,
          name: options.name || overlayType,
          visible: options.visible !== false,
          locked: options.locked || false,
        });
      }

      return overlayId;
    } catch (error) {
      console.error('[KLineChart] Error creating overlay:', error);
      return null;
    }
  };

  /**
   * Remove an overlay from the chart using KLineCharts v10 API
   * @param {string} overlayId - ID of the overlay to remove
   * @returns {boolean} - True if successful
   */
  const removeOverlay = (overlayId) => {
    if (!chartRef.current) {
      console.warn('[KLineChart] Cannot remove overlay: chart not initialized');
      return false;
    }

    try {
      console.log('[KLineChart] Attempting to remove overlay:', overlayId);
      
      // KLineCharts v10 API: removeOverlay(filter?: OverlayFilter)
      // OverlayFilter can be { id, groupId, name, paneId }
      const result = chartRef.current.removeOverlay({ id: overlayId });
      console.log('[KLineChart] removeOverlay result:', result);
      
      // Remove from our tracking ref
      overlaysRef.current = overlaysRef.current.filter(overlay => overlay.id !== overlayId);
      
      console.log('[KLineChart] Overlay removed successfully. Remaining overlays:', overlaysRef.current.length);
      return result;
    } catch (error) {
      console.error('[KLineChart] Error removing overlay:', error);
      console.error('[KLineChart] Chart methods available:', Object.keys(chartRef.current).filter(k => typeof chartRef.current[k] === 'function'));
      return false;
    }
  };

  /**
   * Clear all overlays from the chart using KLineCharts v10 API
   */
  const clearAllOverlays = () => {
    if (!chartRef.current) {
      console.warn('[KLineChart] Cannot clear overlays: chart not initialized');
      return;
    }

    try {
      console.log('[KLineChart] Clearing all overlays');
      
      // KLineCharts v10: calling removeOverlay() without filter removes ALL overlays
      const result = chartRef.current.removeOverlay();
      console.log('[KLineChart] removeOverlay() result:', result);
      
      const count = overlaysRef.current.length;
      overlaysRef.current = [];
      setActiveDrawingTool(null);
      
      if (count > 0) {
        addToast('All drawings removed', 'info', 2000);
      }
    } catch (error) {
      console.error('[KLineChart] Error clearing overlays:', error);
    }
  };

  /**
   * Toggle lock state for all drawings
   */
  const handleToggleLock = () => {
    const newLocked = !drawingsLocked;
    setDrawingsLocked(newLocked);
    overlaysRef.current.forEach(overlay => {
      lockOverlay(overlay.id, newLocked);
    });
    addToast(newLocked ? 'Drawings locked' : 'Drawings unlocked', 'info', 2000);
  };

  /**
   * Toggle visibility for all drawings
   */
  const handleToggleVisibility = () => {
    const newVisible = !drawingsVisible;
    setDrawingsVisible(newVisible);
    overlaysRef.current.forEach(overlay => {
      toggleOverlayVisibility(overlay.id, newVisible);
    });
    addToast(newVisible ? 'Drawings visible' : 'Drawings hidden', 'info', 2000);
  };

  /**
   * Set magnet mode for overlay snapping to candle OHLC levels.
   * Applies to new overlays and updates all existing overlays.
   */
  const handleMagnetModeChange = (mode) => {
    setMagnetMode(mode);
    if (!chartRef.current) return;
    try {
      const overlays = chartRef.current.getOverlays();
      overlays.forEach((overlay) => {
        chartRef.current.overrideOverlay({ id: overlay.id, mode, modeSensitivity: 8 });
      });
    } catch (e) {
      console.warn('[KLineChart] Error applying magnet mode to overlays:', e);
    }
  };

  /**
   * Toggle overlay visibility.
   * KLineCharts v10 API: overrideOverlay({ id, visible })
   */
  const toggleOverlayVisibility = (overlayId, visible) => {
    if (!chartRef.current) return;

    try {
      chartRef.current.overrideOverlay({ id: overlayId, visible });
      const overlay = overlaysRef.current.find(o => o.id === overlayId);
      if (overlay) overlay.visible = visible;
    } catch (error) {
      console.error('[KLineChart] Error toggling overlay visibility:', error);
    }
  };

  /**
   * Lock/unlock an overlay.
   * NOTE: When locked, the overlay will NOT respond to click events.
   */
  const lockOverlay = (overlayId, locked) => {
    if (!chartRef.current) return;

    try {
      chartRef.current.overrideOverlay({ id: overlayId, lock: locked });
      const overlay = overlaysRef.current.find(o => o.id === overlayId);
      if (overlay) overlay.locked = locked;
    } catch (error) {
      console.error('[KLineChart] Error locking overlay:', error);
    }
  };

  /**
   * Get all overlays
   * @returns {array} - Array of overlay objects
   */
  const getOverlays = () => {
    return [...overlaysRef.current];
  };

  /**
   * Get all overlays from the chart using KLineCharts v10 API
   * @returns {array} - Array of overlay objects from the chart
   */
  const getAllOverlaysFromChart = () => {
    if (!chartRef.current) {
      return [];
    }

    try {
      // Use getOverlays() method from KLineCharts v10
      const overlays = chartRef.current.getOverlays();
      console.log('[KLineChart] Got overlays from chart:', overlays);
      return Array.isArray(overlays) ? overlays : [];
    } catch (error) {
      console.warn('[KLineChart] Could not get overlays from chart:', error);
      return [];
    }
  };

  /**
   * Update overlay properties (color, size, etc.) using KLineCharts v10 API
   * @param {string} overlayId - ID of the overlay to update
   * @param {object} updates - Properties to update (e.g., { color: '#ff0000', size: 3 })
   */
  const updateOverlayProperties = (overlayId, updates) => {
    if (!chartRef.current) {
      console.warn('[KLineChart] Cannot update overlay: chart not initialized');
      return;
    }

    try {
      console.log('[KLineChart] Updating overlay properties:', overlayId, updates);
      
      // Build styles object for KLineCharts v10
      const styles = {};
      
      if (updates.color) {
        // For line overlays, set the line color
        styles.line = {
          color: updates.color,
        };
        // Also set polygon color for filled shapes
        styles.polygon = {
          color: updates.color,
        };
      }
      
      if (updates.size !== undefined) {
        styles.line = styles.line || {};
        styles.line.size = updates.size;
        styles.polygon = styles.polygon || {};
        styles.polygon.borderSize = updates.size;
      }

      // KLineCharts v10 API: overrideOverlay(override: Partial<OverlayCreate>)
      const result = chartRef.current.overrideOverlay({
        id: overlayId,
        styles,
      });

      console.log('[KLineChart] overrideOverlay result:', result);

      // Update our tracking ref
      const overlay = overlaysRef.current.find(o => o.id === overlayId);
      if (overlay) {
        overlay.styles = { ...overlay.styles, ...styles };
      }
      
      return result;
    } catch (error) {
      console.error('[KLineChart] Error updating overlay properties:', error);
      return false;
    }
  };


  // ==================== Indicators Functions ====================

  /**
   * Add a technical indicator to the chart
   * @param {string} indicatorName - Name of indicator (e.g., 'MA', 'EMA', 'MACD', 'RSI', 'KDJ', 'BOLL')
   * @param {object} options - Indicator options
   * @param {array} options.params - Calculation parameters (e.g., [5, 10, 20] for MA)
   * @param {boolean} options.isStack - Whether to overlay on candlestick (for MA, EMA, SMA, BOLL, etc.)
   * @param {boolean} options.visible - Visibility state
   * @returns {string|null} - Indicator ID if successful, null otherwise
   */
  const addIndicator = (indicatorName, options = {}) => {
    if (!chartRef.current) {
      console.warn('[KLineChart] Cannot add indicator: chart not initialized');
      return null;
    }

    try {
      const { params = [], isStack = false, visible = true } = options;

      // Create indicator
      const indicatorId = chartRef.current.createIndicator(
        {
          name: indicatorName,
          calcParams: params,
          visible,
        },
        isStack
      );

      if (indicatorId) {
        // Apply $ currency formatting to tooltip for price/volume indicators
        if (PRICE_TOOLTIP_INDICATORS.has(indicatorName)) {
          try {
            chartRef.current.overrideIndicator({
              id: indicatorId,
              createTooltipDataSource: createPriceIndicatorTooltip,
            });
          } catch (e) { /* ignore */ }
        } else if (VOLUME_TOOLTIP_INDICATORS.has(indicatorName)) {
          try {
            chartRef.current.overrideIndicator({
              id: indicatorId,
              createTooltipDataSource: createVolumeIndicatorTooltip,
            });
          } catch (e) { /* ignore */ }
        }

        const indicatorConfig = {
          id: indicatorId,
          name: indicatorName,
          params,
          visible,
          isStack,
        };

        setIndicators(prev => {
          const updated = [...prev, indicatorConfig];
          indicatorsRef.current = updated;
          return updated;
        });

        console.log('[KLineChart] Indicator added:', {
          id: indicatorId,
          name: indicatorName,
          params,
          isStack,
        });
      }

      return indicatorId;
    } catch (error) {
      console.error('[KLineChart] Error adding indicator:', error);
      return null;
    }
  };

  /**
   * Remove an indicator from the chart
   * @param {string} indicatorId - ID of the indicator to remove
   * @returns {boolean} - True if successful
   */
  const removeIndicator = (indicatorId) => {
    if (!chartRef.current) {
      console.warn('[KLineChart] Cannot remove indicator: chart not initialized');
      return false;
    }

    try {
      chartRef.current.removeIndicator(indicatorId);
      
      // Remove from state
      setIndicators(prev => {
        const updated = prev.filter(ind => ind.id !== indicatorId);
        indicatorsRef.current = updated;
        return updated;
      });
      
      console.log('[KLineChart] Indicator removed:', indicatorId);
      return true;
    } catch (error) {
      console.error('[KLineChart] Error removing indicator:', error);
      return false;
    }
  };

  /**
   * Update indicator parameters or settings
   * @param {string} indicatorId - ID of the indicator
   * @param {object} updates - Updates to apply (params, visible, etc.)
   */
  const updateIndicator = (indicatorId, updates) => {
    if (!chartRef.current) {
      console.warn('[KLineChart] Cannot update indicator: chart not initialized');
      return;
    }

    try {
      chartRef.current.overrideIndicator(indicatorId, updates);
      
      // Update state
      setIndicators(prev => {
        const updated = prev.map(ind =>
          ind.id === indicatorId
            ? { ...ind, ...updates }
            : ind
        );
        indicatorsRef.current = updated;
        return updated;
      });

      console.log('[KLineChart] Indicator updated:', { indicatorId, updates });
    } catch (error) {
      console.error('[KLineChart] Error updating indicator:', error);
    }
  };

  /**
   * Clear all indicators from the chart
   */
  const clearAllIndicators = () => {
    if (!chartRef.current) {
      console.warn('[KLineChart] Cannot clear indicators: chart not initialized');
      return;
    }

    try {
      // Remove all indicators
      indicators.forEach(indicator => {
        try {
          chartRef.current.removeIndicator(indicator.id);
        } catch (error) {
          console.warn('[KLineChart] Error removing indicator:', indicator.id, error);
        }
      });

      setIndicators([]);
      indicatorsRef.current = [];
      console.log('[KLineChart] All indicators cleared');
    } catch (error) {
      console.error('[KLineChart] Error clearing indicators:', error);
    }
  };

  /**
   * Toggle indicator visibility
   * @param {string} indicatorId - ID of the indicator
   * @param {boolean} visible - Visibility state
   */
  const toggleIndicatorVisibility = (indicatorId, visible) => {
    updateIndicator(indicatorId, { visible });
  };

  /**
   * Get all indicators
   * @returns {array} - Array of indicator configs
   */
  const getIndicators = () => {
    return [...indicators];
  };

  // Expose functions via ref for parent components (optional)
  const chartFunctionsRef = useRef({
    // Drawing tools
    setDrawingTool,
    createOverlay,
    removeOverlay,
    clearAllOverlays,
    toggleOverlayVisibility,
    lockOverlay,
    getOverlays,
    // Indicators
    addIndicator,
    removeIndicator,
    updateIndicator,
    clearAllIndicators,
    toggleIndicatorVisibility,
    getIndicators,
  });

  // Update ref when functions change
  useEffect(() => {
    chartFunctionsRef.current = {
      setDrawingTool,
      createOverlay,
      removeOverlay,
      clearAllOverlays,
      toggleOverlayVisibility,
      lockOverlay,
      getOverlays,
      addIndicator,
      removeIndicator,
      updateIndicator,
      clearAllIndicators,
      toggleIndicatorVisibility,
      getIndicators,
    };
  }, []);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (chartRef.current) return;

    // Ensure data ref is up-to-date before initialization
    dataRef.current = data || [];

    // Generate unique chart ID
    const chartId = chartIdRef.current;
    const container = chartContainerRef.current;
    
    // Set container ID for KLineChart (required)
    if (!container.id) {
      container.id = chartId;
    }

    try {
      const themeColors = getThemePalette();
      registerCustomShapeOverlays();
      // Initialize chart with minimal configuration
      // Layout must be an array of pane configurations
      const chart = init(chartId, {
        // Layout: Array of pane configurations (required)
        layout: [
          {
            type: 'candle', // Main candlestick pane
            options: {
              axis: {
                scrollZoomEnabled: true, // Enable mouse wheel zoom on Y-axis panel
              },
            },
          },
          {
            type: 'xAxis', // X-axis pane
          },
        ],
        // Styles: Polished dark theme (candles, crosshair, grid, tooltip, axes)
        styles: {
          grid: {
            show: false,
            horizontal: { show: false },
            vertical: { show: false },
          },
          candle: {
            type: 'candle_solid',
            bar: {
              compareRule: 'current_open',
              upColor: themeColors.success,
              downColor: themeColors.danger,
              noChangeColor: themeColors.textSecondary,
              upBorderColor: themeColors.success,
              downBorderColor: themeColors.danger,
              noChangeBorderColor: themeColors.textSecondary,
              upWickColor: themeColors.success,
              downWickColor: themeColors.danger,
              noChangeWickColor: themeColors.textSecondary,
            },
            priceMark: {
              show: true,
              high: {
                show: true,
                color: themeColors.textSecondary,
                textMargin: 4,
                textSize: 11,
                textFamily: 'Inter, system-ui, sans-serif',
              },
              low: {
                show: true,
                color: themeColors.textSecondary,
                textMargin: 4,
                textSize: 11,
                textFamily: 'Inter, system-ui, sans-serif',
              },
              last: {
                show: true,
                compareRule: 'none',
                upColor: themeColors.textSecondary,
                downColor: themeColors.textSecondary,
                noChangeColor: themeColors.textSecondary,
                line: {
                  show: true,
                  style: 'dashed',
                  dashedValue: [4, 4],
                  size: 1,
                },
                text: {
                  show: true,
                  style: 'fill',
                  size: 11,
                  paddingLeft: 6,
                  paddingTop: 4,
                  paddingRight: 6,
                  paddingBottom: 4,
                  borderStyle: 'solid',
                  borderSize: 1,
                  borderColor: themeColors.textSecondary,
                  borderRadius: 4,
                  color: themeColors.textPrimary,
                  family: 'Inter, system-ui, sans-serif',
                  weight: '500',
                },
              },
            },
            tooltip: {
              showRule: 'none', // Disable the blue tooltip panel
            },
          },
          indicator: {
            tooltip: {
              showRule: 'always',
            },
          },
          xAxis: {
            show: true,
            axisLine: {
              show: true,
              color: themeColors.border,
              size: 1,
              style: 'solid',
            },
            tickLine: {
              show: true,
              color: themeColors.border,
              size: 1,
              length: 4,
            },
            tickText: {
              show: true,
              color: themeColors.textSecondary,
              size: 11,
              family: 'Inter, system-ui, sans-serif',
              marginStart: 4,
              marginEnd: 4,
            },
          },
          yAxis: {
            show: true,
            axisLine: {
              show: true,
              color: themeColors.border,
              size: 1,
              style: 'solid',
            },
            tickLine: {
              show: true,
              color: themeColors.border,
              size: 1,
              length: 4,
            },
            tickText: {
              show: true,
              color: themeColors.textSecondary,
              size: 11,
              family: 'Inter, system-ui, sans-serif',
              marginStart: 4,
              marginEnd: 4,
            },
          },
          separator: {
            size: 1,
            color: themeColors.border,
            fill: true,
          },
          crosshair: {
            show: true,
            horizontal: {
              show: true,
              line: {
                show: true,
                style: 'solid',
                size: 1,
                color: themeColors.border,
              },
              text: {
                show: true,
                style: 'fill',
                color: themeColors.textPrimary,
                size: 11,
                family: 'Inter, system-ui, sans-serif',
                borderStyle: 'solid',
                borderSize: 1,
                borderColor: themeColors.border,
                borderRadius: 4,
                paddingLeft: 6,
                paddingRight: 6,
                paddingTop: 4,
                paddingBottom: 4,
                backgroundColor: themeColors.surface,
              },
            },
            vertical: {
              show: true,
              line: {
                show: true,
                style: 'solid',
                size: 1,
                color: themeColors.border,
              },
              text: {
                show: true,
                style: 'fill',
                color: themeColors.textPrimary,
                size: 11,
                family: 'Inter, system-ui, sans-serif',
                borderStyle: 'solid',
                borderSize: 1,
                borderColor: themeColors.border,
                borderRadius: 4,
                paddingLeft: 6,
                paddingRight: 6,
                paddingTop: 4,
                paddingBottom: 4,
                backgroundColor: themeColors.surface,
              },
            },
          },
          background: {
            type: 'solid',
            color: '#151517',
          },
          textColor: themeColors.textPrimary,
        },
      });

      chartRef.current = chart;

      // Set up data loader (v10 API)
      // Use ref so loader always has access to latest data.
      // subscribeBar is called by klinecharts after the initial 'init' load.
      // Storing its callback lets us push individual candle updates without
      // triggering a full resetData() which would snap the viewport to the
      // latest candle and undo any user scroll-left action.
      chart.setDataLoader({
        getBars: handleGetBars,
        subscribeBar: ({ callback }) => {
          realtimeBarCallbackRef.current = callback;
        },
      });


      // Set symbol with precision settings (this triggers getBars)
      // Derive precision from last known close price so BTC shows '68,752.30'
      // not '68,752.30000000', while DOGE still shows enough decimals.
      const lastCandle = dataRef.current?.[dataRef.current.length - 1];
      const lastClose = Number(lastCandle?.close ?? 0);
      const dynamicPrecision = calcPricePrecision(lastClose);
      chart.setSymbol({
        ticker: symbol,
        pricePrecision: dynamicPrecision,
        volumePrecision: 2,
      });
      
      const period = mapIntervalToPeriod(interval);
      chart.setPeriod({
        span: period.span,
        type: period.type,
      });

      applyCompactViewportDefaults();

      setIsInitialized(true);

      // Resize once after layout so chart picks up container dimensions (fixes init with 0 size)
      const resizeTimer = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (chartRef.current) {
            try {
              chartRef.current.resize();
            } catch (e) {
              // ignore
            }
          }
        });
      });

      // Cleanup on unmount
      return () => {
        cancelAnimationFrame(resizeTimer);
        try {
          // Clear all overlays
          overlaysRef.current.forEach(overlay => {
            try {
              chartRef.current?.removeOverlay(overlay.id);
            } catch (error) {
              console.warn('[KLineChart] Error removing overlay during cleanup:', overlay.id, error);
            }
          });
          overlaysRef.current = [];

          // Clear all indicators (use ref for latest values)
          indicatorsRef.current.forEach(indicator => {
            try {
              chartRef.current?.removeIndicator(indicator.id);
            } catch (error) {
              console.warn('[KLineChart] Error removing indicator during cleanup:', indicator.id, error);
            }
          });
          setIndicators([]);
          indicatorsRef.current = [];

          // Clear realtime callback so stale pushes don't land on a new chart
          realtimeBarCallbackRef.current = null;
          autoVolumeIndicatorIdRef.current = null;

          // Dispose chart
          dispose(chartId);
          chartRef.current = null;
          setIsInitialized(false);
          setActiveDrawingTool(null);
        } catch (error) {
          console.error('[KLineChart] Error disposing chart:', error);
        }
      };
    } catch (error) {
      console.error('[KLineChart] Error initializing chart:', error);
      setIsInitialized(false);
    }
  }, [symbol, handleGetBars, applyCompactViewportDefaults]); // Re-initialize only when symbol changes; interval changes are handled by the separate period-update effect

  // Auto-enable bottom volume indicator when requested (e.g. Market Map cards).
  useEffect(() => {
    if (!chartRef.current || !isInitialized) return;

    if (!showVolumeIndicator || showInlineVolumeOverlay) {
      if (autoVolumeIndicatorIdRef.current) {
        removeIndicator(autoVolumeIndicatorIdRef.current);
        autoVolumeIndicatorIdRef.current = null;
      }
      return;
    }

    const existingVolume = indicatorsRef.current.find((indicator) => indicator.name === INDICATORS.VOL);
    if (existingVolume?.id) {
      autoVolumeIndicatorIdRef.current = existingVolume.id;
      return;
    }

    const indicatorId = addIndicator(INDICATORS.VOL, { isStack: !!stackVolumeInMainPane });
    if (indicatorId) {
      autoVolumeIndicatorIdRef.current = indicatorId;
    }
  }, [isInitialized, showVolumeIndicator, showInlineVolumeOverlay, stackVolumeInMainPane, addIndicator, removeIndicator]);

  // Resize chart when container size changes (window resize, layout change, different monitor resolution)
  // klinecharts uses container.clientWidth/clientHeight; calling resize() recaches bounding and redraws.
  useEffect(() => {
    if (!isInitialized || !chartContainerRef.current || !chartRef.current) return;
    const container = chartContainerRef.current;
    const chart = chartRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current) {
        try {
          chartRef.current.resize();
          applyCompactViewportDefaults();
        } catch (e) {
          // ignore
        }
      }
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isInitialized, applyCompactViewportDefaults]);

  // Update data ref when data prop changes
  useEffect(() => {
    dataRef.current = data || [];
  }, [data]);

  // Keep Y-axis precision in sync with the actual price.
  // At chart init time data may still be empty, so pricePrecision defaults to
  // 2 (calcPricePrecision(0)). Once real candles arrive the last close may be
  // in a different bracket (e.g. XRP ~1.44 needs precision 4, not 2). Without
  // this effect the Y-axis labels all show '1.44' instead of '1.4400 … 1.4450'.
  useEffect(() => {
    if (!chartRef.current || !isInitialized) return;
    if (!Array.isArray(data) || data.length === 0) return;

    const lastCandle = data[data.length - 1];
    const lastClose = Number(lastCandle?.close ?? 0);
    if (!Number.isFinite(lastClose) || lastClose <= 0) return;

    const newPrecision = calcPricePrecision(lastClose);
    if (appliedPrecisionRef.current === newPrecision) return;
    appliedPrecisionRef.current = newPrecision;

    try {
      chartRef.current.setSymbol({
        ticker: symbol,
        pricePrecision: newPrecision,
        volumePrecision: 2,
      });
    } catch (e) {
      // ignore – chart may be mid-dispose
    }
  }, [data, isInitialized, symbol]);

  // Apply realtime updates: when the incoming data list changes (new candle or
  // updated last candle), push the latest candle through the subscribeBar
  // callback that klinecharts provides after the initial load.
  //
  // Using subscribeBar's callback calls _addData(candle, 'update') internally,
  // which updates/appends only the last candle WITHOUT resetting the viewport.
  // This means users can scroll left to review history and the chart will NOT
  // snap back to the latest candle on every realtime tick.
  //
  // resetData() is intentionally avoided here because it triggers type='init'
  // which calls setOffsetRightDistance() and always snaps the view rightward.
  useEffect(() => {
    if (!chartRef.current || !isInitialized) return;
    if (!Array.isArray(data) || data.length === 0) return;

    const lastCandle = data[data.length - 1];
    const lastTime = Number(lastCandle?.time);
    const lastClose = Number(lastCandle?.close);
    const signature = {
      count: data.length,
      lastTime: Number.isFinite(lastTime) ? lastTime : null,
      lastClose: Number.isFinite(lastClose) ? lastClose : null,
    };

    const prev = lastAppliedDataRef.current;
    const unchanged =
      prev.count === signature.count &&
      prev.lastTime === signature.lastTime &&
      prev.lastClose === signature.lastClose;

    if (unchanged) return;
    lastAppliedDataRef.current = signature;

    if (pendingResetRafRef.current) {
      cancelAnimationFrame(pendingResetRafRef.current);
    }

    pendingResetRafRef.current = requestAnimationFrame(() => {
      pendingResetRafRef.current = null;
      if (!chartRef.current) return;
      try {
        const pushCallback = realtimeBarCallbackRef.current;
        if (pushCallback && !pendingIntervalChangeRef.current) {
          // Push only the latest candle — viewport stays where the user left it.
          const transformed = transformDataForKLineChart(dataRef.current);
          const latest = transformed[transformed.length - 1];
          if (latest) pushCallback(latest);
        } else {
          // Full reload: either subscribeBar callback not yet available (race
          // before first init load), or the interval just changed and we need to
          // replace ALL historical candles for the new timeframe.
          pendingIntervalChangeRef.current = false;
          chartRef.current.resetData();
          requestAnimationFrame(() => applyCompactViewportDefaults());
        }
      } catch (error) {
        console.error('[KLineChart] Error applying realtime update:', error);
      }
    });

    return () => {
      if (pendingResetRafRef.current) {
        cancelAnimationFrame(pendingResetRafRef.current);
        pendingResetRafRef.current = null;
      }
    };
  }, [data, isInitialized, transformDataForKLineChart, applyCompactViewportDefaults]);

  // When chart initialized before first API response, trigger one initial load.
  // Also recover from race where a realtime candle arrives before history and chart gets stuck on 1 candle.
  // Avoid resetting on normal realtime updates because it recenters view.
  useEffect(() => {
    if (!chartRef.current || !isInitialized) return;
    if (!Array.isArray(data) || data.length === 0) return;

    try {
      const currentData = chartRef.current.getDataList?.() || [];
      const incomingCount = data.length;

      if (currentData.length === 0) {
        chartRef.current.resetData();
        requestAnimationFrame(() => applyCompactViewportDefaults());
        return;
      }

      const shouldRecoverFromBootstrapRace =
        currentData.length <= 5 &&
        incomingCount >= 20 &&
        incomingCount > currentData.length * 2;

      if (shouldRecoverFromBootstrapRace) {
        chartRef.current.resetData();
        requestAnimationFrame(() => applyCompactViewportDefaults());
      }
    } catch (error) {
      console.error('[KLineChart] Error applying initial data:', error);
    }
  }, [data, isInitialized, applyCompactViewportDefaults]);

  // Loading state
  if (loading && !isInitialized) {
    return (
      <div className={cn("w-full h-full flex flex-col items-center justify-center bg-surface rounded-xl p-8", className)}>
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-textSecondary text-sm">Loading chart data...</p>
        <p className="mt-2 text-textSecondary text-xs">{symbol} • {interval}</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn("w-full h-full flex items-center justify-center bg-surface rounded-xl p-8", className)}>
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-4">
            <AlertCircle className="h-12 w-12 text-danger" />
          </div>
          <h3 className="text-lg font-semibold text-textPrimary mb-2">Failed to load chart</h3>
          <div className="bg-surfaceHover rounded-lg p-4 mb-4">
            <p className="text-danger text-sm font-medium mb-1">Error details:</p>
            <p className="text-textSecondary text-xs break-words">{error}</p>
          </div>
          {onTimeframeChange && (
            <Button
              variant="primary"
              size="md"
              onClick={() => onTimeframeChange(interval)}
              className="w-full"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Context menu handlers — keep menu open for color/size; close on delete
  const handleContextMenuColorChange = (color) => {
    if (contextMenu?.overlay) {
      updateOverlayProperties(contextMenu.overlay.id, { color });
      setContextMenu((prev) => {
        if (!prev?.overlay) return prev;
        return {
          ...prev,
          overlay: {
            ...prev.overlay,
            styles: {
              ...(prev.overlay.styles || {}),
              line: {
                ...((prev.overlay.styles && prev.overlay.styles.line) || {}),
                color,
              },
              polygon: {
                ...((prev.overlay.styles && prev.overlay.styles.polygon) || {}),
                color,
              },
            },
          },
        };
      });
    }
  };

  const handleContextMenuSizeChange = (size) => {
    if (contextMenu?.overlay) {
      updateOverlayProperties(contextMenu.overlay.id, { size });
      setContextMenu((prev) => {
        if (!prev?.overlay) return prev;
        return {
          ...prev,
          overlay: {
            ...prev.overlay,
            styles: {
              ...(prev.overlay.styles || {}),
              line: {
                ...((prev.overlay.styles && prev.overlay.styles.line) || {}),
                size,
              },
              polygon: {
                ...((prev.overlay.styles && prev.overlay.styles.polygon) || {}),
                borderSize: size,
              },
            },
          },
        };
      });
    }
  };

  const handleContextMenuDelete = () => {
    if (contextMenu?.overlay) {
      removeOverlay(contextMenu.overlay.id);
      setContextMenu(null);
    }
  };

  return (
    <div className={cn("w-full h-full flex bg-surface overflow-hidden", compact ? "rounded-lg" : "rounded-xl", className)}>
      {/* Left Sidebar - Drawing Tools Toolbar (hidden in compact mode) */}
      {!compact && (
        <ChartToolbar
          onToolSelect={handleToolSelect}
          activeTool={activeDrawingTool ? mapOverlayTypeToToolbarId(activeDrawingTool) : null}
          drawingsLocked={drawingsLocked}
          drawingsVisible={drawingsVisible}
          magnetMode={magnetMode}
          onMagnetModeChange={handleMagnetModeChange}
          onToggleLock={handleToggleLock}
          onToggleVisibility={handleToggleVisibility}
          onDeleteDrawings={clearAllOverlays}
          onSettingsClick={() => setShowSettingsModal(true)}
          onAlertsClick={() => setShowCreateAlertModal(true)}
          activeIndicatorsCount={indicators.length}
          onIndicatorsClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
          indicatorsModalOpen={showIndicatorsModal}
          className="flex-shrink-0"
        />
      )}

      {/* Overlay Toolbar (appears when clicking on a line) - hidden in compact */}
      {!compact && contextMenu && (
        <OverlayContextMenu
          position={contextMenu.position}
          overlay={contextMenu.overlay}
          onColorChange={handleContextMenuColorChange}
          onSizeChange={handleContextMenuSizeChange}
          onDelete={handleContextMenuDelete}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Center - Chart Container */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Chart header: full (symbol + Live + timeframes) or compact (symbol • interval • Live only); compact header clickable to "choose" chart */}
        {shouldShowHeader && (
          <div
            className={cn(
              "flex items-center border-b border-border bg-surface flex-shrink-0",
              compact
                ? "justify-between gap-2 px-2 py-2 rounded-t-lg min-h-[36px]"
                : isTimeframeLeft
                  ? "justify-start gap-3 px-3 py-2.5 rounded-t-xl"
                  : "justify-between gap-4 px-3 py-2.5 rounded-t-xl",
              compact && onHeaderClick && "cursor-pointer hover:bg-surfaceHover select-none"
            )}
            onClick={compact && onHeaderClick ? (e) => { e.stopPropagation(); onHeaderClick(); } : undefined}
            role={compact && onHeaderClick ? "button" : undefined}
            aria-label={compact && onHeaderClick ? "Select this chart to change token" : undefined}
            title={compact && onHeaderClick ? "Click to choose this chart, then pick a token from the list" : undefined}
          >
            <div className={cn("flex items-center gap-2 min-w-0", !compact && !isTimeframeLeft && "flex-1", compact && "flex-1")}>
              <span className={cn("font-medium text-textPrimary truncate", compact ? "text-xs" : "text-sm")}>
                {symbol}
                {interval && <span className="text-textSecondary font-normal"> • {interval}</span>}
              </span>
              <RealtimeIndicator
                isConnected={isRealtimeConnected}
                isSubscribed={isRealtimeSubscribed}
              />
              {compact && onHeaderClick && (
                <span className="text-[10px] text-textSecondary whitespace-nowrap ml-1">Click to change token</span>
              )}
            </div>
            {!compact && onTimeframeChange && (
              <div className={cn("flex items-center", isTimeframeLeft && "ml-1") }>
                <div className="flex flex-wrap gap-1">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => onTimeframeChange(tf)}
                      className={cn(
                        'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                        interval === tf
                          ? 'bg-accent text-white'
                          : 'text-textSecondary hover:bg-surfaceHover hover:text-textPrimary'
                      )}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                <div className="ml-2 pl-2 border-l border-border flex items-center">
                  <IndicatorsButton
                    activeIndicatorsCount={indicators.length}
                    onClick={() => setShowIndicatorsModal(!showIndicatorsModal)}
                    isOpen={showIndicatorsModal}
                    className="h-7 w-8 rounded-md"
                  />
                </div>
              </div>
            )}
            {!compact && headerRightActions && (
              <div className="ml-auto pl-3 flex items-center">
                {headerRightActions}
              </div>
            )}
          </div>
        )}
        {/* Chart Settings Modal */}
        <ChartSettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          chartRef={chartRef}
        />
        {/* Indicators Modal */}
        <IndicatorsModal
          isOpen={showIndicatorsModal}
          onClose={() => setShowIndicatorsModal(false)}
          activeIndicators={indicators}
          onAddIndicator={(indicatorName, options) => {
            const indicatorId = addIndicator(indicatorName, options);
            return indicatorId;
          }}
          onRemoveIndicator={removeIndicator}
          onUpdateIndicator={updateIndicator}
          onToggleVisibility={toggleIndicatorVisibility}
        />
        <CreateAlertModal
          isOpen={showCreateAlertModal}
          onClose={() => setShowCreateAlertModal(false)}
          initialData={alertInitialData}
        />

        <div className="relative flex-1 min-w-0 min-h-0">
          <div
            ref={chartContainerRef}
            id={chartIdRef.current}
            className={cn(
              "w-full h-full overflow-hidden border border-border",
              shouldShowHeader && "border-t-0",
              compact ? (shouldShowHeader ? "rounded-b-lg" : "rounded-lg") : (shouldShowHeader ? "rounded-b-xl" : "rounded-xl")
            )}
            style={{
              minHeight: 0,
              minWidth: 0,
              backgroundColor: '#151517',
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
            }}
            onContextMenu={(e) => {
              // Disable default browser right-click menu
              e.preventDefault();
              // User should click directly on the line to edit it
            }}
          />

          {showCenterWatermark && centerWatermarkLabel ? (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 px-3">
              <span
                className="text-textSecondary font-semibold tracking-[0.14em] uppercase select-none truncate"
                style={{
                  opacity: Number.isFinite(Number(watermarkOpacity)) ? Number(watermarkOpacity) : 0.08,
                  fontSize: compact ? 'clamp(20px, 4.6vw, 44px)' : 'clamp(22px, 4vw, 56px)',
                  lineHeight: 1,
                }}
              >
                {centerWatermarkLabel}
              </span>
            </div>
          ) : null}

          {showInlineVolumeOverlay && inlineVolumeBars.length > 0 ? (
            <div className="absolute left-2 right-2 bottom-1 h-[24%] pointer-events-none z-[9] flex items-end gap-[1px]">
              {inlineVolumeBars.map((bar) => (
                <div
                  key={bar.key}
                  className={cn('flex-1 min-w-0 rounded-sm', bar.isUp ? 'bg-success/45' : 'bg-danger/45')}
                  style={{ height: `${Math.round(bar.ratio * 100)}%` }}
                />
              ))}
            </div>
          ) : null}

          {/* Indicator legend with delete (X) - rendered on top of chart so it's visible */}
          {!compact && indicators.length > 0 && (
            <div
              className="absolute left-2 top-2 z-[100] flex flex-col gap-0.5 pointer-events-auto"
              aria-label="Active indicators"
            >
              {indicators.map((indicator) => {
                const label =
                  indicator.params?.length > 0
                    ? `${indicator.name}(${indicator.params.join(', ')})`
                    : indicator.name;
                return (
                  <div
                    key={indicator.id}
                    className={cn(
                      'flex items-center justify-between gap-2 min-w-[140px] max-w-[220px]',
                      'px-2.5 py-1.5 rounded-md text-xs',
                      'bg-[#1e293b] border border-[#475569] text-textPrimary shadow-lg'
                    )}
                  >
                    <span className="truncate font-medium" title={label}>
                      {label}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeIndicator(indicator.id)}
                      className={cn(
                        'flex-shrink-0 p-1 rounded transition-colors',
                        'text-textSecondary hover:text-white hover:bg-danger',
                        'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-[#1e293b]'
                      )}
                      title="Remove indicator"
                      aria-label={`Remove ${label}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KLineChart;
