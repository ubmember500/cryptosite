import React from 'react';
import Button from '../common/Button';
import { LineChart, PenTool, TrendingUp, Eraser, Scissors } from 'lucide-react';
import { cn } from '../../utils/cn';

const ChartToolbar = ({
  onToggleMeasurementMode,
  isMeasurementMode,
  onClearDrawings,
  className
}) => {
  return (
    <div className={cn("flex flex-wrap gap-2 p-2 bg-surface rounded-lg shadow-lg", className)}>
      <Button 
        variant={isMeasurementMode ? "primary" : "ghost"}
        size="sm"
        onClick={onToggleMeasurementMode}
        title="Measure (Price/Time)"
        aria-label="Toggle Measurement Tool"
      >
        <Scissors size={16} />
      </Button>
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => alert('Drawing tool not implemented yet!')}
        title="Draw Line"
        aria-label="Draw Line Tool"
      >
        <PenTool size={16} />
      </Button>
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => alert('Drawing tool not implemented yet!')}
        title="Draw Trend Line"
        aria-label="Draw Trend Line Tool"
      >
        <TrendingUp size={16} />
      </Button>
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onClearDrawings}
        title="Clear All Drawings"
        aria-label="Clear All Drawings"
      >
        <Eraser size={16} />
      </Button>
    </div>
  );
};

export default ChartToolbar;
