import React from 'react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { LineChart } from 'lucide-react';
import { cn } from '../../utils/cn';

const IndicatorsButton = ({
  onClick,
  indicatorCount = 0,
  className
}) => {
  return (
    <Button 
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn("relative", className)}
      title="Manage Indicators"
      aria-label="Manage Chart Indicators"
    >
      <LineChart size={16} className="mr-2" />
      Indicators
      {indicatorCount > 0 && (
        <Badge variant="active" className="absolute -top-2 -right-2 min-w-[20px] text-center p-0.5 text-xs">
          {indicatorCount}
        </Badge>
      )}
    </Button>
  );
};

export default IndicatorsButton;
