import React from 'react';
import { BarChart3 } from 'lucide-react';
import { cn } from '../../utils/cn';

const IndicatorsButton = ({
  activeIndicatorsCount = 0,
  onClick,
  isOpen = false,
  className,
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative h-10 w-14 rounded-lg border transition-all duration-150",
        "border-transparent hover:bg-surfaceHover hover:border-border/70",
        "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface",
        isOpen
          ? "bg-accent/15 text-accent border-accent/40 shadow-sm"
          : "text-textSecondary hover:text-textPrimary",
        className
      )}
      title="Technical Indicators"
    >
      <BarChart3 className="h-5 w-5" />
      {activeIndicatorsCount > 0 && (
        <span className="absolute right-1 top-1 h-4 w-4 flex items-center justify-center bg-accent text-white text-[10px] rounded-full border-2 border-surface">
          {activeIndicatorsCount}
        </span>
      )}
    </button>
  );
};

export default IndicatorsButton;
