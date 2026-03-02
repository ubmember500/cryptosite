import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// null means "use theme default — no override"
const INITIAL = {
  upColor: null,
  downColor: null,
  candleType: 'candle_solid', // klinecharts candle type
};

export const useCandleColorStore = create(
  persist(
    (set) => ({
      ...INITIAL,
      setUpColor: (color) => set({ upColor: color }),
      setDownColor: (color) => set({ downColor: color }),
      setCandleType: (type) => set({ candleType: type }),
      resetColors: () => set(INITIAL),
    }),
    {
      name: 'candle-colors',
      version: 2,
    }
  )
);
