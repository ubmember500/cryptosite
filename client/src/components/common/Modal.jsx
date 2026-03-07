import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import { X } from 'lucide-react';
import Button from './Button';

const Modal = ({ isOpen, onClose, title, children, size = 'md' }) => {
  const modalRef = useRef(null);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-background/70 backdrop-blur-md transition-opacity animate-fadeIn" 
        onClick={onClose}
      />

      {/* Modal Content */}
      <div
        ref={modalRef}
        className={cn(
          "relative w-full bg-surface/95 border border-border/50 rounded-2xl shadow-2xl shadow-black/20 transform transition-all animate-scaleIn max-h-[90vh] flex flex-col backdrop-blur-sm",
          sizes[size]
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <h3 id="modal-title" className="text-lg font-semibold text-textPrimary">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-textSecondary hover:text-textPrimary transition-all duration-200 p-1.5 rounded-lg hover:bg-surfaceHover/70 focus:outline-none focus:ring-1 focus:ring-accent/50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Modal;
