import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

const ThemeCard = ({ theme, isActive, onSelect, styleLabel, categoryLabel }) => {
  return (
    <button
      type="button"
      onClick={() => onSelect(theme.id)}
      className={cn(
        'w-full rounded-xl border text-left transition-all focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background',
        isActive
          ? 'border-accent bg-surface shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-border bg-surface hover:bg-surfaceHover'
      )}
    >
      <div className="p-3">
        <div
          className="relative rounded-lg border p-3"
          style={{
            backgroundColor: theme.preview.background,
            borderColor: theme.preview.border,
          }}
        >
          <div className="mb-2 flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full opacity-60" style={{ backgroundColor: theme.preview.text }} />
            <span className="h-1.5 w-1.5 rounded-full opacity-40" style={{ backgroundColor: theme.preview.text }} />
            <span className="h-1.5 w-1.5 rounded-full opacity-25" style={{ backgroundColor: theme.preview.text }} />
          </div>

          <div
            className="rounded-md border p-2"
            style={{
              backgroundColor: theme.preview.surface,
              borderColor: theme.preview.border,
            }}
          >
            <div className="mb-1 h-1.5 w-10 rounded" style={{ backgroundColor: theme.preview.text }} />
            <div className="mb-2 h-1.5 w-6 rounded opacity-80" style={{ backgroundColor: theme.preview.text }} />
            <div className="flex gap-1.5">
              <span className="h-2.5 w-8 rounded" style={{ backgroundColor: theme.preview.accent }} />
              <span className="h-2.5 w-5 rounded" style={{ backgroundColor: theme.preview.success }} />
              <span className="h-2.5 w-5 rounded" style={{ backgroundColor: theme.preview.warning }} />
            </div>
          </div>

          <div className="mt-2 flex justify-center">
            <div
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold"
              style={{
                color: theme.preview.text,
                borderColor: theme.preview.border,
                backgroundColor: theme.preview.surface,
              }}
            >
              BridgeVoice
            </div>
          </div>

          {isActive && (
            <span className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
              <Check className="h-3.5 w-3.5" />
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-textPrimary">{theme.name}</h3>
          <span className="text-[10px] uppercase tracking-wide text-textSecondary">{categoryLabel}</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full border border-border bg-surfaceDark px-2 py-0.5 text-[10px] font-medium text-textSecondary">
            {styleLabel}
          </span>
        </div>

        <p className="mt-2 text-xs text-textSecondary">{theme.description}</p>
      </div>
    </button>
  );
};

export default ThemeCard;
