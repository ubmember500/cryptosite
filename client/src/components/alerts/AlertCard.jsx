import React from 'react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { Edit2, Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { useMarketStore } from '../../store/marketStore';
import { cn } from '../../utils/cn';

const AlertCard = ({ alert, onEdit, onDelete, onToggle }) => {
  const coins = useMarketStore((state) => state.coins);
  const prices = useMarketStore((state) => state.prices);
  
  const coin = coins.find((c) => c.id === alert.coinId);
  const currentPrice = prices[alert.coinId] || coin?.current_price || 0;

  const getStatusBadge = () => {
    // Check triggered field (from backend) or status field (legacy)
    if (alert.triggered || alert.status === 'triggered') {
      return <Badge variant="triggered">Triggered</Badge>;
    }
    switch (alert.status) {
      case 'active':
        return <Badge variant="active">Active</Badge>;
      case 'expired':
        return <Badge variant="expired">Expired</Badge>;
      default:
        // Default to active if isActive is true, otherwise inactive
        return <Badge variant={alert.isActive !== false ? 'active' : 'expired'}>Active</Badge>;
    }
  };

  const getConditionText = () => {
    if (alert.alertType === 'price' && alert.initialPrice != null && alert.targetValue != null) {
      const init = Number(alert.initialPrice);
      const tgt = Number(alert.targetValue);
      if (Number.isFinite(init) && Number.isFinite(tgt)) {
        if (alert.condition === 'below') {
          return `Monitoring for price to drop to $${tgt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
        } else if (alert.condition === 'above') {
          return `Monitoring for price to rise to $${tgt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
        }
      }
    }
    
    // Fallback to original logic for legacy alerts or when initialPrice is not available
    if (alert.condition === 'above') {
      return `Price goes above $${alert.targetValue?.toLocaleString()}`;
    } else if (alert.condition === 'below') {
      return `Price goes below $${alert.targetValue?.toLocaleString()}`;
    } else if (alert.condition === 'pct_change') {
      const sign = alert.percentChange > 0 ? '+' : '';
      return `${sign}${alert.percentChange}% change`;
    }
    return 'Unknown condition';
  };

  const getFromToText = () => {
    const init = alert.initialPrice != null ? Number(alert.initialPrice) : null;
    const tgt = alert.targetValue != null ? Number(alert.targetValue) : null;
    if (init == null || tgt == null || !Number.isFinite(init) || !Number.isFinite(tgt)) return null;
    const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    return `From ${fmt(init)} → ${fmt(tgt)}`;
  };

  const getConditionIcon = () => {
    if (alert.condition === 'above') {
      return <TrendingUp className="h-4 w-4 text-green-400" />;
    } else if (alert.condition === 'below') {
      return <TrendingDown className="h-4 w-4 text-red-400" />;
    }
    return null;
  };

  const isConditionMet = () => {
    if (!currentPrice) return false;
    if (alert.condition === 'above' && alert.targetValue) {
      return currentPrice >= alert.targetValue;
    } else if (alert.condition === 'below' && alert.targetValue) {
      return currentPrice <= alert.targetValue;
    }
    return false;
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-200">
              {alert.name || coin?.name || alert.coinId}
            </h3>
            <span className="text-sm text-gray-400">
              ({coin?.symbol?.toUpperCase() || alert.coinSymbol || 'N/A'})
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-300">
            {getConditionIcon()}
            <span>{getConditionText()}</span>
          </div>
          {getFromToText() && (
            <p className="text-xs text-gray-400 mt-0.5">{getFromToText()}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onToggle && (
            <button
              type="button"
              role="switch"
              aria-checked={alert.isActive !== false}
              onClick={() => onToggle(alert.id)}
              className={cn(
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800',
                alert.isActive !== false ? 'bg-blue-600' : 'bg-gray-600'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition',
                  alert.isActive !== false ? 'translate-x-5' : 'translate-x-1'
                )}
              />
            </button>
          )}
          {getStatusBadge()}
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-gray-700">
        <div className="text-sm">
          <span className="text-gray-400">Current: </span>
          <span className={cn(
            'font-medium',
            isConditionMet() && alert.status === 'active' 
              ? 'text-green-400' 
              : 'text-gray-300'
          )}>
            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex gap-2">
          {onEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(alert)}
              className="text-gray-400 hover:text-gray-200"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(alert.id)}
              className="text-gray-400 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertCard;
