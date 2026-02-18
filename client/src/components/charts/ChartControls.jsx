import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
  BarChart3,
  Settings,
  TrendingUp,
  LineChart,
  Square,
  ChevronDown,
} from 'lucide-react';

const ChartControls = ({
  // Timeframe
  timeframe,
  timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
  onTimeframeChange,
  
  // Chart type
  chartType = 'candlestick',
  chartTypes = [
    { id: 'candlestick', label: 'Candlestick', icon: BarChart3 },
    { id: 'line', label: 'Line', icon: LineChart },
    { id: 'area', label: 'Area', icon: TrendingUp },
  ],
  onChartTypeChange,
  
  // Zoom controls
  onZoomIn,
  onZoomOut,
  onResetZoom,
  
  // Settings
  showGrid = true,
  showVolume = true,
  onToggleGrid,
  onToggleVolume,
  
  // Chart reference for zoom operations
  chartRef,
  
  className,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showIndicators, setShowIndicators] = useState(false);

  const handleResetZoom = () => {
    if (chartRef?.current && onResetZoom) {
      try {
        chartRef.current.timeScale().fitContent();
        if (onResetZoom) {
          onResetZoom();
        }
      } catch (error) {
        console.error('[ChartControls] Error resetting zoom:', error);
      }
    } else if (onResetZoom) {
      onResetZoom();
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Main Controls Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Timeframe Selector */}
        <div className="flex items-center gap-1 bg-surfaceHover rounded-lg p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange?.(tf)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
                timeframe === tf
                  ? 'bg-accent text-white'
                  : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
              )}
              title={`${tf} timeframe`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Chart Type Selector */}
        {onChartTypeChange && (
          <div className="flex items-center gap-1 bg-surfaceHover rounded-lg p-1">
            {chartTypes.map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => onChartTypeChange(type.id)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5',
                    'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
                    chartType === type.id
                      ? 'bg-accent text-white'
                      : 'text-textSecondary hover:bg-surface hover:text-textPrimary'
                  )}
                  title={type.label}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{type.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 bg-surfaceHover rounded-lg p-1">
          <button
            onClick={onZoomIn}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              'hover:bg-surface',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
              'text-textSecondary hover:text-textPrimary'
            )}
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={onZoomOut}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              'hover:bg-surface',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
              'text-textSecondary hover:text-textPrimary'
            )}
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={handleResetZoom}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              'hover:bg-surface',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
              'text-textSecondary hover:text-textPrimary'
            )}
            title="Reset zoom (fit all data)"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Quick Settings Toggles */}
        <div className="flex items-center gap-1 bg-surfaceHover rounded-lg p-1">
          <button
            onClick={onToggleGrid}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              'hover:bg-surface',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
              showGrid
                ? 'bg-surface text-accent'
                : 'text-textSecondary hover:text-textPrimary'
            )}
            title={showGrid ? 'Hide grid' : 'Show grid'}
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
          <button
            onClick={onToggleVolume}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              'hover:bg-surface',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
              showVolume
                ? 'bg-surface text-accent'
                : 'text-textSecondary hover:text-textPrimary'
            )}
            title={showVolume ? 'Hide volume' : 'Show volume'}
          >
            <BarChart3 className="h-4 w-4" />
          </button>
        </div>

        {/* Settings Button */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            'hover:bg-surfaceHover',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
            showSettings
              ? 'bg-surfaceHover text-accent'
              : 'text-textSecondary hover:text-textPrimary'
          )}
          title="Chart settings"
        >
          <Settings className="h-4 w-4" />
        </button>

        {/* Indicators Button (Future) */}
        <div className="relative">
          <button
            onClick={() => setShowIndicators(!showIndicators)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5',
              'hover:bg-surfaceHover',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
              showIndicators
                ? 'bg-surfaceHover text-accent'
                : 'bg-surfaceHover text-textSecondary hover:text-textPrimary'
            )}
            title="Technical indicators"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Indicators</span>
            <ChevronDown className={cn(
              'h-3.5 w-3.5 transition-transform',
              showIndicators && 'rotate-180'
            )} />
          </button>

          {/* Indicators Dropdown (Future - Placeholder) */}
          {showIndicators && (
            <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-50 min-w-[200px]">
              <div className="p-2">
                <p className="text-xs text-textSecondary mb-2 px-2">Technical Indicators</p>
                <div className="space-y-1">
                  <button className="w-full text-left px-2 py-1.5 text-sm text-textPrimary hover:bg-surfaceHover rounded-md transition-colors">
                    SMA (Simple Moving Average)
                  </button>
                  <button className="w-full text-left px-2 py-1.5 text-sm text-textPrimary hover:bg-surfaceHover rounded-md transition-colors">
                    EMA (Exponential Moving Average)
                  </button>
                  <button className="w-full text-left px-2 py-1.5 text-sm text-textPrimary hover:bg-surfaceHover rounded-md transition-colors">
                    RSI (Relative Strength Index)
                  </button>
                  <button className="w-full text-left px-2 py-1.5 text-sm text-textPrimary hover:bg-surfaceHover rounded-md transition-colors">
                    MACD
                  </button>
                  <button className="w-full text-left px-2 py-1.5 text-sm text-textPrimary hover:bg-surfaceHover rounded-md transition-colors">
                    Bollinger Bands
                  </button>
                </div>
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-xs text-textSecondary px-2 mb-1">Coming soon</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-textPrimary">Chart Settings</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="text-textSecondary hover:text-textPrimary transition-colors"
            >
              ×
            </button>
          </div>

          <div className="space-y-3">
            {/* Grid Lines Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-textPrimary">Grid Lines</label>
                <p className="text-xs text-textSecondary">Show/hide grid lines</p>
              </div>
              <button
                onClick={onToggleGrid}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  showGrid ? 'bg-accent' : 'bg-surfaceHover'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    showGrid ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>

            {/* Volume Chart Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-textPrimary">Volume Chart</label>
                <p className="text-xs text-textSecondary">Show/hide volume histogram</p>
              </div>
              <button
                onClick={onToggleVolume}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  showVolume ? 'bg-accent' : 'bg-surfaceHover'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    showVolume ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>

            {/* Color Scheme (Placeholder) */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-textPrimary">Color Scheme</label>
                <p className="text-xs text-textSecondary">Chart color theme</p>
              </div>
              <select
                className="bg-surfaceHover border border-border rounded-md px-3 py-1.5 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-accent"
                defaultValue="dark"
              >
                <option value="dark">Dark</option>
                <option value="light" disabled>Light (Coming soon)</option>
              </select>
            </div>

            {/* Chart Height Ratio (Placeholder) */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm text-textPrimary">Volume Height</label>
                <p className="text-xs text-textSecondary">Volume chart height ratio</p>
              </div>
              <input
                type="range"
                min="20"
                max="40"
                defaultValue="30"
                className="w-24 h-2 bg-surfaceHover rounded-lg appearance-none cursor-pointer accent-accent"
                title="Adjust volume chart height"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartControls;
