import React from 'react';
import { useAuthStore } from '../../store/authStore';

const UserAccountChip = ({ className = '', ...buttonProps }) => {
  const user = useAuthStore((state) => state.user);
  const displayName = user?.username || user?.email?.split('@')?.[0] || 'Account';
  const displayInitial = String(displayName || 'U').charAt(0).toUpperCase();

  return (
    <button
      type="button"
      className={[
        'inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-sm font-semibold text-textPrimary transition-colors hover:bg-surfaceHover focus:outline-none focus:ring-2 focus:ring-accent/70',
        className,
      ].join(' ').trim()}
      {...buttonProps}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white text-sm font-semibold shrink-0">
        {displayInitial}
      </span>
      <span className="max-w-[170px] truncate leading-none">{displayName}</span>
    </button>
  );
};

export default UserAccountChip;
