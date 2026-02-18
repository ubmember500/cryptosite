import React, { useState, useEffect } from 'react';
import { cn } from '../../utils/cn';
import { X } from 'lucide-react';
import Button from '../common/Button';

/**
 * Modal for chart display settings (grid, crosshair).
 * Applies changes via chartRef.setStyles().
 */
const ChartSettingsModal = ({ isOpen, onClose, chartRef }) => {
  const [gridVisible, setGridVisible] = useState(true);
  const [crosshairVisible, setCrosshairVisible] = useState(true);

  // Sync from chart when modal opens (if chart has getStyles or we keep local state as source of truth)
  useEffect(() => {
    if (!isOpen || !chartRef?.current) return;
    try {
      if (typeof chartRef.current.getStyles === 'function') {
        const styles = chartRef.current.getStyles();
        if (styles?.grid?.show !== undefined) setGridVisible(styles.grid.show);
        if (styles?.crosshair?.show !== undefined) setCrosshairVisible(styles.crosshair.show);
      }
    } catch (_) {
      // keep defaults
    }
  }, [isOpen, chartRef]);

  const applyStyles = (patch) => {
    if (!chartRef?.current || typeof chartRef.current.setStyles !== 'function') return;
    try {
      chartRef.current.setStyles(patch);
    } catch (e) {
      console.warn('[ChartSettingsModal] setStyles failed:', e);
    }
  };

  const handleGridChange = (value) => {
    setGridVisible(value);
    applyStyles({ grid: { show: value } });
  };

  const handleCrosshairChange = (value) => {
    setCrosshairVisible(value);
    applyStyles({ crosshair: { show: value } });
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        aria-hidden
        onClick={onClose}
      />
      <div
        className={cn(
          'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
          'w-full max-w-sm bg-surface border border-border rounded-xl shadow-xl',
          'p-4'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-settings-title"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="chart-settings-title" className="text-lg font-semibold text-textPrimary">
            Chart settings
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

        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm text-textPrimary">Show grid</span>
            <input
              type="checkbox"
              checked={gridVisible}
              onChange={(e) => handleGridChange(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-surfaceHover text-accent focus:ring-accent"
            />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm text-textPrimary">Show crosshair</span>
            <input
              type="checkbox"
              checked={crosshairVisible}
              onChange={(e) => handleCrosshairChange(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-surfaceHover text-accent focus:ring-accent"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="button" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </>
  );
};

export default ChartSettingsModal;
