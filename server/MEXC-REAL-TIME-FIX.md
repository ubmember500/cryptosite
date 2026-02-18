# MEXC Real-Time Chart Updates - Complete Fix

## What Was Fixed

### 1. **CRITICAL: Symbol Format Fixed** 🔥
   - ❌ Problem: Sending `BTCUSDT` → MEXC error: `"Contract [BTCUSDT] not exists"`
   - ✅ Solution: Convert to `BTC_USDT` for futures WebSocket subscriptions
   - The REST API was already doing this, but WebSocket wasn't
   - Code now converts: `BTCUSDT` → `BTC_USDT` before subscribing
   - Stores both formats: `BTC_USDT` (for MEXC) and `BTCUSDT` (for frontend callback)

### 2. **WebSocket URL Corrected**
   - ❌ Old: `wss://contract.mexc.com/ws` (301 redirect error)
   - ✅ New: `wss://contract.mexc.com/edge` (correct endpoint)

### 3. **Data Format Fixed**
   - The code expected: `message.data.kline`
   - MEXC actually sends: `message.data` (contains kline fields directly)
   - Updated `handleMessage()` to parse the correct structure

### 3. **Comprehensive Logging Added**
   - Connection events (open, close, error)
   - Subscription confirmations
   - Ping/pong messages
   - Parsed kline data with timestamp and close price

### 4. **Symbol Normalization**
   - Ensures symbols are uppercase (e.g., `btc_usdt` → `BTC_USDT`)
   - Applied to subscribe, unsubscribe, and all key operations

### 5. **Subscription Timeout (10 seconds)**
   - Detects if subscription is not confirmed within 10 seconds
   - Auto-triggers reconnection to recover

### 6. **Ping/Pong Enhanced**
   - Sends ping every 15 seconds (MEXC requires 15-20s interval)
   - Logs each ping sent and pong received
   - Prevents connection timeout

### 7. **Data Validation**
   - Checks for required fields: `symbol`, `interval`, `t`, `o`, `h`, `l`, `c`
   - Logs warnings for missing fields
   - Prevents processing invalid data

### 8. **Timer Cleanup**
   - Properly clears `pingTimer`, `subscriptionTimeout`, `reconnectTimer`
   - Prevents memory leaks on reconnection/unsubscribe

## Testing Steps

### Step 1: Open MEXC Chart
1. Go to http://localhost:3000/market
2. **Select MEXC exchange** from the dropdown
3. **Select a MEXC market** (e.g., BTC/USDT Futures or Spot)
4. **Select a time interval** (e.g., 15m)
5. Wait for chart to load

### Step 2: Check Server Logs
Open your server terminal and look for:

```
✅ EXPECTED LOGS:
[MexcWs] Subscribing: BTC_USDT:15m:futures (normalized from BTCUSDT)
[MexcWs] Connected: BTC_USDT:15m:futures
[MexcWs] Subscribing to futures: symbol=BTC_USDT, interval=Min15
[MexcWs] ✓ Subscription confirmed: BTC_USDT:15m:futures
[MexcWs] Parsed futures kline: BTCUSDT 15m @ 1770908400 C:67592.8
[MexcWs] Parsed futures kline: BTCUSDT 15m @ 1770908400 C:67605.1
[MexcWs] Parsed futures kline: BTCUSDT 15m @ 1770908400 C:67627.1
[MexcWs] Ping sent for BTC_USDT:15m:futures
[MexcWs] Pong received for BTC_USDT:15m:futures
[KlineManager] Emitting kline-update to 1 client(s): socketId123

❌ BAD SIGNS:
- "Contract [BTCUSDT] not exists" → Symbol format not converted (should be BTC_USDT)
- "⏱️ Subscription timeout" → No confirmation from MEXC
- "Missing required fields" → Data parsing issue
- No kline updates after subscription confirmed → Check logs for errors
```

### Step 3: Check Frontend Console
Open browser DevTools (F12) → Console tab:

```javascript
✅ EXPECTED LOGS:
[Socket] 📤 Emitting subscribe-kline: { exchange: 'mexc', symbol: 'BTC_USDT', interval: '15m', exchangeType: 'futures' }
[Socket] ✅ subscribe-kline event emitted
[Socket] 📊 kline-update event received: { exchange: 'mexc', symbol: 'BTC_USDT', interval: '15m', kline: {...} }
[MarketStore] 📨 handleKlineUpdate called: { exchange: 'mexc', symbol: 'BTC_USDT' }
[MarketStore] ✅ Update matches subscription, applying to chartData
[MarketStore] 🔄 Updating existing candle at index 119 { oldClose: 67592.8, newClose: 67605.1 }

❌ BAD SIGNS:
- No "kline-update event received" logs → Backend not sending data
- "❌ Update does not match active subscription" → Subscription mismatch
- No "Updating existing candle" or "Appending new candle" → Chart data not updating
```

### Step 4: Visual Verification
1. **Check "Live" indicator**: Should show "● Live" (green dot) at the top-right of the chart
2. **Watch the last candle**: Should update every few seconds (price changing)
3. **Check the timestamp**: Compare current time with the last candle's time (should be within the interval)
4. **Compare with other exchanges**: Open a Binance chart side-by-side → both should update similarly

