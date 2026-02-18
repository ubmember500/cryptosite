import React from 'react';
import CryptoChart from '../components/charts/CryptoChart';
import Card from '../components/common/Card';
import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';

const generateDummyChartData = (numEntries = 100) => {
  const data = [];
  let currentTime = Date.now();
  let open = 1000;

  for (let i = 0; i < numEntries; i++) {
    const close = open + (Math.random() - 0.5) * 50;
    const high = Math.max(open, close) + Math.random() * 20;
    const low = Math.min(open, close) - Math.random() * 20;
    const volume = Math.floor(Math.random() * 1000000);

    data.push({
      time: new Date(currentTime).toISOString(),
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume: volume,
    });

    open = close + (Math.random() - 0.5) * 10;
    currentTime -= 60 * 60 * 1000; // 1 hour intervals for dummy data
  }
  return data.reverse(); // Newest data last for charting
};

const Charts = () => {
  const { coinId } = useParams();
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    // In a real application, you would fetch data for coinId and timeframe
    // For this example, we'll use dummy data.
    setChartData(generateDummyChartData(200));
  }, [coinId]);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-textPrimary mb-6">Chart for {coinId || 'Bitcoin'}</h2>
      <Card className="h-[600px]">
        <CryptoChart data={chartData} className="h-full" />
      </Card>
    </div>
  );
};

export default Charts;
