const axios = require('axios');

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const CACHE_TTL = 30000; // 30 seconds in milliseconds

// In-memory cache
const cache = {
  topCoins: null,
  topCoinsTimestamp: null,
  coinPrices: {}, // { coinId: { data, timestamp } }
};

/**
 * Fetch top coins from CoinGecko
 * Uses cache with 30-second TTL
 */
async function fetchTopCoins() {
  const now = Date.now();

  // Check cache
  if (
    cache.topCoins &&
    cache.topCoinsTimestamp &&
    now - cache.topCoinsTimestamp < CACHE_TTL
  ) {
    return cache.topCoins;
  }

  try {
    const response = await axios.get(`${COINGECKO_BASE_URL}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 100,
        page: 1,
      },
    });

    const coins = response.data.map((coin) => ({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      image: coin.image,
      currentPrice: coin.current_price,
      marketCap: coin.market_cap,
      marketCapRank: coin.market_cap_rank,
      totalVolume: coin.total_volume,
      high24h: coin.high_24h,
      low24h: coin.low_24h,
      priceChange24h: coin.price_change_24h,
      priceChangePercentage24h: coin.price_change_percentage_24h,
      priceChangePercentage7d: coin.price_change_percentage_7d_in_currency,
    }));

    // Update cache
    cache.topCoins = coins;
    cache.topCoinsTimestamp = now;

    return coins;
  } catch (error) {
    console.error('Error fetching top coins:', error.message);
    throw new Error('Failed to fetch coins from CoinGecko');
  }
}

/**
 * Fetch single coin price from CoinGecko
 * Uses cache with 30-second TTL
 */
async function fetchCoinPrice(coinId) {
  const now = Date.now();
  const cached = cache.coinPrices[coinId];

  // Check cache
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await axios.get(`${COINGECKO_BASE_URL}/coins/${coinId}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false,
      },
    });

    const coin = response.data;
    const coinData = {
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      image: coin.image?.large || coin.image?.small,
      currentPrice: coin.market_data?.current_price?.usd || 0,
      marketCap: coin.market_data?.market_cap?.usd || 0,
      marketCapRank: coin.market_cap_rank,
      totalVolume: coin.market_data?.total_volume?.usd || 0,
      high24h: coin.market_data?.high_24h?.usd || 0,
      low24h: coin.market_data?.low_24h?.usd || 0,
      priceChange24h: coin.market_data?.price_change_24h || 0,
      priceChangePercentage24h: coin.market_data?.price_change_percentage_24h || 0,
      priceChangePercentage7d: coin.market_data?.price_change_percentage_7d_in_currency || 0,
      description: coin.description?.en || '',
    };

    // Update cache
    cache.coinPrices[coinId] = {
      data: coinData,
      timestamp: now,
    };

    return coinData;
  } catch (error) {
    console.error(`Error fetching coin ${coinId}:`, error.message);
    if (error.response?.status === 404) {
      throw new Error(`Coin ${coinId} not found`);
    }
    throw new Error(`Failed to fetch coin data for ${coinId}`);
  }
}

/**
 * Search coins on CoinGecko
 * No caching for search results
 */
async function searchCoins(query) {
  try {
    const response = await axios.get(`${COINGECKO_BASE_URL}/search`, {
      params: {
        query: query,
      },
    });

    return response.data.coins.map((coin) => ({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      marketCapRank: coin.market_cap_rank,
      thumb: coin.thumb,
      large: coin.large,
    }));
  } catch (error) {
    console.error('Error searching coins:', error.message);
    throw new Error('Failed to search coins');
  }
}

/**
 * Fetch prices for multiple coins
 * Used by alert engine to check multiple alerts efficiently
 */
async function fetchMultipleCoinPrices(coinIds) {
  try {
    // Remove duplicates
    const uniqueCoinIds = [...new Set(coinIds)];

    // Fetch prices for all coins (using Promise.all for parallel requests)
    const pricePromises = uniqueCoinIds.map((coinId) =>
      fetchCoinPrice(coinId).catch((err) => {
        console.error(`Failed to fetch price for ${coinId}:`, err.message);
        return null; // Return null for failed requests
      })
    );

    const results = await Promise.all(pricePromises);

    // Create a map of coinId -> price
    const priceMap = {};
    results.forEach((coinData, index) => {
      if (coinData) {
        priceMap[uniqueCoinIds[index]] = coinData.currentPrice;
      }
    });

    return priceMap;
  } catch (error) {
    console.error('Error fetching multiple coin prices:', error.message);
    throw error;
  }
}

module.exports = {
  fetchTopCoins,
  fetchCoinPrice,
  searchCoins,
  fetchMultipleCoinPrices,
};
