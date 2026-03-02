import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// null means "use theme default — no override"
const INITIAL = {
  upColor: null,
  downColor: null,
};

export const useCandleColorStore = create(
  persist(
    (set) => ({
      ...INITIAL,
      setUpColor: (color) => set({ upColor: color }),
      setDownColor: (color) => set({ downColor: color }),
      resetColors: () => set(INITIAL),
    }),
    {
      name: 'candle-colors',
      version: 1,
    }
  )
);
