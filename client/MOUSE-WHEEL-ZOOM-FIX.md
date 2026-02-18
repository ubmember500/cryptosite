# Mouse Wheel Zoom on Y-Axis Panel - Fix Applied

## ✅ Summary

Enabled mouse wheel zoom **on the Y-axis price scale panel** (right side bar with price labels) for charts using klinecharts library.

## 🎯 Changes Made

### 1. KLineChart.jsx (Main Market Page)
**File**: `client/src/components/charts/KLineChart.jsx`

**Configuration**: Added `scrollZoomEnabled: true` in the layout options during chart initialization:

```javascript
layout: [
  {
    type: 'candle',
    options: {
      axis: {
        scrollZoomEnabled: true, // Enable mouse wheel zoom on Y-axis panel
      },
    },
  },
  {
    type: 'xAxis',
  },
],
```

**What This Does**:
- Enables mouse wheel scrolling **when hovering over the Y-axis price scale panel** (the right-side bar showing prices)
- Zooms the price range in/out based on mouse wheel direction
- Standard behavior in professional trading platforms

**Applies To**: All exchanges on `/market` page:
- ✅ Binance (Spot/Futures)
- ✅ Bybit (Spot/Futures)
- ✅ OKX (Spot/Futures)
- ✅ Gate (Spot/Futures)
- ✅ Bitget (Spot/Futures)
- ✅ MEXC (Spot/Futures)

### 2. CryptoChart.jsx Status
**File**: `client/src/components/charts/CryptoChart.jsx`

**Library Limitation**: lightweight-charts library **does not support** mouse wheel zoom specifically on the Y-axis panel.
- Mouse wheel zoom on the chart area: ✅ Already enabled
- Mouse wheel zoom on Y-axis panel: ❌ Not supported by library
- Alternative: Click and drag on Y-axis panel to zoom price scale

### 3. MiniChart.jsx Status
**File**: `client/src/components/charts/MiniChart.jsx`

**Intentionally Disabled**: Mini charts are overview widgets and don't need Y-axis scroll zoom functionality.

## 🧪 How to Test

### Testing KLineChart (Main Market Page)

1. **Start the Application**:
   ```powershell
   # Terminal 1 (Server)
   cd server
   npm start
   
   # Terminal 2 (Client)
   cd client
   npm run dev
   ```

2. **Navigate to Market Page**:
   - Open browser: `http://localhost:5173/market`
   - Select any exchange (e.g., Binance Futures)
   - Select any token (e.g., BTCUSDT)
   - Chart should load

3. **Test Y-Axis Panel Scroll**:
   - Move your mouse cursor **over the right-side price scale panel** (the vertical bar with price numbers like 0.500, 0.600, 0.700, etc.)
   - **Scroll the mouse wheel up/down**
   - Expected: The price range should zoom in/out
   - The price scale numbers should change dynamically

4. **Visual Verification**:
   - Scroll wheel up → Price range narrows (zoom in)
   - Scroll wheel down → Price range expands (zoom out)
   - Y-axis labels update to show more/fewer decimal places as needed

5. **Test Multiple Exchanges**:
   - Repeat steps 2-3 for:
     - Bybit Futures (e.g., BTCUSDT)
     - OKX Futures (e.g., BTC-USDT-SWAP)
     - Gate Futures (e.g., BTC_USDT)
     - Bitget Futures (e.g., BTCUSDT)
     - MEXC Futures (e.g., BTC_USDT)

### Expected Behavior

**✅ Working Correctly**:
- Hovering over Y-axis panel and scrolling mouse wheel zooms price scale
- Price range adjusts smoothly
- Price labels update dynamically
- Works consistently across all exchanges
- Real-time candle updates continue to work

**❌ Not Working** (would indicate a problem):
- Mouse wheel scroll has no effect when hovering over Y-axis panel
- Price range stays fixed
- Browser console shows errors

## 📊 Feature Comparison

| Component | Library | Y-Axis Panel Zoom | Chart Area Zoom |
|-----------|---------|-------------------|-----------------|
| KLineChart.jsx | klinecharts | ✅ Enabled | ✅ Enabled |
| CryptoChart.jsx | lightweight-charts | ❌ Library limitation | ✅ Enabled |
| MiniChart.jsx | lightweight-charts | ❌ Not needed | ❌ Disabled |

## 🔧 Troubleshooting

### Issue: Mouse wheel scroll doesn't zoom Y-axis panel

**Check**:
1. Make sure you're hovering **directly over the Y-axis panel** (right side bar with prices)
2. Not over the chart candles area
3. Browser cache cleared (Ctrl+Shift+R to hard refresh)

**Debug**:
```powershell
# Check if client is running
curl http://localhost:5173

# Check browser console for errors
# F12 → Console tab
```

### Issue: Changes not visible

**Solution**:
1. Stop client (Ctrl+C)
2. Clear browser cache
3. Restart client: `cd client; npm run dev`
4. Hard refresh browser: Ctrl+Shift+R

## 📝 Technical Details

### klinecharts v10 Configuration

The `scrollZoomEnabled` property must be set in the **layout options** during chart initialization:

```javascript
init(chartId, {
  layout: [
    {
      type: 'candle',
      options: {
        axis: {
          scrollZoomEnabled: true, // <-- This enables Y-axis panel scroll
        },
      },
    },
  ],
  // ... other options
});
```

**Why in layout options?**
- klinecharts v10 moved axis configuration from global settings into per-pane layout options
- This allows different panes to have different axis behaviors
- Configuration during `init()` is more reliable than calling `setPaneOptions()` after

### lightweight-charts Limitation

The lightweight-charts library ([GitHub Issue #1237](https://github.com/tradingview/lightweight-charts/issues/1237)) does not support mouse wheel zoom specifically when hovering over the price scale axis. This is a known limitation.

**Workaround**:
- Users can **click and drag** on the Y-axis panel to zoom the price scale
- Or use mouse wheel zoom on the chart area (already enabled)

## ✅ Testing Checklist

- [ ] Server started successfully
- [ ] Client started successfully
- [ ] Navigate to `/market` page
- [ ] Select Binance Futures → BTCUSDT
- [ ] Hover mouse over Y-axis panel (right side)
- [ ] Scroll mouse wheel → Price range zooms
- [ ] Test Bybit, OKX, Gate, Bitget, MEXC
- [ ] All exchanges show same behavior
- [ ] Real-time updates still working

## 🎉 Status

**✅ COMPLETE** - Mouse wheel zoom on Y-axis panel enabled for all klinecharts-based charts (main market page).

**Note**: CryptoChart.jsx (lightweight-charts) has a library limitation but users can still use click-and-drag on the Y-axis panel to zoom the price scale.
