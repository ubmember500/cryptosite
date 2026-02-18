import React from 'react';
import { cn } from '../../utils/cn';

const LoadingSpinner = ({ size = 'md', className }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
  };

  return (
    <div className={cn("flex justify-center items-center", className)}>
      <div
        className={cn(
          "animate-spin rounded-full border-2 border-surfaceHover border-t-accent",
          sizes[size]
        )}
      />
    </div>
  );
};

export default LoadingSpinner;
