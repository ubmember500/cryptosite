import React, { forwardRef } from 'react';
import { cn } from '../../utils/cn';
import { AlertCircle } from 'lucide-react';

const Input = forwardRef(({
  label,
  error,
  icon: Icon,
  className,
  ...props
}, ref) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-textSecondary mb-1.5">
          {label}
        </label>
      )}
      <div className="relative group">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary group-focus-within:text-accent pointer-events-none transition-colors duration-200">
            <Icon size={18} />
          </div>
        )}
        <input
          className={cn(
            "w-full bg-surface/80 border border-border/60 rounded-lg px-4 py-2.5 text-textPrimary placeholder-textSecondary/50 focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/50 transition-all duration-200",
            Icon && "pl-10",
            error && "border-danger/60 focus:ring-danger/25 focus:border-danger/50",
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
      {error && (
        <div className="flex items-center mt-1.5 text-danger text-sm">
          <AlertCircle size={14} className="mr-1 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
