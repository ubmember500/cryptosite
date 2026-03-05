import React, { useEffect } from 'react';
import { useDensityScreenerStore } from '../store/densityScreenerStore';
import usePageTitle from '../hooks/usePageTitle';
import FilterPanel from '../components/density-screener/FilterPanel';
import DensityTable from '../components/density-screener/DensityTable';
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
    <div className="min-h-[100dvh] bg-background app-page md:px-6 md:py-6">
      <div className="mx-auto w-full max-w-[1700px]">
        {/* Header */}
        <div className="mb-4 px-4 md:px-0">
          <h1 className="text-textPrimary text-xl md:text-2xl font-bold">
            Density Screener
          </h1>
          <p className="text-textSecondary text-sm mt-1">
            Find large order book walls across Binance, Bybit, and OKX.
            Customize filters to discover significant bid/ask density levels.
          </p>
        </div>

        {/* Main layout: sidebar + table */}
        <div className="flex flex-col md:flex-row gap-4 px-4 md:px-0">
          {/* Filter sidebar */}
          <div className="md:w-[260px] md:min-w-[260px] md:shrink-0">
            <FilterPanel />
          </div>

          {/* Table + status area */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <DensityTable />
            <StatusBar />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DensityScreener;
