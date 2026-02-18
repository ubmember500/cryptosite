# Fetching listing info with CCXT

CCXT is a crypto exchange library. Use it to load **markets** (trading pairs) from exchanges.

## Install

```bash
npm install ccxt
```

## Exchange IDs (this project)

| Exchange | CCXT id   |
|----------|-----------|
| Binance  | `binance` |
| Bybit    | `bybit`   |
| OKX      | `okx`     |
| MEXC     | `mexc`    |
| Bitget   | `bitget`  |
| Gate     | `gate`    |
| Upbit    | `upbit`   |

## Load markets (listings)

```js
const ccxt = require('ccxt');

// One exchange
const exchange = new ccxt.binance();
const markets = await exchange.loadMarkets();
// markets: { 'BTC/USDT': { id, symbol, base, quote, type, spot, swap, future, ... }, ... }
```

- **`loadMarkets()`** fetches and caches all markets. After that, `exchange.markets` and `exchange.symbols` are set.
- **Spot vs derivatives**: By default you get the exchange’s default type (e.g. Binance → spot, Bybit → swap). To force type, use `options.defaultType` when creating the exchange (e.g. `'spot'`, `'swap'`, `'future'`).

## Market object (each symbol)

Each value in `markets` is a market object, e.g.:

- **`symbol`** – unified symbol, e.g. `'BTC/USDT'`
- **`id`** – exchange-specific id, e.g. `'BTCUSDT'`
- **`base`** / **`quote`** – base and quote currency
- **`type`** – `'spot'`, `'swap'`, `'future'`, etc. (exchange-dependent)
- **`spot`** / **`swap`** / **`future`** – booleans for market type

## Multiple exchanges

Create one instance per exchange and call `loadMarkets()` on each:

```js
const ids = ['binance', 'bybit', 'okx', 'mexc', 'bitget', 'gate', 'upbit'];
for (const id of ids) {
  const exchange = new ccxt[id]({ enableRateLimit: true });
  const markets = await exchange.loadMarkets();
  // use exchange.id, markets/symbols
}
```

## Spot vs swap/futures

- **Spot**: usually `new ccxt.binance()` (Binance default is spot). For others, set `options: { defaultType: 'spot' }` if supported.
- **Futures/perp**: e.g. `options: { defaultType: 'swap' }` for Bybit/Binance USD-M style.

Not all exchanges support `defaultType`; check CCXT docs per exchange.
