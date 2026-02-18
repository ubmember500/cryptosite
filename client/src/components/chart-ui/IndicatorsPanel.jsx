import React, { useState } from 'react';
import Select from '../common/Select';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { X, Plus } from 'lucide-react';
import { cn } from '../../utils/cn';

const availableIndicators = [
  { value: 'MA', label: 'Moving Average' },
  { value: 'RSI', label: 'Relative Strength Index (RSI)' },
  { value: 'MACD', label: 'Moving Average Convergence Divergence (MACD)' },
  { value: 'BB', label: 'Bollinger Bands' },
  { value: 'Volume', label: 'Volume' },
];

const IndicatorsPanel = ({
  activeIndicators = [],
  onAddIndicator,
  onRemoveIndicator,
  className
}) => {
  const [selectedIndicator, setSelectedIndicator] = useState('');

  const handleAddIndicator = () => {
    if (selectedIndicator && !activeIndicators.some(ind => ind.value === selectedIndicator)) {
      const indicatorToAdd = availableIndicators.find(ind => ind.value === selectedIndicator);
      if (indicatorToAdd) {
        onAddIndicator(indicatorToAdd);
        setSelectedIndicator(''); // Reset selection
      }
    }
  };

  return (
    <div className={cn("p-4 bg-surface rounded-lg shadow-lg", className)}>
      <h3 className="text-lg font-semibold text-textPrimary mb-4">Indicators</h3>
      
      <div className="flex gap-2 mb-4">
        <Select
          options={availableIndicators}
          value={selectedIndicator}
          onChange={(e) => setSelectedIndicator(e.target.value)}
          placeholder="Select indicator"
          className="flex-grow"
        />
        <Button onClick={handleAddIndicator} disabled={!selectedIndicator} size="md">
          <Plus size={16} className="mr-2" /> Add
        </Button>
      </div>

      {activeIndicators.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {activeIndicators.map((indicator) => (
            <Badge key={indicator.value} variant="active">
              {indicator.label}
              <button 
                onClick={() => onRemoveIndicator(indicator.value)}
                className="ml-1 p-0.5 rounded-full hover:bg-white/10 transition-colors"
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
  );
};

export default IndicatorsPanel;
