import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn';
import { Magnet, ChevronDown, Keyboard } from 'lucide-react';

/**
 * Magnet mode: snaps overlay points to candle OHLC levels.
 * - normal: no snap
 * - weak_magnet: snap when within modeSensitivity pixels of high/low
 * - strong_magnet: always snap to nearest candle level
 */
export const MAGNET_MODES = {
  NORMAL: 'normal',
  WEAK: 'weak_magnet',
  STRONG: 'strong_magnet',
};

const MAGNET_OPTIONS = [
  { id: MAGNET_MODES.NORMAL, label: 'Off', description: 'No snap to candle levels', icon: Magnet },
  { id: MAGNET_MODES.WEAK, label: 'Weak magnet', description: 'Snap when near candle high/low', icon: Magnet },
  { id: MAGNET_MODES.STRONG, label: 'Strong magnet', description: 'Always snap to candle levels (Ctrl/Cmd)', icon: Magnet },
];

const MagnetToolButton = ({
  magnetMode = MAGNET_MODES.NORMAL,
  onMagnetModeChange,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const current = MAGNET_OPTIONS.find((o) => o.id === magnetMode) || MAGNET_OPTIONS[0];
  const isActive = magnetMode !== MAGNET_MODES.NORMAL;

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <div className="relative h-10 w-14">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          title={current.description}
          className={cn(
            'relative h-10 w-14 rounded-lg border transition-all duration-150',
            'border-transparent hover:bg-surfaceHover hover:border-border/70',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
            isActive ? 'bg-accent/15 text-accent border-accent/40 shadow-sm' : 'text-textSecondary hover:text-textPrimary'
          )}
        >
          <Magnet className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          title="Magnet options"
          className={cn(
            'absolute right-0 top-0 z-10 h-10 w-4 rounded-r-lg border-l border-border/50 transition-all duration-150',
            'border-transparent hover:bg-surfaceHover hover:border-border/70',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface',
            isActive ? 'bg-accent/15 text-accent border-accent/40' : 'text-textSecondary hover:text-textPrimary'
          )}
        >
          <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', isOpen && 'rotate-180')} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-full ml-2 top-0 z-50 w-52 bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-2">
            <div className="text-xs font-medium text-textSecondary uppercase tracking-wide px-2 py-1 mb-1">
              Magnet
            </div>
            {MAGNET_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = magnetMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onMagnetModeChange?.(opt.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors text-left',
                    'hover:bg-surfaceHover',
                    selected && 'bg-surfaceHover'
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-md',
                      selected ? 'bg-accent text-white' : 'bg-surface text-textSecondary'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-sm font-medium', selected ? 'text-accent' : 'text-textPrimary')}>
                      {opt.label}
                    </div>
                    <div className="text-xs text-textSecondary truncate">{opt.description}</div>
                  </div>
                  {opt.id === MAGNET_MODES.STRONG && (
                    <span className="flex items-center gap-1 text-[10px] text-textSecondary">
                      <Keyboard className="h-3 w-3" /> Ctrl/Cmd
                    </span>
                  )}
                  {selected && <div className="flex-shrink-0 w-2 h-2 rounded-full bg-accent" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MagnetToolButton;
