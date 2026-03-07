import React from 'react';
import { cn } from '../../utils/cn';

const Badge = ({ variant = 'active', children, className }) => {
  const variants = {
    active: 'bg-blue-500/10 text-blue-400 border-blue-500/15',
    triggered: 'bg-purple-500/10 text-purple-400 border-purple-500/15',
    expired: 'bg-gray-500/10 text-gray-400 border-gray-500/15',
    success: 'bg-green-500/10 text-green-400 border-green-500/15',
    danger: 'bg-red-500/10 text-red-400 border-red-500/15',
    warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/15',
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border backdrop-blur-sm",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
};

export default Badge;
