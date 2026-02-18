import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { X, Plus, ChevronUp, ChevronDown, TrendingUp, LineChart, BarChart2 } from 'lucide-react';
import { cn } from '../../utils/cn';

const categorizedIndicators = [
  {
    category: 'Trend',
    icon: TrendingUp,
    indicators: [
      { value: 'MA', label: 'Moving Average' },
      { value: 'EMA', label: 'Exponential MA' },
      { value: 'SMA', label: 'Simple MA' },
      { value: 'BBI', label: 'Bull & Bear Index' },
    ],
  },
  {
    category: 'Oscillators',
    icon: LineChart,
    indicators: [
      { value: 'MACD', label: 'Moving Average Convergence Divergence (MACD)' },
      { value: 'RSI', label: 'Relative Strength Index (RSI)' },
      { value: 'KDJ', label: 'KDJ' },
      { value: 'BB', label: 'Bollinger Bands' },
      { value: 'CCI', label: 'Commodity Channel Index (CCI)' },
      { value: 'DMI', label: 'Directional Movement Index (DMI)' },
      { value: 'WR', label: 'Williams %R' },
    ],
  },
  {
    category: 'Volume',
    icon: BarChart2,
    indicators: [
      { value: 'Volume', label: 'Volume' },
      { value: 'MA_Volume', label: 'MA Volume' },
      { value: 'OBV', label: 'On Balance Volume' },
    ],
  },
];

const IndicatorsModal = ({
  isOpen,
  onClose,
  activeIndicators = [],
  onAddIndicator,
  onRemoveIndicator,
}) => {
  const [expandedCategories, setExpandedCategories] = useState({});

  useEffect(() => {
    if (isOpen) {
      // Expand all categories by default when modal opens
      const initialExpanded = {};
      categorizedIndicators.forEach(cat => {
        initialExpanded[cat.category] = true;
      });
      setExpandedCategories(initialExpanded);
    } else {
      setExpandedCategories({}); // Collapse all when modal closes
    }
  }, [isOpen]);

  const toggleCategory = (category) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleAddIndicator = (indicator) => {
    if (!activeIndicators.some(ind => ind.value === indicator.value)) {
      onAddIndicator(indicator);
    }
  };

  const handleRemoveIndicator = (indicatorValue) => {
    onRemoveIndicator(indicatorValue);
  };

  const activeIndicatorValues = activeIndicators.map(ind => ind.value);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Indicators"
      size="sm"
    >
      <div className="p-4">
        <div className="mb-4">
          <h4 className="text-textPrimary font-semibold mb-2">{activeIndicators.length} Active Indicators:</h4>
          {activeIndicators.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activeIndicators.map((indicator) => (
                <Badge key={indicator.value} variant="active">
                  {indicator.label}
                  <button 
                    onClick={() => handleRemoveIndicator(indicator.value)}
                    className="ml-1 p-0.5 rounded-full hover:bg-white/10 transition-colors"
                    aria-label={`Remove ${indicator.label}`}
                  >
                    <X size={12} />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-textSecondary text-sm">No indicators added.</p>
          )}
        </div>

        <div className="space-y-2">
          {categorizedIndicators.map((cat) => (
            <div key={cat.category} className="bg-surfaceHover rounded-lg">
              <button
                onClick={() => toggleCategory(cat.category)}
                className="flex items-center justify-between w-full p-3 text-textPrimary font-medium hover:bg-surfaceHover/50 transition-colors rounded-lg"
                aria-expanded={!!expandedCategories[cat.category]}
                aria-controls={`indicators-list-${cat.category}`}
              >
                <span className="flex items-center">
                  {cat.icon && <cat.icon size={18} className="mr-2" />}
                  {cat.category}
                </span>
                {expandedCategories[cat.category] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {expandedCategories[cat.category] && (
                <ul id={`indicators-list-${cat.category}`} className="border-t border-border mt-2 pt-2 px-3 pb-3 space-y-1">
                  {cat.indicators.map((indicator) => (
                    <li key={indicator.value} className="flex items-center justify-between text-textSecondary hover:text-textPrimary hover:bg-surfaceHover/30 px-2 py-1 rounded-md transition-colors">
                      <span>{indicator.label}</span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleAddIndicator(indicator)}
                        disabled={activeIndicatorValues.includes(indicator.value)}
                        className="ml-2"
                        title={`Add ${indicator.label}`}
                        aria-label={`Add ${indicator.label}`}
                      >
                        {activeIndicatorValues.includes(indicator.value) ? 'Added' : <Plus size={16} />}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default IndicatorsModal;
