import React, { forwardRef } from 'react';
import { cn } from '../../utils/cn';
import { ChevronDown, AlertCircle } from 'lucide-react';

const Select = forwardRef(({
  label,
  error,
  options,
  placeholder = 'Select an option',
  className,
  value,
  ...props
}, ref) => {
  return (
    <div className="w-full relative">
      {label && (
        <label className="block text-sm font-medium text-textSecondary mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          className={cn(
            "w-full bg-surface border border-border rounded-lg px-4 py-2 pr-10 text-textPrimary appearance-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all cursor-pointer",
            error && "border-danger focus:ring-danger",
            className
          )}
          ref={ref}
          value={value || ""}
          {...props}
        >
          <option value="" disabled hidden>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-textSecondary">
          <ChevronDown size={18} />
        </div>
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

Select.displayName = 'Select';

export default Select;
