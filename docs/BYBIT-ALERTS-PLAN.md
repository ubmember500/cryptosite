# Bybit Alerts – Implementation Plan (same functionality as Binance)

Add Bybit (spot + futures) to the alerts flow with the same behavior as Binance: token list from chosen exchange/market, initial price at create, and engine evaluation from the correct exchange.

---

## 1. Server: bybitService – alert parity APIs

**File:** `server/src/services/bybitService.js`

Bybit already has:
- `fetchTokensWithNATR(exchangeType)` → used by `GET /api/market/bybit/tokens` (token list for Create Alert Step 3).
- `fetchTickers(exchangeType)` → builds list with `lastPrice`, `fullSymbol`.

**Add (same interface as binanceService):**

| Method | Purpose | Implementation |
|--------|---------|----------------|
| `normalizeSymbol(symbol)` | Uppercase, strip non‑alphanumeric (Bybit uses BTCUSDT like Binance). | Same logic as Binance: `symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')`. |
| `getLastPricesBySymbols(symbols, exchangeType)` | Return `Record<symbol, lastPrice>` for alert creation and engine. | Call existing `fetchTickers(exchangeType)` (or direct GET /v5/market/tickers?category=spot\|linear), build `fullMap[symbol] = parseFloat(t.lastPrice)`. Optional 2s TTL cache keyed by exchangeType. If `symbols.length === 0` return full map (for “all coins” complex alerts). |
| `fetchActiveSymbols(exchangeType)` | Set of active USDT symbol strings for “all coins” complex alerts. | From tickers: `new Set(list.map(t => t.symbol).filter(s => s.endsWith('USDT')))`. Optional 1h cache. |

**Exports:** Add these three to `module.exports`.

---

## 2. Server: alertController – createAlert branch by exchange

**File:** `server/src/controllers/alertController.js`

**Current:** Uses only `binanceService.normalizeSymbol` and `binanceService.getLastPricesBySymbols` for price alerts.

**Change:**
- Determine `exchange` from validated data: `const exchange = (validatedData.exchange || 'binance').toLowerCase()`.
- For **price alerts** (initial price + validation):
  - If `exchange === 'bybit'`: use `bybitService.normalizeSymbol(firstSymbolRaw)` and `bybitService.getLastPricesBySymbols([normalizedSymbol], market === 'spot' ? 'spot' : 'futures')`. Same validation: reject if no price, 503 on API error.
  - Else (binance or default): keep current Binance logic.
- `createData` already includes `exchange` from validated data; ensure it’s set from `validatedData.exchange ?? 'binance'` so Bybit alerts are stored with `exchange: 'bybit'`.

No change to updateAlert/toggle/delete/getAlerts; they already work with any `exchange` value in the DB.

---

## 3. Server: alertEngine – evaluate by exchange

**File:** `server/src/services/alertEngine.js`

Today all price/complex logic uses `binanceService` and a single `complexPriceHistory` keyed only by market (futures/spot). Alerts can now be `exchange: 'binance'` or `exchange: 'bybit'`, so we must:

- Use **per-exchange** price sources and (for complex) **per-exchange** price history.
- Group alerts by **(exchange, market)** and call the right service for each group.

**3.1 Price alerts**

- Group active price alerts by `(alert.exchange, alert.market)` (e.g. `binance|futures`, `bybit|spot`).
- For each group, call:
  - `binanceService.getLastPricesBySymbols(symbols, market)` when exchange is binance,
  - `bybitService.getLastPricesBySymbols(symbols, market)` when exchange is bybit.
- Build a map keyed by `exchange|market` (e.g. `priceMapByGroup['bybit|spot']`).
- When evaluating each alert, get `currentPrice` from `priceMapByGroup[alert.exchange + '|' + market][firstSymbol]`. If exchange is unknown, skip or log and skip.

**3.2 Complex alerts – price history**

- Change `complexPriceHistory` from `{ futures: Map(), spot: Map() }` to **per-exchange**:
  - e.g. `{ binance: { futures: Map(), spot: Map() }, bybit: { futures: Map(), spot: Map() } }` (same structure per exchange).
- `getHistoryMapForMarket(market)` → `getHistoryMapForExchangeMarket(exchange, market)` and return the correct nested map (create on first use).
- `appendComplexPricePoints(market, priceMap, ...)` → `appendComplexPricePoints(exchange, market, priceMap, ...)` and use the exchange-specific history.
- `getWindowStats(market, symbol, ...)` → `getWindowStats(exchange, market, symbol, ...)` and use the exchange-specific history.

