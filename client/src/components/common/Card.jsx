import React from 'react';
import { cn } from '../../utils/cn';

const Card = ({ children, header, footer, className, ...rest }) => {
  return (
    <div 
      className={cn(
        "bg-surface/80 border border-border/50 rounded-xl shadow-lg shadow-black/5 overflow-hidden backdrop-blur-sm transition-all duration-200",
        className
      )}
      {...rest}
    >
      {header && (
        <div className="px-6 py-4 border-b border-border/50 bg-surfaceDark/20">
          {typeof header === 'string' ? (
            <h3 className="text-lg font-semibold text-textPrimary">{header}</h3>
          ) : (
            header
          )}
        </div>
      )}
      <div className="p-6">
        {children}
      </div>
      {footer && (
        <div className="px-6 py-4 bg-surfaceDark/30 border-t border-border/50">
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;
