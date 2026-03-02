import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { X, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import Button from '../common/Button';
import { useCandleColorStore } from '../../store/candleColorStore';
import { getThemePalette } from '../../utils/themePalette';

// ── Candle type options (klinecharts values) ─────────────────────────────
const CANDLE_TYPES = ['candle_solid', 'candle_stroke', 'candle_up_stroke', 'candle_down_stroke', 'ohlc', 'area'];

// ── Colour palette (40 swatches, 8 columns) ─────────────────────────────────
const PALETTE = [
  // Greens
  '#22c55e', '#4ade80', '#16a34a', '#00e676', '#84cc16', '#a3e635', '#65a30d', '#15803d',
  // Teals / Cyans
  '#19d7c2', '#14b8a6', '#2dd4bf', '#0ea5e9', '#06b6d4', '#22d3ee', '#38bdf8', '#7dd3fc',
  // Blues / Indigo / Violet
  '#3b82f6', '#2563eb', '#6366f1', '#818cf8', '#8b5cf6', '#a78bfa', '#c084fc', '#d946ef',
  // Pinks / Magentas / Reds
  '#ec4899', '#f472b6', '#fb7185', '#f43f5e', '#f6465d', '#ef4444', '#dc2626', '#b91c1c',
  // Deep reds / Oranges / Yellows
  '#e11d48', '#be123c', '#fb923c', '#f97316', '#ea580c', '#f59e0b', '#fbbf24', '#facc15',
];

const isValidHex = (val) => /^#[0-9a-fA-F]{6}$/.test(val);

// ── ColorPicker sub-component ─────────────────────────────────────────────
const ColorPicker = ({ label, color, themeDefault, onChange, onReset, resetLabel = 'Reset' }) => {
  const [hexInput, setHexInput] = useState(color || themeDefault || '#ffffff');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setHexInput(color || themeDefault || '#ffffff');
  }, [color, themeDefault]);

  const handleSwatch = (c) => {
    onChange(c);
    setHexInput(c);
  };

  const handleHexCommit = () => {
    if (isValidHex(hexInput)) {
      onChange(hexInput);
    } else {
      setHexInput(color || themeDefault || '#ffffff');
    }
  };

  const displayColor = color || themeDefault || '#ffffff';
  const isCustom = !!color;

  return (
    <div className="space-y-2">
      {/* Row: label + current swatch + expand toggle */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-textPrimary flex-shrink-0">{label}</span>
        <div className="flex items-center gap-2">
          {isCustom && (
            <button
              type="button"
              onClick={() => { onReset(); setHexInput(themeDefault || '#ffffff'); }}
              className="flex items-center gap-1 text-xs text-textSecondary hover:text-textPrimary transition-colors flex-shrink-0"
              title="Reset to theme default"
            >
              <RotateCcw className="h-3 w-3" />
              {resetLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border hover:border-accent/60 transition-colors"
            title="Choose colour"
          >
            <span
              className="w-5 h-5 rounded-sm border border-white/20 flex-shrink-0"
              style={{ background: displayColor }}
            />
            <span className="text-xs text-textSecondary font-mono uppercase">{displayColor}</span>
            {open
              ? <ChevronUp className="h-3 w-3 text-textSecondary" />
              : <ChevronDown className="h-3 w-3 text-textSecondary" />
            }
          </button>
        </div>
      </div>

      {/* Expandable palette */}
      {open && (
        <div className="rounded-lg border border-border bg-surfaceDark p-3 space-y-3">
          {/* Swatch grid – 8 columns */}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(8, 1fr)' }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleSwatch(c)}
                className={cn(
                  'w-full aspect-square rounded-sm border-2 transition-transform hover:scale-110',
                  displayColor.toLowerCase() === c.toLowerCase()
                    ? 'border-white shadow-md scale-110'
                    : 'border-transparent'
                )}
                style={{ background: c }}
                title={c}
                aria-label={c}
              />
            ))}
          </div>

          {/* Custom hex input */}
          <div className="flex items-center gap-2">
            <span
              className="w-6 h-6 rounded border border-border flex-shrink-0"
              style={{ background: isValidHex(hexInput) ? hexInput : '#888' }}
            />
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={handleHexCommit}
              onKeyDown={(e) => e.key === 'Enter' && handleHexCommit()}
              placeholder="#rrggbb"
              maxLength={7}
              className="flex-1 bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-textPrimary focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────
/**
 * Modal for chart display settings (grid, crosshair, candle colours).
 * Colour changes are applied live via chartRef.setStyles() and persisted
 * to localStorage through useCandleColorStore.
 */
const ChartSettingsModal = ({ isOpen, onClose, chartRef }) => {
  const { t } = useTranslation();
  const [gridVisible, setGridVisible] = useState(true);
  const [crosshairVisible, setCrosshairVisible] = useState(true);

  const upColor      = useCandleColorStore((s) => s.upColor);
  const downColor    = useCandleColorStore((s) => s.downColor);
  const candleType   = useCandleColorStore((s) => s.candleType);
  const setUpColor   = useCandleColorStore((s) => s.setUpColor);
  const setDownColor = useCandleColorStore((s) => s.setDownColor);
  const setCandleType = useCandleColorStore((s) => s.setCandleType);
  const resetColors  = useCandleColorStore((s) => s.resetColors);

  const [themeDefaults, setThemeDefaults] = useState({ up: '#19d7c2', down: '#f6465d' });

  useEffect(() => {
    if (!isOpen) return;
    // Read current theme candle defaults
    try {
      const p = getThemePalette();
      setThemeDefaults({ up: p.candleUp, down: p.candleDown });
    } catch (_) {}
    // Sync grid / crosshair from chart
    if (chartRef?.current && typeof chartRef.current.getStyles === 'function') {
      try {
        const styles = chartRef.current.getStyles();
        if (styles?.grid?.show !== undefined) setGridVisible(styles.grid.show);
        if (styles?.crosshair?.show !== undefined) setCrosshairVisible(styles.crosshair.show);
      } catch (_) {}
    }
  }, [isOpen, chartRef]);

  const applyStyles = useCallback((patch) => {
    if (!chartRef?.current || typeof chartRef.current.setStyles !== 'function') return;
    try { chartRef.current.setStyles(patch); }
    catch (e) { console.warn('[ChartSettingsModal] setStyles failed:', e); }
  }, [chartRef]);

  const applyCandleColors = useCallback((up, down) => {
    const finalUp   = up   || themeDefaults.up;
    const finalDown = down || themeDefaults.down;
    applyStyles({
      candle: {
        bar: {
          upColor:             finalUp,
          downColor:           finalDown,
          noChangeColor:       '#888888',
          upBorderColor:       finalUp,
          downBorderColor:     finalDown,
          noChangeBorderColor: '#888888',
          upWickColor:         finalUp,
          downWickColor:       finalDown,
          noChangeWickColor:   '#888888',
        },
      },
    });
  }, [applyStyles, themeDefaults]);

  const handleUpColorChange   = (c) => { setUpColor(c);   applyCandleColors(c, downColor); };
  const handleDownColorChange = (c) => { setDownColor(c); applyCandleColors(upColor, c);  };
  const handleResetUp   = ()  => { setUpColor(null);   applyCandleColors(null, downColor); };
  const handleResetDown = ()  => { setDownColor(null); applyCandleColors(upColor, null);   };
  const handleResetAll  = ()  => { resetColors();      applyCandleColors(null, null);       };

  const handleCandleTypeChange = (type) => {
    setCandleType(type);
    applyStyles({ candle: { type } });
  };

  const handleGridChange      = (v) => { setGridVisible(v);      applyStyles({ grid:      { show: v } }); };
  const handleCrosshairChange = (v) => { setCrosshairVisible(v); applyStyles({ crosshair: { show: v } }); };

  if (!isOpen) return null;

  const hasAnyCustom = !!upColor || !!downColor;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" aria-hidden onClick={onClose} />
      <div
        className={cn(
          'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
          'w-full max-w-sm bg-surface border border-border rounded-xl shadow-xl',
          'flex flex-col max-h-[90vh]'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-settings-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
          <h2 id="chart-settings-title" className="text-lg font-semibold text-textPrimary">
            {t('Chart settings')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-textSecondary hover:bg-surfaceHover hover:text-textPrimary transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-4 pb-2 space-y-5 flex-1">

          {/* ── Chart type ── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-textSecondary uppercase tracking-wider">{t('Chart type')}</h3>
            <p className="text-xs text-textSecondary">{t('Set chart type')}</p>
            <div className="relative">
              <select
                value={candleType}
                onChange={(e) => handleCandleTypeChange(e.target.value)}
                className={cn(
                  'w-full appearance-none bg-surfaceDark border border-border rounded-lg',
                  'px-3 py-2.5 pr-9 text-sm text-textPrimary',
                  'focus:outline-none focus:border-accent cursor-pointer'
                )}
              >
                {CANDLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(type)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-textSecondary" />
            </div>
          </section>

          {/* ── Display ── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-textSecondary uppercase tracking-wider">{t('Display')}</h3>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm text-textPrimary">{t('Show grid')}</span>
              <input
                type="checkbox"
                checked={gridVisible}
                onChange={(e) => handleGridChange(e.target.checked)}
                className="h-4 w-4 rounded border-border bg-surfaceHover text-accent focus:ring-accent"
              />
            </label>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm text-textPrimary">{t('Show crosshair')}</span>
              <input
                type="checkbox"
                checked={crosshairVisible}
                onChange={(e) => handleCrosshairChange(e.target.checked)}
                className="h-4 w-4 rounded border-border bg-surfaceHover text-accent focus:ring-accent"
              />
            </label>
          </section>

          {/* ── Candle colours ── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-textSecondary uppercase tracking-wider">
                {t('Candle colours')}
              </h3>
              {hasAnyCustom && (
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="flex items-center gap-1 text-xs text-textSecondary hover:text-accent transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('Reset all')}
                </button>
              )}
            </div>

            <ColorPicker
              label={t('Bull (up) candle')}
              color={upColor}
              themeDefault={themeDefaults.up}
              onChange={handleUpColorChange}
              onReset={handleResetUp}
              resetLabel={t('Reset')}
            />

            <ColorPicker
              label={t('Bear (down) candle')}
              color={downColor}
              themeDefault={themeDefaults.down}
              onChange={handleDownColorChange}
              onReset={handleResetDown}
              resetLabel={t('Reset')}
            />
          </section>

        </div>

        {/* Footer */}
        <div className="px-4 pb-4 pt-3 flex justify-end flex-shrink-0 border-t border-border">
          <Button type="button" variant="primary" onClick={onClose}>
            {t('Done')}
          </Button>
        </div>
      </div>
    </>
  );
};

export default ChartSettingsModal;
