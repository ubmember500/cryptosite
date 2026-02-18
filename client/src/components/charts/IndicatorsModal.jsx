import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import {
  TrendingUp,
  Activity,
  BarChart3,
  X,
  Settings,
  Eye,
  EyeOff,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Button from '../common/Button';

// Indicator categories and their indicators
const INDICATOR_CATEGORIES = {
  Trend: {
    icon: TrendingUp,
    indicators: [
      { name: 'MA', label: 'Moving Average', defaultParams: [5, 10, 20], canStack: true },
      { name: 'EMA', label: 'Exponential MA', defaultParams: [12, 26], canStack: true },
      { name: 'SMA', label: 'Simple MA', defaultParams: [5, 10], canStack: true },
      { name: 'BBI', label: 'Bull & Bear Index', defaultParams: [3, 6, 12, 24], canStack: true },
    ],
  },
  Oscillators: {
    icon: Activity,
    indicators: [
      { name: 'MACD', label: 'MACD', defaultParams: [12, 26, 9], canStack: false },
      { name: 'RSI', label: 'RSI', defaultParams: [14], canStack: false },
      { name: 'KDJ', label: 'KDJ', defaultParams: [9, 3, 3], canStack: false },
      { name: 'BOLL', label: 'Bollinger Bands', defaultParams: [20, 2], canStack: true },
      { name: 'CCI', label: 'CCI', defaultParams: [14], canStack: false },
      { name: 'DMI', label: 'DMI', defaultParams: [14], canStack: false },
      { name: 'WR', label: 'Williams %R', defaultParams: [14], canStack: false },
    ],
  },
  Volume: {
    icon: BarChart3,
    indicators: [
      { name: 'VOL', label: 'Volume', defaultParams: [], canStack: false },
      { name: 'MAVOL', label: 'MA Volume', defaultParams: [5, 10], canStack: false },
      { name: 'OBV', label: 'On Balance Volume', defaultParams: [], canStack: false },
    ],
  },
};

const IndicatorsModal = ({
  isOpen,
  onClose,
  activeIndicators = [],
  onAddIndicator,
  onRemoveIndicator,
  onUpdateIndicator,
  onToggleVisibility,
}) => {
  const [expandedCategories, setExpandedCategories] = useState({
    Trend: true,
    Oscillators: true,
    Volume: true,
  });
  const [selectedIndicator, setSelectedIndicator] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [indicatorParams, setIndicatorParams] = useState({});

  const toggleCategory = (category) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleAddIndicator = (indicatorName, defaultParams, canStack) => {
    setSelectedIndicator({ name: indicatorName, defaultParams, canStack });
    setIndicatorParams(
      defaultParams.reduce((acc, param, index) => {
        acc[index] = param.toString();
        return acc;
      }, {})
    );
    setShowAddModal(true);
  };

  const handleConfirmAdd = () => {
    if (!selectedIndicator) return;

    const params = Object.values(indicatorParams)
      .map((val) => parseInt(val, 10))
      .filter((val) => !isNaN(val));

    onAddIndicator(selectedIndicator.name, {
      params,
      isStack: selectedIndicator.canStack,
      visible: true,
    });

    setShowAddModal(false);
    setSelectedIndicator(null);
    setIndicatorParams({});
  };

  const formatIndicatorLabel = (indicator) => {
    if (indicator.params && indicator.params.length > 0) {
      return `${indicator.name}(${indicator.params.join(', ')})`;
    }
    return indicator.name;
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-20 top-1/2 -translate-y-1/2 z-50 w-80 max-h-[600px] bg-surface border border-border rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-textPrimary">Indicators</h3>
            <p className="text-xs text-textSecondary mt-1">
              {activeIndicators.length} active
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-textSecondary hover:text-textPrimary transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Active Indicators List */}
          {activeIndicators.length > 0 && (
            <div className="p-4 border-b border-border">
              <h4 className="text-xs font-medium text-textSecondary mb-2 uppercase">
                Active Indicators
              </h4>
              <div className="space-y-2">
                {activeIndicators.map((indicator) => (
                  <div
                    key={indicator.id}
                    className="flex items-center justify-between p-2 bg-surfaceHover rounded-md group"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        onClick={() =>
                          onToggleVisibility(indicator.id, !indicator.visible)
                        }
                        className="text-textSecondary hover:text-textPrimary transition-colors"
                        title={indicator.visible ? 'Hide' : 'Show'}
                      >
                        {indicator.visible ? (
                          <Eye className="h-4 w-4" />
                        ) : (
                          <EyeOff className="h-4 w-4" />
                        )}
                      </button>
                      <span className="text-xs text-textPrimary truncate">
                        {formatIndicatorLabel(indicator)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onUpdateIndicator(indicator.id, {})}
                        className="p-1 text-textSecondary hover:text-textPrimary transition-colors"
                        title="Settings"
                      >
                        <Settings className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => onRemoveIndicator(indicator.id)}
                        className="p-1 text-textSecondary hover:text-danger transition-colors"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Indicator Categories */}
          <div className="p-2">
            {Object.entries(INDICATOR_CATEGORIES).map(([category, config]) => {
              const CategoryIcon = config.icon;
              const isExpanded = expandedCategories[category];

              return (
                <div key={category} className="mb-2">
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center justify-between p-2 rounded-md hover:bg-surfaceHover transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <CategoryIcon className="h-4 w-4 text-textSecondary" />
                      <span className="text-xs font-medium text-textPrimary">
                        {category}
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-textSecondary" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-textSecondary" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="mt-1 space-y-1">
                      {config.indicators.map((indicator) => (
                        <button
                          key={indicator.name}
                          onClick={() =>
                            handleAddIndicator(
                              indicator.name,
                              indicator.defaultParams,
                              indicator.canStack
                            )
                          }
                          className="w-full text-left px-4 py-1.5 text-xs text-textSecondary hover:text-textPrimary hover:bg-surfaceHover rounded-md transition-colors flex items-center gap-2"
                        >
                          <Plus className="h-3 w-3" />
                          <span>{indicator.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Add Indicator Parameters Modal */}
      {showAddModal && selectedIndicator && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-lg p-6 w-96 max-w-[90vw]">
            <h3 className="text-lg font-semibold text-textPrimary mb-4">
              Add {selectedIndicator.name}
            </h3>

            <div className="space-y-4">
              {selectedIndicator.defaultParams.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-textSecondary mb-2">
                    Parameters
                  </label>
                  <div className="space-y-2">
                    {selectedIndicator.defaultParams.map((param, index) => (
                      <div key={index}>
                        <label className="block text-xs text-textSecondary mb-1">
                          Parameter {index + 1}
                        </label>
                        <input
                          type="number"
                          value={indicatorParams[index] || param}
                          onChange={(e) =>
                            setIndicatorParams({
                              ...indicatorParams,
                              [index]: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-surfaceHover border border-border rounded-md text-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                          min="1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedIndicator.canStack && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isStack"
                    defaultChecked={true}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <label
                    htmlFor="isStack"
                    className="text-sm text-textSecondary"
                  >
                    Overlay on candlestick chart
                  </label>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="primary"
                  onClick={handleConfirmAdd}
                  className="flex-1"
                >
                  Add Indicator
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowAddModal(false);
                    setSelectedIndicator(null);
                    setIndicatorParams({});
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default IndicatorsModal;
