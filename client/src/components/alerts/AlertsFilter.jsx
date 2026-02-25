import React from 'react';
import { cn } from '../../utils/cn';
import Button from '../common/Button';
import { DollarSign, CheckCircle, Zap, Filter } from 'lucide-react';

const filterOptions = {
  status: [
    { value: 'all', label: 'All', icon: Filter },
    { value: 'active', label: 'Active', icon: Zap },
    { value: 'triggered', label: 'Triggered', icon: CheckCircle },
  ],
  exchange: [
    { value: 'all', label: 'All', icon: Filter },
    { value: 'binance', label: 'Binance' },
    { value: 'bybit', label: 'Bybit' },
    { value: 'okx', label: 'OKX' },
    { value: 'gate', label: 'Gate.io' },
    { value: 'mexc', label: 'MEXC' },
    { value: 'bitget', label: 'Bitget' },
  ],
  market: [
    { value: 'all', label: 'All', icon: Filter },
    { value: 'futures', label: 'Futures', icon: DollarSign },
    { value: 'spot', label: 'Spot', icon: DollarSign },
  ],
  type: [
    { value: 'all', label: 'All', icon: Filter },
    { value: 'price', label: 'Price Alert' },
    { value: 'complex', label: 'Complex Alert' },
  ],
};

const AlertsFilter = ({
  filters,
  onFilterChange,
  className
}) => {
  return (
    <div className={cn("space-y-4", className)}>
      {Object.keys(filterOptions).map((category) => (
        <div key={category} className="flex items-center gap-2 flex-wrap">
          <span className="text-textSecondary text-sm font-medium capitalize w-20 flex-shrink-0">
            {category}:
          </span>
          <div className="flex flex-wrap gap-2">
            {filterOptions[category].map((option) => {
              const isActive = filters[category] === option.value;
              const Icon = option.icon;
              return (
                <Button
                  key={option.value}
                  variant={isActive ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => onFilterChange(category, option.value)}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full",
                    isActive ? 'bg-accent text-white' : 'bg-surface text-textSecondary hover:bg-surfaceHover/50 border-border'
                  )}
                >
                  {Icon && <Icon size={14} className="mr-1" />}
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AlertsFilter;
