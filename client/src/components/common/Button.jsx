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
  const baseStyles = 'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';
  
  const variants = {
    primary: 'bg-accent text-white hover:brightness-110 hover:shadow-accent-glow focus:ring-accent/50',
    success: 'bg-success text-white hover:brightness-110 focus:ring-success/50',
    danger: 'bg-danger text-white hover:brightness-110 focus:ring-danger/50',
    ghost: 'bg-transparent text-textPrimary hover:bg-surfaceHover/70 focus:ring-surfaceHover/50',
    outline: 'border border-border/60 text-textPrimary hover:bg-surfaceHover/50 hover:border-border focus:ring-surfaceHover/50',
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
