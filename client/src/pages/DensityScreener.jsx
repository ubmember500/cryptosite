import React, { useEffect } from 'react';
import { useDensityScreenerStore } from '../store/densityScreenerStore';
import usePageTitle from '../hooks/usePageTitle';
import FilterPanel from '../components/density-screener/FilterPanel';
import DensityCardGrid from '../components/density-screener/DensityCardGrid';
import StatusBar from '../components/density-screener/StatusBar';

const DensityScreener = () => {
  usePageTitle('Density Screener');

  const { startPolling, stopPolling, fetchSymbols } = useDensityScreenerStore();

  useEffect(() => {
    // Fetch available symbols once on mount
    fetchSymbols();
    // Start auto-polling (7s interval)
    startPolling(7000);

    return () => {
      stopPolling();
    };
  }, [fetchSymbols, startPolling, stopPolling]);

  return (
    <div className="min-h-[100dvh] bg-background app-page md:px-4 md:py-4">
      <div className="mx-auto w-full max-w-[1800px]">
        {/* Header */}
        <div className="mb-3 px-4 md:px-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-textPrimary text-lg md:text-xl font-bold">
            Density Screener
          </h1>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 font-bold uppercase">Beta</span>
          <p className="text-textSecondary text-xs basis-full md:basis-auto">
            Order book walls across Binance, Bybit &amp; OKX
          </p>
        </div>

        {/* Main layout: sidebar + card grid */}
        <div className="flex flex-col md:flex-row gap-3 px-4 md:px-0">
          {/* Filter sidebar */}
          <div className="md:w-[240px] md:min-w-[240px] md:shrink-0">
            <FilterPanel />
          </div>

          {/* Card grid + status area */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <DensityCardGrid />
            <StatusBar />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DensityScreener;
