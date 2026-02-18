const wallScannerService = require('../services/wallScannerService');
const { BinanceFastScanner } = require('../services/binanceFastScanner');

/**
 * GET /api/wall-scanner/symbols?exchange=binance&market=futures
 * Returns all available USDT symbols for the given exchange and market type.
 */
async function getTopSymbols(req, res, next) {
  try {
    const { exchange, market } = req.query;

    if (!exchange) {
      return res.status(400).json({ error: 'exchange query parameter is required' });
    }

    if (!wallScannerService.SUPPORTED_EXCHANGES.includes(exchange.toLowerCase())) {
      return res.status(400).json({
        error: `Unsupported exchange. Must be one of: ${wallScannerService.SUPPORTED_EXCHANGES.join(', ')}`,
      });
    }

    const marketType = market === 'spot' ? 'spot' : 'futures';
    const symbols = await wallScannerService.getTopSymbols(exchange, marketType);
    res.json({ symbols });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/wall-scanner/scan?configs=JSON&depth=10&radius=4
 * Scans order books for walls (large limit orders).
 * Always scans BOTH bids and asks.
 *
 * `configs` is a URL-encoded JSON array:
 *   [{ exchange, market, minVolume }]
 *
 * Falls back to legacy flat params if `configs` is absent:
 *   exchanges=binance,okx&minVolume=300000
 */
async function scan(req, res, next) {
  try {
    const { configs: configsRaw, depth, radius, exchanges, symbols, minVolume } = req.query;

    const depthPercent = depth != null && depth !== '' ? parseFloat(depth) : 10;
    const radiusNum = radius != null && radius !== '' ? parseInt(radius, 10) : 1;
    const sideParam = 'Both';

    const walls = [];

    if (configsRaw) {
      let cardConfigs;
      try {
        cardConfigs = JSON.parse(configsRaw);
      } catch {
        return res.status(400).json({ error: 'Invalid configs JSON' });
      }

      if (!Array.isArray(cardConfigs) || cardConfigs.length === 0) {
        return res.status(400).json({ error: 'configs must be a non-empty array' });
      }

      const scanTasks = cardConfigs.map(async (cfg) => {
        const exName = (cfg.exchange || '').toLowerCase();
        const marketType = cfg.market === 'spot' ? 'spot' : 'futures';
        const minVolumeUSD = Number.isFinite(Number(cfg.minVolume)) ? parseInt(cfg.minVolume, 10) : 300000;

        if (!wallScannerService.SUPPORTED_EXCHANGES.includes(exName)) {
          console.log(`[WallScanner] Skipping unsupported exchange: ${exName}`);
          return [];
        }

        // Use native fast scanner for Binance (10x faster)
        if (exName === 'binance') {
          console.log(`[WallScanner] Using FAST native scanner for Binance ${marketType}`);
          const startTime = Date.now();
          
          const scanner = new BinanceFastScanner(marketType);
          const cardWalls = await scanner.scanForWalls({
            minVolumeUSD: 0, // Scan ALL pairs regardless of volume
            minWallSize: minVolumeUSD,
            depth: depthPercent,
            radius: radiusNum,
          });

          const elapsed = Date.now() - startTime;
          console.log(`[WallScanner] Binance ${marketType} completed in ${elapsed}ms, found ${cardWalls.length} walls`);
          return cardWalls;
        }

        // Fall back to CCXT for other exchanges
        console.log(`[WallScanner] Fetching symbols for ${exName} ${marketType}...`);
        const symbolList = await wallScannerService.getTopSymbols(exName, marketType);
        console.log(`[WallScanner] Got ${symbolList.length} symbols for ${exName} ${marketType}`);

        if (!symbolList.length) {
          console.log(`[WallScanner] No symbols found for ${exName} ${marketType}`);
          return [];
        }

        console.log(`[WallScanner] Scanning ${exName} ${marketType} with minVolume=${minVolumeUSD}...`);
        const startTime = Date.now();

        const cardWalls = await wallScannerService.scanOrderBooks({
          exchanges: [exName],
          symbols: symbolList,
          depth: depthPercent,
          minVolumeUSD,
          side: sideParam,
          radius: radiusNum,
        });

        const elapsed = Date.now() - startTime;
        console.log(`[WallScanner] ${exName} ${marketType} completed in ${elapsed}ms, found ${cardWalls.length} walls`);

        return cardWalls;
      });

      const results = await Promise.all(scanTasks);
      walls.push(...results.flat());
    } else {
      if (!exchanges) {
        return res.status(400).json({ error: 'exchanges or configs query parameter is required' });
      }
      const exchangeList = exchanges.split(',').map((e) => e.trim()).filter(Boolean);
      const minVolumeUSD = minVolume ? parseInt(minVolume, 10) : 300000;

      const manualSymbolList = symbols
        ? symbols.split(',').map((s) => s.trim()).filter(Boolean)
        : null;

      for (const exchange of exchangeList) {
        const symbolList = manualSymbolList || await wallScannerService.getTopSymbols(exchange);
        if (!symbolList.length) continue;

        const exchangeWalls = await wallScannerService.scanOrderBooks({
          exchanges: [exchange],
          symbols: symbolList,
          depth: depthPercent,
          minVolumeUSD,
          side: sideParam,
          radius: radiusNum,
        });

        walls.push(...exchangeWalls);
      }
    }

    walls.sort((a, b) => b.volumeUSD - a.volumeUSD);

    console.log(`[WallScanner] Scan complete: ${walls.length} total walls`);
    res.json({ walls, timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/wall-scanner/density?exchange=binance&symbol=BTC/USDT&depth=50
 * Returns binned density map for one exchange+symbol.
 */
async function getDensityMap(req, res, next) {
  try {
    const { exchange, symbol, depth, minVolume } = req.query;

    if (!exchange) {
      return res.status(400).json({ error: 'exchange query parameter is required' });
    }
    if (!symbol) {
      return res.status(400).json({ error: 'symbol query parameter is required' });
    }

    if (!wallScannerService.SUPPORTED_EXCHANGES.includes(exchange.toLowerCase())) {
      return res.status(400).json({
        error: `Unsupported exchange. Must be one of: ${wallScannerService.SUPPORTED_EXCHANGES.join(', ')}`,
      });
    }

    const depthPercent = depth != null && depth !== '' ? parseFloat(depth, 10) : 10;
    const minVolumeUSD = minVolume != null && minVolume !== '' ? parseFloat(minVolume, 10) : 0;

    const density = await wallScannerService.getDensityMap({
      exchange,
      symbol,
      depth: depthPercent,
      minVolumeUSD,
    });

    res.json({ density });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTopSymbols,
  scan,
  getDensityMap,
};
