# Bybit Real-time Charts - Testing Guide

## Status

✅ **Backend is running** on port 5000 (with all logging enabled)  
✅ **Frontend is running** on port 5173  
✅ **Raw WebSocket test** confirmed Bybit API works perfectly  
✅ **All code changes applied** (logging, validation, symbol normalization, interval fixes)

## What to Test Now

### Step 1: Open the Application

1. Go to: `http://localhost:5173/market`
2. **Open Browser Console** (Press F12)

### Step 2: Select Bybit

1. Click the **Exchange dropdown**
2. Select **Bybit**
3. Make sure **Futures** is selected
4. Click on **BTCUSDT** token

### Step 3: Watch the Logs

#### Expected Browser Console Logs:

```javascript
[Socket] ✅ Connected, socket ID: abc123xyz
[MarketStore] 🔔 subscribeToKline called: {
  exchange: "bybit",
  symbol: "BTCUSDT",
  interval: "15m",
  exchangeType: "futures"
}
[Socket] 📤 Emitting subscribe-kline: { ... }
[Socket] ✅ subscribe-kline event emitted
```

Wait 5-30 seconds, then you should see:

```javascript
[Socket] 📊 kline-update event received: {
  exchange: "bybit",
  symbol: "BTCUSDT",
  interval: "15m",
  close: 67990.5
}
[MarketStore] 📨 handleKlineUpdate called
[MarketStore] ✅ Update matches subscription
[MarketStore] 🔄 Updating existing candle at index 499
[KLineChart] Data updated, refreshing chart
```

#### Expected Server Console Logs:

Check terminal 1 (where `npm run dev` is running) or the backend server logs. You should see:

```
User username (userId) connected
[SocketIO] Subscribe kline: socketId -> bybit:BTCUSDT:15m:futures
[KlineManager] Subscribe: socketId -> bybit:BTCUSDT:15m:futures
[KlineManager] Created adapter for bybit
[BybitWs] Adapter initialized
[BybitWs] Subscribing: BTCUSDT:15m:futures (normalized from BTCUSDT)
[BybitWs] Connected: BTCUSDT:15m:futures
[BybitWs] Subscribing to: kline.15.BTCUSDT
[BybitWs] Ping timer started (interval: 20000ms)
[BybitWs] ✅ Subscription confirmed: BTCUSDT:15m:futures
```

Wait 10-60 seconds, then:

```
[BybitWs] Kline message received for BTCUSDT:15m:futures, topic: kline.15.BTCUSDT
[BybitWs] Processing kline: {
  symbol: 'BTCUSDT',
  receivedInterval: '15',
  expectedInterval: '15',
  targetInterval: '15m',
  close: 67990.5,
  isClosed: false
}
[BybitWs] Direct interval match, calling onKlineUpdate
[KlineManager] handleKlineUpdate called for bybit:BTCUSDT:15m:futures
[KlineManager] Emitting kline-update to 1 client(s)
[KlineManager] Emitted to client: socketId
```

Every 20 seconds you'll also see:

```
[BybitWs] Ping sent for BTCUSDT:15m:futures
[BybitWs] Pong received for BTCUSDT:15m:futures
```

### Step 4: Visual Verification

**Check the chart:**

1. **Green "Live" indicator** should appear next to the symbol name
2. **Price should update** every 10-60 seconds (watch the close price)
3. **Last candle timestamp** should match current time (within the 15m interval)
4. **Volume bars** should update

### Step 5: Try Different Intervals

Change the timeframe by clicking different interval buttons (1m, 5m, 15m, 30m, 1h).

**Each time you should see:**

Browser:
```javascript
[MarketStore] 🔔 subscribeToKline called: { interval: "1m" }
[Socket] 📤 Emitting subscribe-kline
```

Server:
```
[KlineManager] Subscribe: socketId -> bybit:BTCUSDT:1m:futures
[BybitWs] Subscribing: BTCUSDT:1m:futures
[BybitWs] Connected: BTCUSDT:1m:futures
[BybitWs] ✅ Subscription confirmed: BTCUSDT:1m:futures
```

## Troubleshooting

### Problem: No subscription confirmation in logs

**Check server logs for:**
```
[BybitWs] ❌ Subscription failed
[BybitWs] ⏱️ Subscription timeout
```

**Solution:** Symbol or interval format might be wrong.

---

### Problem: Subscription confirmed but no kline messages

**Wait at least 60 seconds.** Bybit sends updates when prices change.

**Try:** Switch to BTCUSDT (highest volume pair)

**Check server for:**
```
[BybitWs] Ping sent
[BybitWs] Pong received
```

If ping/pong works but no kline messages, the symbol might have low activity.

---

### Problem: Kline messages in server but not in browser

**Check browser console for:**
```
[Socket] 📊 kline-update event received
```

**If missing:**
- Socket.IO connection might be broken
- Run `window.debugRealtimeStatus()` in browser console
- Check for subscription mismatch

---

### Problem: Updates received but chart doesn't refresh

**Check browser for:**
```
[KLineChart] Data updated, refreshing chart
```

**If missing:** Chart component not re-rendering. Check React DevTools.

---

### Problem: Interval mismatch warning

```
[BybitWs] ⚠️ Interval mismatch: received 15, expected 1 for target 15m
```

This indicates the interval mapping is wrong. The code should handle this, but log shows the mismatch for debugging.

---

## Debug Commands

### In Browser Console:

```javascript
// Check real-time status
window.debugRealtimeStatus()

// Force resubscribe
window.forceResubscribe()

// Check active subscription
useMarketStore.getState().activeSubscription

// Check chart data
useMarketStore.getState().chartData
```

### Via API:

```bash
# Check active subscriptions
curl http://localhost:5000/api/market/debug/subscriptions
```

---

## Success Indicators

✅ **Bybit is working when you see:**

1. Browser console: "[Socket] ✅ Connected"
2. Browser console: "[MarketStore] ✅ Subscription state updated"
3. Server logs: "[BybitWs] ✅ Subscription confirmed"
4. Server logs: "[BybitWs] Kline message received" (every 10-60s)
5. Server logs: "[KlineManager] Emitting kline-update"
6. Browser console: "[Socket] 📊 kline-update event received"
7. Browser console: "[MarketStore] 🔄 Updating existing candle"
8. Chart: Green "Live" indicator visible
9. Chart: Price updates visually

---

## What I Changed

### Backend:
- ✅ Added comprehensive logging to `bybitWs.js`
- ✅ Added symbol normalization (uppercase)
- ✅ Added subscription timeout (10s)
- ✅ Added data validation
- ✅ Added interval comparison with proper mapping
- ✅ Enhanced ping/pong logging
- ✅ Added logging to `klineManager.js`

### Frontend:
- ✅ Added comprehensive logging to `useSocket.js`
- ✅ Added comprehensive logging to `marketStore.js`
- ✅ Enhanced subscription tracking
- ✅ Enhanced update tracking

### Testing:
- ✅ Verified raw WebSocket connection works (data flowing)
- ✅ Started backend server (KlineManager initialized)
- ⏳ **Ready for browser testing**

---

## Next Steps

1. **Open browser** at `http://localhost:5173/market`
2. **Select Bybit → BTCUSDT**
3. **Watch console logs** (both browser and server terminal)
4. **Verify chart shows "Live" and updates**
5. **Report back** what you see!

If everything works: Bybit is fixed! 🎉  
If not: Share the logs from both browser and server.