### Step 5: Test Different Configurations
Test the following to ensure consistency:
- ✅ MEXC Futures BTC/USDT (15m)
- ✅ MEXC Spot BTC/USDT (15m)
- ✅ MEXC Futures ETH/USDT (5m)
- ✅ MEXC Spot ETH/USDT (1h)

## Troubleshooting

### Problem: "Contract [BTCUSDT] not exists" (FIXED)
**Cause**: Symbol format was wrong - MEXC futures requires underscore format
**Fix**: ✅ Already fixed in code - converts `BTCUSDT` → `BTC_USDT` automatically
**How it works**:
- Subscribe method: `BTCUSDT` → `BTC_USDT` for MEXC WebSocket
- Emit callback: Uses `BTCUSDT` (original format) for frontend consistency
- Historical API: Also uses `BTC_USDT` format

### Problem: "⏱️ Subscription timeout"
**Cause**: No confirmation received from MEXC within 10 seconds
**Fix**: 
- Check internet connection
- Verify MEXC WebSocket is not blocked by firewall
- System will auto-reconnect (no action needed)

### Problem: "Missing required fields in futures kline data"
**Cause**: MEXC sent unexpected data format
**Fix**: 
- Check server logs for the actual data structure
- Compare with test script output (`node test-mexc-ws.js`)
- May need to update `handleMessage()` logic

### Problem: Charts load but don't update
**Cause**: Subscription confirmed but data not flowing
**Fix**:
1. Check if ping/pong is working (look for "Ping sent" and "Pong received" logs)
2. Verify symbol format matches MEXC's expected format (uppercase with underscore)
3. Check if `klineManager` is emitting to the correct socket ID

### Problem: "Unexpected server response: 301"
**Cause**: Wrong WebSocket URL
**Fix**: Ensure `FUTURES_WS_URL = 'wss://contract.mexc.com/edge'` (not `/ws`)

## Debug Commands

### Test MEXC WebSocket directly
```bash
cd server
node test-mexc-ws.js
```
**Expected output**: Real-time kline updates every few seconds

### Check if server is running
```bash
curl http://localhost:5000/api/alerts/test
```
**Expected**: `{"message":"Alert system operational"}`

### Fetch MEXC historical data
```bash
# Futures
curl "http://localhost:5000/api/chart-data/mexc/BTC_USDT/15m?type=futures"

# Spot
curl "http://localhost:5000/api/chart-data/mexc/BTC_USDT/15m?type=spot"
```
**Expected**: JSON array of kline objects

## Comparison with Other Exchanges

| Exchange | WebSocket URL | Data Format | Ping Interval | Symbol Format |
|----------|--------------|-------------|---------------|---------------|
| Binance  | wss://fstream.binance.com/ws | `data.k.*` | 180s (auto) | BTCUSDT |
| Bybit    | wss://stream.bybit.com/v5/public/linear | `data[0].*` | 20s | BTCUSDT |
| OKX      | wss://ws.okx.com:8443/ws/v5/business | `data[0].*` | None | BTC-USDT-SWAP |
| Gate     | wss://fx-ws.gateio.ws/v4/ws/usdt | `result.*` or `result[0].*` | 15s | BTC_USDT |
| Bitget   | wss://ws.bitget.com/v2/ws/public | `data[0].*` | 30s | BTCUSDT |
| **MEXC** | **wss://contract.mexc.com/edge** | **`data.*`** | **15s** | **BTC_USDT** |

## Files Changed

1. **`server/src/services/exchanges/mexcWs.js`**
   - Updated `FUTURES_WS_URL` to `/edge` endpoint
   - Added symbol normalization
   - Fixed data parsing in `handleMessage()`
   - Added subscription timeout (10s)
   - Enhanced ping/pong with logging
   - Added comprehensive data validation
   - Added timer cleanup in all methods

2. **`server/test-mexc-ws.js`** (created)
   - Standalone test script to verify raw MEXC WebSocket

## Success Criteria

✅ **Server logs show**:
- "✓ Subscription confirmed"
- "Parsed futures kline" with changing close prices
- "Ping sent" and "Pong received" every 15 seconds
- "Emitting kline-update to X client(s)"

✅ **Frontend console shows**:
- "kline-update event received" with changing kline data
- "Updating existing candle" or "Appending new candle"
- No errors or warnings

✅ **Chart behavior**:
- "● Live" indicator shows green
- Last candle updates every few seconds
- Price changes reflect real-time market data
- Similar update frequency as Binance, Bybit, OKX, Gate, and Bitget

---

## Next Steps After Verification

Once you confirm MEXC is working:
1. ✅ Binance - Working
2. ✅ Bybit - Working
3. ✅ OKX - Working
4. ✅ Gate - Working
5. ✅ Bitget - Working
6. ✅ MEXC - **NOW FIXED** (awaiting your confirmation)

**All 6 exchanges should now have real-time chart updates!** 🎉
