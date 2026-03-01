import React, { useState } from 'react';

const WallScanner = () => {
  const [firstImageError, setFirstImageError] = useState(false);
  const [secondImageError, setSecondImageError] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-background app-page md:px-10 md:py-8">
      <div className="mx-auto w-full max-w-[1500px]">
        <h1 className="text-textPrimary text-2xl md:text-4xl lg:text-5xl font-bold leading-tight mb-8">
          Here you can find large densities and customize your own filters to find them on Binance Bybit Okx exchanges :{' '}
          <a
            href="https://stakan.live"
            className="text-blue-400 hover:text-blue-300 underline transition-colors"
          >
            stakan.live
          </a>
        </h1>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            {!firstImageError ? (
              <img
                src="/wall-scanner-1.png"
                alt="Wall scanner radar preview"
                className="w-full h-[min(62dvh,700px)] min-h-[280px] object-contain bg-background"
                onError={() => setFirstImageError(true)}
              />
            ) : (
              <div className="h-[min(62dvh,700px)] min-h-[280px] flex items-center justify-center bg-gradient-to-br from-surface to-background">
                <span className="text-textSecondary text-lg">wall-scanner-1.png not found</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            {!secondImageError ? (
              <img
                src="/wall-scanner-2.png"
                alt="Wall scanner settings preview"
                className="w-full h-[min(62dvh,700px)] min-h-[280px] object-contain bg-background"
                onError={() => setSecondImageError(true)}
              />
            ) : (
              <div className="h-[min(62dvh,700px)] min-h-[280px] flex items-center justify-center bg-gradient-to-br from-surface to-background">
                <span className="text-textSecondary text-lg">wall-scanner-2.png not found</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WallScanner;
