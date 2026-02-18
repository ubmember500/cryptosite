import { useMarketStore } from '../store/marketStore';

export const usePrices = () => {
  const prices = useMarketStore((state) => state.prices);
  const loading = useMarketStore((state) => state.loading);
  const error = useMarketStore((state) => state.error);
  
  // Could add helper methods here if needed, e.g. getPrice(coinId)
  const getPrice = (coinId) => prices[coinId];

  return { prices, loading, error, getPrice };
};
