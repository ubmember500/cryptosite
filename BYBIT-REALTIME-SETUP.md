# Bybit Real-time Chart Updates - Testing Guide

## 🎯 Objective
Get Bybit charts updating in real-time with the same smoothness as Binance.

## ✅ What Was Implemented

### Backend Changes
1. **KlineManager** - Central subscription manager
2. **BybitWsAdapter** - WebSocket handler for Bybit V5 API
3. **Socket.IO Integration** - Event handlers for subscribe/unsubscribe
4. **Comprehensive Logging** - Full trace from WebSocket → Frontend

### Frontend Changes
1. **useSocket Hook** - Added subscribeKline/unsubscribeKline methods
2. **Market Store** - Real-time subscription management
3. **Market Page** - Auto-subscribe when token selected
4. **RealtimeIndicator** - Visual connection status
5. **KLineChart** - Enhanced logging

## 🧪 Testing Bybit Step-by-Step

### Step 1: Test Raw Bybit WebSocket

```bash
cd server
node test-bybit-ws.js
```

**Expected output:**
```
✅ WebSocket connection opened
📤 Sending subscription: { op: 'subscribe', args: ['kline.1.BTCUSDT'] }
✅ Subscription successful
🏓 Ping sent
🏓 Pong received

📊 KLINE UPDATE RECEIVED:
Kline Data: {
  symbol: 'BTCUSDT',
  close: 45050.5,
  confirm: false
}
```

✅ **If you see kline updates**, Bybit WebSocket is working!  
❌ **If no updates**, check internet/firewall or wait 30 seconds

---

### Step 2: Start Application

**Terminal 1 - Backend:**
```bash
cd server
npm start
```

**Terminal 2 - Frontend:**
```bash
cd client
npm run dev
```

---

### Step 3: Open Application & Check Logs

1. Go to `http://localhost:5173/market`
2. **Open Browser Console (F12)**
3. Look for:
```
[Socket] ✅ Socket connected, ID: abc123
💡 Debug helpers available:
  - window.debugRealtimeStatus()
  - window.forceResubscribe()
```

4. Run debug command in console:
```javascript
window.debugRealtimeStatus()
```

Expected output shows socket connected and ready.

---

### Step 4: Select Bybit & Token

1. Click exchange dropdown → Select **Bybit**
2. Select **Futures**
3. Click on **BTCUSDT** token

**Watch Browser Console for this sequence:**
```
[MarketStore] 🔔 subscribeToKline called: { exchange: 'bybit', symbol: 'BTCUSDT', interval: '1m', ... }
[Socket] 📤 subscribeKline called, emitting subscribe-kline event
[Socket] ✅ subscribe-kline event emitted
```

**Watch Server Console for this sequence:**
```
[SocketIO] Subscribe kline: socketId -> bybit:BTCUSDT:1m:futures
[KlineManager] 📥 Subscribe request: socketId -> bybit:BTCUSDT:1m:futures
[KlineManager] 🚀 Creating adapter for bybit...
[BybitWs] Adapter initialized
[BybitWs] Subscribing: BTCUSDT:1m:futures
[BybitWs] 🔌 Connected: BTCUSDT:1m:futures
[BybitWs] 📤 Sending subscription: { op: 'subscribe', args: ['kline.1.BTCUSDT'] }
[BybitWs] ⏰ Ping timer started
[BybitWs] ✓ Subscription confirmed: BTCUSDT:1m:futures
```

Wait 10-30 seconds, then you should see:
```
[BybitWs] 📊 Kline message received
[BybitWs] 💹 Processing kline: { symbol: 'BTCUSDT', close: 45050, ... }
[BybitWs] 🚀 Emitting kline update
[KlineManager] 📡 Emitting update: bybit:BTCUSDT:1m:futures to 1 client(s)
```

**In Browser Console:**
```
[Socket] 📨 kline-update event received: { exchange: 'bybit', ... }
[MarketStore] 📨 Received kline update
[MarketStore] ✅ Update matches subscription
[MarketStore] 🔄 Updating existing candle at index 499
[KLineChart] Data updated, refreshing chart
```

---

## 🐛 Debugging Issues

### Issue: No subscription confirmation

**Check server logs for:**
```
[BybitWs] ✗ Subscription failed
```

**Solution**: Bybit API might have changed. Check `test-bybit-ws.js` output for actual response format.

---

### Issue: Subscription confirmed but no kline messages

**Reasons:**
1. **Low activity** - Try BTCUSDT (highest volume)
2. **Bybit sends updates only on price change** - Wait 30-60 seconds
3. **Wrong symbol format** - Verify symbol is "BTCUSDT" not "BTC-USDT"

**Debug:**
```bash
# Check if raw WebSocket gets updates
node test-bybit-ws.js
```

---

### Issue: Backend receives data but frontend doesn't

**Check browser console for:**
```
[Socket] 📨 kline-update event received
```

**If missing**, check:
1. Socket connection: `window.debugRealtimeStatus()`
2. Subscription match: Look for "❌ Update does not match subscription"

**Force resubscribe:**
```javascript
window.forceResubscribe()
```

---

### Issue: Frontend receives data but chart doesn't update

**Check browser console for:**
```
[KLineChart] Data updated, refreshing chart
```

**If missing**, the chart component might not be re-rendering. Check:
- React DevTools for `chartData` state changes
- Console errors

---

## 🔍 Debug Commands

### In Browser Console:

```javascript
// Check full status
window.debugRealtimeStatus()

// Force resubscribe
window.forceResubscribe()

// Check Socket.IO events
socket.onAny((event, ...args) => {
  console.log('Socket event:', event, args);
});
```

### Via API:

```bash
# Check active subscriptions
curl http://localhost:5000/api/market/debug/subscriptions
```

Response:
```json
{
  "totalClients": 1,
  "totalSubscriptions": 1,
  "activeExchanges": 1,
  "subscriptionsByExchange": {
    "bybit": 1
  },
  "detailedSubscriptions": [
    {
      "key": "bybit:BTCUSDT:1m:futures",
      "exchange": "bybit",
      "symbol": "BTCUSDT",
      "interval": "1m",
      "exchangeType": "futures",
      "clientCount": 1,
      "clientIds": ["socketId"]
    }
  ]
}
```

---

## 🎯 Success Criteria

Bybit is working correctly when you see:

✅ Server: "✓ Subscription confirmed"  
✅ Server: "📊 Kline message received" (every 10-60 seconds)  
✅ Server: "📡 Emitting update" (matches kline messages)  
✅ Browser: "📨 kline-update event received"  
✅ Browser: "🔄 Updating existing candle" or "➕ Appending new candle"  
✅ Chart: Green "Live" indicator visible  
✅ Chart: Price changes reflected in real-time  

---

## 📝 Notes

- **Update Frequency**: Bybit sends updates when prices change (typically every 1-10 seconds for active symbols)
- **Ping/Pong**: Required every 20 seconds to keep connection alive
- **Reconnection**: Automatic with exponential backoff (5s, 10s, 15s, ...)
- **Symbol Format**: Use standard format "BTCUSDT" not "BTC-USDT" or "BTC/USDT"

---

## 🚀 Next Steps

Once Bybit is confirmed working:
1. Apply same pattern to OKX, Gate, Bitget, MEXC
2. Reduce logging verbosity (keep only errors)
3. Add performance metrics
4. Test edge cases (network interruption, rapid token switching)
