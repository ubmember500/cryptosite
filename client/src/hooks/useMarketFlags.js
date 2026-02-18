import { useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '../store/authStore';

const STORAGE_PREFIX = 'market_token_flags';

function getStorageKey(userId) {
  return userId ? `${STORAGE_PREFIX}_${userId}` : STORAGE_PREFIX;
}

function readFlagsFromStorage(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeFlagsToStorage(storageKey, flags) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(flags));
  } catch (e) {
    console.warn('[useMarketFlags] Failed to write localStorage', e);
  }
}

export function flagKey(exchange, exchangeType, fullSymbol) {
  return `${exchange}:${exchangeType}:${fullSymbol}`;
}

/**
 * Per-user (or per-browser when not logged in) flags for market tokens.
 * Each flag has a color (hex). Stored in localStorage.
 * @returns {{
 *   getFlag: (exchange: string, exchangeType: string, fullSymbol: string) => string | null,
 *   setFlag: (exchange: string, exchangeType: string, fullSymbol: string, color: string) => void,
 *   removeFlag: (exchange: string, exchangeType: string, fullSymbol: string) => void,
 *   flags: Record<string, string>,
 *   isFlagged: (exchange: string, exchangeType: string, fullSymbol: string) => boolean,
 * }}
 */
export function useMarketFlags() {
  const userId = useAuthStore((state) => state.user?.id);
  const storageKey = useMemo(() => getStorageKey(userId), [userId]);

  const [flags, setFlags] = useState(() => readFlagsFromStorage(storageKey));

  const getFlag = useCallback(
    (exchange, exchangeType, fullSymbol) => {
      const key = flagKey(exchange, exchangeType, fullSymbol);
      return flags[key] ?? null;
    },
    [flags]
  );

  const isFlagged = useCallback(
    (exchange, exchangeType, fullSymbol) => {
      return !!getFlag(exchange, exchangeType, fullSymbol);
    },
    [getFlag]
  );

  const setFlag = useCallback(
    (exchange, exchangeType, fullSymbol, color) => {
      const key = flagKey(exchange, exchangeType, fullSymbol);
      const next = { ...flags, [key]: color };
      setFlags(next);
      writeFlagsToStorage(storageKey, next);
    },
    [flags, storageKey]
  );

  const removeFlag = useCallback(
    (exchange, exchangeType, fullSymbol) => {
      const key = flagKey(exchange, exchangeType, fullSymbol);
      const { [key]: _, ...rest } = flags;
      setFlags(rest);
      writeFlagsToStorage(storageKey, rest);
    },
    [flags, storageKey]
  );

  return { getFlag, setFlag, removeFlag, flags, isFlagged };
}

/** Predefined flag colors (hex) */
export const FLAG_COLORS = [
  { id: 'green', hex: '#4ade80', label: 'Green' },
  { id: 'coral', hex: '#f87171', label: 'Coral' },
  { id: 'blue', hex: '#38bdf8', label: 'Blue' },
  { id: 'orange', hex: '#fb923c', label: 'Orange' },
  { id: 'magenta', hex: '#f472b6', label: 'Magenta' },
];
