import React from 'react';
import { cn } from '../../utils/cn';
import LoadingSpinner from './LoadingSpinner';

const Button = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}) => {
  const baseStyles = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variants = {
    primary: 'bg-accent text-white hover:bg-blue-700 focus:ring-accent',
    success: 'bg-success text-white hover:bg-green-700 focus:ring-success',
    danger: 'bg-danger text-white hover:bg-red-700 focus:ring-danger',
    ghost: 'bg-transparent text-textPrimary hover:bg-surfaceHover focus:ring-surfaceHover',
    outline: 'border border-border text-textPrimary hover:bg-surfaceHover focus:ring-surfaceHover',
  };

  const sizes = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
  };

  return (
    <button
      type={type}
      className={cn(
        baseStyles,
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <LoadingSpinner size="sm" className="mr-2 text-current" />}
      {children}
    </button>
  );
};

export default Button;