**3.3 Complex alerts – symbol and price fetching**

- Collect symbols per **(exchange, market)** (e.g. `symbolsByExchangeMarket.get('bybit|futures')` = Set of symbols).
- “All coins” mode: for each (exchange, market) that needs it, call `binanceService.fetchActiveSymbols(market)` or `bybitService.fetchActiveSymbols(market)` as appropriate.
- Fetch prices per (exchange, market): call `binanceService.getLastPricesBySymbols(...)` or `bybitService.getLastPricesBySymbols(...)` and then `appendComplexPricePoints(exchange, market, priceMap, nowMs, maxLookbackSec)`.
- When evaluating each complex alert, use `getWindowStats(alert.exchange, alert.market, symbol, nowMs, timeframeSec)` and the rest of the logic unchanged (cooldown, trigger, socket, Telegram).

**3.4 Edge cases**

- Alerts with `exchange` null/undefined: treat as `'binance'` for backward compatibility.
- If a service throws (e.g. Bybit API down), catch per group and log; other exchanges continue.

---

## 4. Client: Create Alert modal – Bybit in dropdown + token list by selected exchange

**File:** `client/src/components/alerts/CreateAlertModal.jsx`

**4.1 Exchange dropdown**

- Add Bybit option:
  - `options={[ { value: 'binance', label: t('Binance') }, { value: 'bybit', label: t('Bybit') } ]}`.
- Keep `formData.exchanges` as array; value remains `formData.exchanges[0] || 'binance'`.

**4.2 Token list = selected exchange + selected market**

- Today: token fetch runs when `formData.market` changes and calls `fetchBinanceTokens(exchangeType, '')`, which uses **marketStore.exchange** (global), not the modal’s selected exchange.
- Change so the **modal’s** choice drives the token request:
  - When **exchange** (Step 2) or **market** (Step 2) changes, fetch tokens for **that** exchange and market.
  - Option A: Before calling fetch, set `marketStore.setExchange(formData.exchanges[0])` and then `fetchBinanceTokens(formData.market === 'spot' ? 'spot' : 'futures', '')`. So the store’s exchange is the modal’s selection when the modal is open. (Store already calls `/market/${exchange}/tokens`.)
  - Option B: Add a store method that accepts exchange explicitly, e.g. `fetchTokensForExchange(exchange, exchangeType, search)` and call it with `formData.exchanges[0]` and `formData.market === 'spot' ? 'spot' : 'futures'`. Prefer B if we don’t want the modal to change global Market page state.
- Recommended: **Option A** for minimal change — when Step 2 is shown or when user changes exchange/market, call `setExchange(formData.exchanges[0])` then `fetchBinanceTokens(exchangeType, '')`. When modal closes we could leave the store as-is (user’s last selection) or reset; optional.
- Ensure the effect runs when **both** `formData.exchanges[0]` and `formData.market` change (deps: `formData.exchanges[0]`, `formData.market`, fetchBinanceTokens). So when user selects Bybit then Futures, we fetch from `/api/market/bybit/tokens?exchangeType=futures`.

**4.3 Submit**

- Payload already sends `exchanges: formData.exchanges`; backend uses first element as `exchange`. No change.

**4.4 Editing**

- When editing an existing alert, `editingAlert.exchange` is used to set `formData.exchanges`; ensure the token list refetches for that exchange/market when loading the edit (already covered if we refetch on formData.exchange + formData.market).

---

## 5. Summary checklist

| # | Layer | Change |
|---|--------|--------|
| 1 | bybitService | Add and export `normalizeSymbol`, `getLastPricesBySymbols`, `fetchActiveSymbols` (same contract as Binance). |
| 2 | alertController.createAlert | Branch on `exchange`: use bybitService for initial price when `exchange === 'bybit'`; else Binance. |
| 3 | alertEngine | Price alerts: group by (exchange, market), fetch prices from binanceService or bybitService. Complex: per-exchange price history, symbol fetch, and getLastPricesBySymbols/fetchActiveSymbols per exchange. |
| 4 | CreateAlertModal | Add Bybit to Exchange dropdown. When exchange or market changes, set store exchange from modal and fetch tokens (so token list is for chosen exchange + market). |

After this, creating an alert with Exchange=Bybit and Market=Futures/Spot will:
- Show Bybit tokens in Step 3.
- Save with `exchange: 'bybit'`.
- Use Bybit for initial price at create and for all trigger checks in the engine (price and complex), with the same behavior as Binance (direction from initial vs target, complex window stats, cooldown, socket + Telegram).
