# Testing Real-time Chart Updates

## Quick Test for Bybit

### 1. Test Bybit WebSocket Directly (Standalone)

Open terminal in `server` folder and run:

```bash
node test-bybit-ws.js
```

**What you should see:**
```
✅ WebSocket connection opened
📤 Sending subscription: {...}
✅ Subscription successful
🏓 Ping sent
🏓 Pong received

📊 KLINE UPDATE RECEIVED:
Topic: kline.1.BTCUSDT
Kline Data: {
  symbol: 'BTCUSDT',
  close: 45050.5,
  volume: 1234,
  confirm: false
}
```

**If this works**, the Bybit WebSocket API is accessible and working. Move to step 2.

**If this fails**, check:
- Internet connection
- Firewall settings
- Bybit API status

---

### 2. Test Full Application

#### Start Backend:
```bash
cd server
npm start
```

#### Start Frontend:
```bash
cd client
npm run dev
```

#### Open Application:
1. Go to `http://localhost:5173/market`
2. **Open Browser Console (F12)**
3. Select **Bybit** from exchange dropdown
4. Select **Futures**
5. Click on **BTCUSDT** token

---

### 3. What to Look For in Logs

#### Browser Console (Frontend):
```
[Socket] ✅ Socket connected, ID: abc123
[MarketStore] 🔔 subscribeToKline called: { exchange: 'bybit', symbol: 'BTCUSDT', ... }
[Socket] 📤 subscribeKline called, emitting subscribe-kline event
[Socket] ✅ subscribe-kline event emitted
[Socket] 📨 kline-update event received: { exchange: 'bybit', ... }
[MarketStore] 📨 Received kline update
[MarketStore] ✅ Update matches subscription, applying to chartData
[MarketStore] 🔄 Updating existing candle at index 499
[KLineChart] Data updated, refreshing chart: { candleCount: 500, ... }
```

#### Server Console (Backend):
```
[SocketIO] Subscribe kline: socketId -> bybit:BTCUSDT:1m:futures
[KlineManager] 📥 Subscribe request: socketId -> bybit:BTCUSDT:1m:futures
[KlineManager] 🚀 Creating adapter for bybit...
[BybitWs] Adapter initialized
[KlineManager] 🔗 Calling adapter.subscribe(BTCUSDT, 1m, futures)
[BybitWs] Subscribing: BTCUSDT:1m:futures
[BybitWs] 🔌 Connected: BTCUSDT:1m:futures
[BybitWs] 📤 Sending subscription: { op: 'subscribe', args: ['kline.1.BTCUSDT'] }
[BybitWs] ⏰ Ping timer started
[BybitWs] ✓ Subscription confirmed: BTCUSDT:1m:futures
[BybitWs] 📊 Kline message received
[BybitWs] 💹 Processing kline: { symbol: 'BTCUSDT', close: 45050, ... }
[BybitWs] 🚀 Emitting kline update
[KlineManager] 📡 Emitting update: bybit:BTCUSDT:1m:futures to 1 client(s)
[KlineManager] ✉️ Sent to client: socketId
```

---

## Troubleshooting Bybit

### Issue: No subscription confirmation

**Problem**: You see connection but no "✓ Subscription confirmed"

**Possible causes:**
1. Symbol format wrong (should be BTCUSDT, not BTC-USDT)
2. Interval format wrong (should be '1', not '1m')
3. Bybit API changed

**Fix**: Check the raw WebSocket test output from step 1

---

### Issue: Subscription confirmed but no updates

**Problem**: Subscription succeeds but no kline messages

**Possible causes:**
1. Bybit sends updates only when price changes
2. Selected symbol has low activity
3. Message format changed

**Solution**: 
- Try a high-volume symbol like BTCUSDT
- Wait 10-30 seconds for updates
- Check raw WebSocket test for actual message structure

---

### Issue: Updates received on backend but not frontend

**Problem**: Server logs show kline updates, but browser doesn't

**Check:**
1. Socket.IO connection status in browser console
2. Look for `[Socket] 📨 kline-update event received`
3. Verify `activeSubscription` matches incoming update

**Common issue**: Exchange/symbol mismatch between subscription and update

---

## Log Symbol Guide

| Symbol | Meaning |
|--------|---------|
| 🔌 | WebSocket connected |
| 📤 | Sending message |
| 📥 | Receiving message |
| ✅ | Success |
| ❌ | Error |
| ⚠️ | Warning |
| 📊 | Kline data |
| 💹 | Processing |
| 🚀 | Emitting |
| 📡 | Broadcasting |
| ✉️ | Delivered |
| 🔄 | Updating |
| ➕ | Appending |
| 🏓 | Ping/Pong |

---

## Quick Debug Checklist for Bybit

- [ ] Raw WebSocket test works (step 1)
- [ ] Backend server running on port 5000
- [ ] Frontend running on port 5173
- [ ] Browser console shows socket connected
- [ ] Bybit selected in exchange dropdown
- [ ] Token clicked (e.g., BTCUSDT)
- [ ] Server logs show: "Subscribing: BTCUSDT:1m:futures"
- [ ] Server logs show: "✓ Subscription confirmed"
- [ ] Server logs show: "📊 Kline message received"
- [ ] Browser logs show: "📨 kline-update event received"
- [ ] Browser logs show: "🔄 Updating existing candle"
- [ ] Chart shows green "Live" indicator
- [ ] Chart updates visually (watch the price)

---

## Next Steps After Bybit Works

Once Bybit is confirmed working with the same smoothness as Binance, we can:
1. Apply the same pattern to OKX, Gate, Bitget, MEXC
2. Remove verbose logging (keep only errors)
3. Add performance monitoring
4. Test with multiple users simultaneously
