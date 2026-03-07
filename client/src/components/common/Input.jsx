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
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary pointer-events-none">
            <Icon size={18} />
          </div>
        )}
        <input
          className={cn(
            "w-full bg-surface border border-border rounded-lg px-4 py-2 text-textPrimary placeholder-textSecondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all",
            Icon && "pl-10",
            error && "border-danger focus:ring-danger",
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
      {error && (
        <div className="flex items-center mt-1 text-danger text-sm">
          <AlertCircle size={14} className="mr-1" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
