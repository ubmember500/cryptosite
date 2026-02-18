import React, { useState, useEffect } from 'react';
import CoinSelector from '../charts/CoinSelector';
import Input from '../common/Input';
import Select from '../common/Select';
import Button from '../common/Button';
import { useMarketStore } from '../../store/marketStore';

const AlertForm = ({ onSubmit, initialData, onCancel }) => {
  const [formData, setFormData] = useState({
    coinId: initialData?.coinId || '',
    condition: initialData?.condition || 'above',
    targetValue: initialData?.targetValue || '',
    percentChange: initialData?.percentChange || '',
  });
  const [errors, setErrors] = useState({});
  const coins = useMarketStore((state) => state.coins);

  useEffect(() => {
    if (initialData) {
      setFormData({
        coinId: initialData.coinId || '',
        condition: initialData.condition || 'above',
        targetValue: initialData.targetValue || '',
        percentChange: initialData.percentChange || '',
      });
    }
  }, [initialData]);

  const validate = () => {
    const newErrors = {};

    if (!formData.coinId) {
      newErrors.coinId = 'Please select a coin';
    }

    if (formData.condition === 'pct_change') {
      if (!formData.percentChange || parseFloat(formData.percentChange) <= 0) {
        newErrors.percentChange = 'Please enter a valid percentage change (greater than 0)';
      }
    } else {
      if (!formData.targetValue || parseFloat(formData.targetValue) <= 0) {
        newErrors.targetValue = 'Please enter a valid target value (greater than 0)';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      const alertData = {
        coinId: formData.coinId,
        condition: formData.condition,
        ...(formData.condition === 'pct_change'
          ? { percentChange: parseFloat(formData.percentChange) }
          : { targetValue: parseFloat(formData.targetValue) }),
      };
      onSubmit(alertData);
    }
  };

  const selectedCoin = coins.find((c) => c.id === formData.coinId);
  const currentPrice = selectedCoin?.current_price;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Coin
        </label>
        <CoinSelector
          value={formData.coinId}
          onChange={(coinId) => {
            setFormData({ ...formData, coinId });
            setErrors({ ...errors, coinId: '' });
          }}
        />
        {errors.coinId && (
          <p className="mt-1 text-sm text-red-400">{errors.coinId}</p>
        )}
        {currentPrice && (
          <p className="mt-1 text-xs text-gray-400">
            Current price: ${currentPrice.toLocaleString()}
          </p>
        )}
      </div>

      <div>
        <Select
          label="Condition"
          value={formData.condition}
          onChange={(e) => {
            setFormData({ ...formData, condition: e.target.value });
            setErrors({ ...errors, condition: '', targetValue: '', percentChange: '' });
          }}
          options={[
            { value: 'above', label: 'Price goes above' },
            { value: 'below', label: 'Price goes below' },
            { value: 'pct_change', label: 'Percentage change' },
          ]}
          error={errors.condition}
        />
      </div>

      {formData.condition === 'pct_change' ? (
        <div>
          <Input
            label="Percentage Change (%)"
            type="number"
            step="0.01"
            min="0.01"
            value={formData.percentChange}
            onChange={(e) => {
              setFormData({ ...formData, percentChange: e.target.value });
              setErrors({ ...errors, percentChange: '' });
            }}
            placeholder="e.g., 5.0"
            error={errors.percentChange}
          />
        </div>
      ) : (
        <div>
          <Input
            label="Target Value (USD)"
            type="number"
            step="0.01"
            min="0.01"
            value={formData.targetValue}
            onChange={(e) => {
              setFormData({ ...formData, targetValue: e.target.value });
              setErrors({ ...errors, targetValue: '' });
            }}
            placeholder="e.g., 50000"
            error={errors.targetValue}
          />
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" variant="primary" className="flex-1">
          {initialData ? 'Update Alert' : 'Create Alert'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
};

export default AlertForm;
