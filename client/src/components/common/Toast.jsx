import React from 'react';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../utils/cn';
import { X, Check, AlertCircle, Info } from 'lucide-react';

const Toast = () => {
  const { toasts, removeToast } = useToastStore();

  const getIcon = (type) => {
    switch (type) {
      case 'success': return <Check size={18} />;
      case 'error': return <AlertCircle size={18} />;
      case 'warning': return <AlertCircle size={18} />;
      default: return <Info size={18} />;
    }
  };

  const getTypeStyles = (type) => {
    switch (type) {
      case 'success': return 'bg-success/10 border-success/20 text-success shadow-success/5';
      case 'error': return 'bg-danger/10 border-danger/20 text-danger shadow-danger/5';
      case 'warning': return 'bg-warning/10 border-warning/20 text-warning shadow-warning/5';
      default: return 'bg-surface/90 border-border/50 text-textPrimary';
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "flex items-center w-full max-w-sm px-4 py-3 rounded-xl shadow-xl border backdrop-blur-xl animate-slideUp transition-all",
            getTypeStyles(toast.type)
          )}
          role="alert"
        >
          <div className="mr-3 shrink-0">{getIcon(toast.type)}</div>
          <div className="flex-1 text-sm font-medium">{toast.message}</div>
          <button
            onClick={() => removeToast(toast.id)}
            className="ml-4 -mr-1 p-1 rounded-lg bg-transparent hover:bg-black/10 focus:outline-none transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default Toast;
