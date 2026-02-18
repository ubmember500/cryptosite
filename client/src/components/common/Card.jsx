import React from 'react';
import { cn } from '../../utils/cn';

const Card = ({ children, header, footer, className, ...rest }) => {
  return (
    <div 
      className={cn(
        "bg-surface border border-border rounded-xl shadow-sm overflow-hidden",
        className
      )}
      {...rest}
    >
      {header && (
        <div className="px-6 py-4 border-b border-border">
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
        <div className="px-6 py-4 bg-surfaceHover/30 border-t border-border">
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;
