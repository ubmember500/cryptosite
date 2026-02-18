# 🚀 Quick Start - Test Bybit Real-time Charts

## Step 1: Test Raw WebSocket (30 seconds)

```bash
cd server
node test-bybit-ws.js
```

**Wait 30 seconds.** You should see:
```
✅ Subscription successful
📊 KLINE UPDATE RECEIVED:
```

If yes → Continue to Step 2  
If no → Check internet/firewall

---

## Step 2: Start Application (2 terminals)

**Terminal 1 - Backend:**
```bash
cd server
npm start
```

Wait for: `Server listening on port 5000`

**Terminal 2 - Frontend:**
```bash
cd client
npm run dev
```

Wait for: `Local: http://localhost:5173/`

---

## Step 3: Test in Browser

1. **Open** `http://localhost:5173/market`
2. **Open Console** (Press F12)
3. **Select Exchange:**
   - Click dropdown → **Bybit**
   - Select **Futures**
4. **Click Token:** **BTCUSDT**

---

## Step 4: Check Console Logs

**Browser Console should show:**
```
[Socket] ✅ Socket connected
[MarketStore] 🔔 subscribeToKline called: { exchange: 'bybit', ... }
[Socket] 📤 subscribeKline called
```

**Server Console should show:**
```
[BybitWs] 🔌 Connected
[BybitWs] ✓ Subscription confirmed
```

**Wait 30 seconds, then you should see:**

**Server:**
```
[BybitWs] 📊 Kline message received
[KlineManager] 📡 Emitting update
```

**Browser:**
```
[Socket] 📨 kline-update event received
[MarketStore] 🔄 Updating existing candle
```

---

## ✅ Success Checklist

- [ ] Raw WebSocket test receives kline updates
- [ ] Server shows "✓ Subscription confirmed"
- [ ] Server shows "📊 Kline message received" (wait 30s)
- [ ] Browser shows "📨 kline-update event received"
- [ ] Browser shows "🔄 Updating existing candle"
- [ ] Chart shows green "Live" indicator
- [ ] Chart price updates visually

---

## 🐛 If Something's Wrong

### Run debug command in browser console:
```javascript
window.debugRealtimeStatus()
```

### Check server subscriptions:
```bash
curl http://localhost:5000/api/market/debug/subscriptions
```

### Force resubscribe:
```javascript
window.forceResubscribe()
```

---

## 📚 More Info

- **Detailed testing guide:** `TESTING-REALTIME-CHARTS.md`
- **Bybit-specific guide:** `BYBIT-REALTIME-SETUP.md`
- **Changes summary:** `BYBIT-CHANGES-SUMMARY.md`

---

## 🎯 What to Report Back

1. **Does raw WebSocket test work?** (Step 1)
2. **Does server show subscription confirmed?**
3. **Does server receive kline messages?**
4. **Does browser receive kline-update events?**
5. **Does chart show "Live" indicator?**
6. **Does chart update visually?**

If everything works → Bybit is fixed! 🎉  
If not → Share which step failed and console logs
