import React, { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

const MiniChart = ({ data = [], className = '' }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 60,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: { mode: 0 }, // Disable crosshair
    });

    chartRef.current = chart;

    // Create line series
    const lineSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: 8, // Show up to 8 decimals for detailed price view
        minMove: 0.00000001,
      },
    });

    seriesRef.current = lineSeries;

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      // Transform data to lightweight-charts format
      const chartData = data.map((item) => ({
        time: typeof item.time === 'number' ? item.time : new Date(item.time).getTime() / 1000,
        value: item.value,
      }));

      seriesRef.current.setData(chartData);
    }
  }, [data]);

  return (
    <div
      ref={chartContainerRef}
      className={`w-full ${className}`}
      style={{ height: '60px' }}
    />
  );
};

export default MiniChart;
