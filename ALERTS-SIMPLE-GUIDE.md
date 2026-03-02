# Alerts System - Complete Guide

## What Are Alerts?

**Alerts are automatic notifications that trigger when prices move the way you expect.**

Think of them like setting a reminder on your phone: "Text me when Bitcoin reaches $50,000" or "Tell me when any coin jumps 5% in 1 minute."

---

## Simple Visual Explanation

### How Price Alerts Work

```
┌─────────────────────────────────────────────────────────────┐
│                    PRICE ALERT SETUP                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  "Alert me when Bitcoin reaches $50,000"                     │
│  ┌─────────────┐                                             │
│  │ Bitcoin     │  Current: $45,000                           │
│  │ BTCUSDT     │  Target:  $50,000 ↑                         │
│  │ Binance     │  Waiting...                                 │
│  │ Futures     │                                             │
│  └─────────────┘                                             │
│                                                               │
│  Price rising:  45,000 → 48,000 → 50,000 ✓ ALERT!           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### How Complex Alerts Work

```
┌─────────────────────────────────────────────────────────────┐
│                  COMPLEX ALERT SETUP                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  "Alert me if ANY coin jumps 5% in 1 minute"                │
│  ┌──────────────────────────────────────┐                   │
│  │  Monitor these coins:                │                   │
│  │  • Bitcoin (BTC)                     │                   │
│  │  • Ethereum (ETH)                    │                   │
│  │  • Ripple (XRP)                      │                   │
│  │  (or ALL 50+ coins on Binance)       │                   │
│  └──────────────────────────────────────┘                   │
│                                                               │
│  Check every second:                                         │
│  BTC: +2%  ❌  ETH: +1%  ❌  XRP: +5.2%  ✓ ALERT!           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Complete Alert Types & Features

### 1. Price Alerts

**What it does:** Monitors ONE specific cryptocurrency and alerts when its price reaches your target.

**Setup:**
- **Exchange**: Where to watch (Binance, Bybit, OKX, Gate.io, MEXC, Bitget)
- **Market**: Spot (own the coin) or Futures (predict the price)
- **Symbol**: Which coin (BTC, ETH, SOL, etc.)
- **Target Price**: When to alert you
- **Alert Name**: Your label (optional, e.g., "BTC Moon Landing")

**How triggering works:**
- Alert fires **once** when price first crosses your target
- Works both directions:
  - If current is $45K, target is $50K → alerts when ≥ $50K
  - If current is $55K, target is $50K → alerts when ≤ $50K
- Won't re-trigger for the same crossing (one-time event)

**Example:**
- Create alert: "BTC hits $60,000 on Binance Futures"
- Current price: $55,000
- Alert waits and watches...
- Price goes: $55K → $57K → $60K → TRIGGERED! You get notified.

---

### 2. Complex Alerts

**What it does:** Monitors MANY cryptocurrencies for rapid price movement in a short time window (1 minute).

**Setup:**
- **Monitor**: Choose ALL coins OR pick specific whitelist
  - **All Coins** = Watch entire market (100+ tokens)
  - **Whitelist** = Pick exactly which coins to watch (e.g., only top 10)
- **Movement %**: How much price must change (e.g., 5%)
- **Timeframe**: Always 1-minute window (fastest trades happen here)

**How triggering works:**
- System checks every second
- If ANY coin in your list moves ≥ 5% in 1 minute → TRIGGERED
- Tells you which coin triggered it and how much it moved

**Examples:**
- **Setup**: "Alert if any top 20 coin jumps 5% in 1 minute"
  - BTC: +2%, ETH: +1.5%, SOL: +5.2% ✓ **ALERT FIRES!** (SOL triggered it)

- **Setup**: "Alert if Bitcoin OR Ethereum move 10% in 1 minute"
  - Watches BTCUSDT and ETHUSDT only
  - BTC hits 10% jump → **ALERT FIRES!**

---

## Alert Conditions Explained

### Price Alert Conditions
```
ABOVE (Price rises to target):
  Current: $100 → Target: $120
  Triggers: First time price ≥ $120
  
BELOW (Price drops to target):
  Current: $100 → Target: $80
  Triggers: First time price ≤ $80
```

### Complex Alert Conditions
```
PERCENTAGE CHANGE (any direction):
  "Move 5% in 1 minute"
  Examples that trigger:
  • Price up 5%: $100 → $105 ✓
  • Price down 5%: $100 → $95 ✓
  • Jumps around: $100 → $98 → $105 ✓
```

---

## Supported Exchanges & Markets

### Exchanges (6 total)
1. **Binance** - Largest crypto exchange
2. **Bybit** - Popular futures/options trading
3. **OKX** - Advanced trading features
4. **Gate.io** - Wide token selection
5. **MEXC** - Emerging altcoins
6. **Bitget** - Copy trading available

### Markets per Exchange
- **Spot** = Directly own the cryptocurrency
- **Futures** = Bet on price movements (with leverage, higher risk)

---

## Alert Lifecycle

```
┌──────────┐
│  CREATE  │  User sets up alert
└─────┬────┘
      ↓
┌──────────────────┐
│  ACTIVE          │  Alert is watching 24/7
│  (ON)            │
└─────┬────────┬───┘
      │        │
  Price crosses  OR  Alert manually disabled
      │              (Toggle OFF)
      ↓
┌──────────────────┐
│  TRIGGERED       │  Alert condition met!
│  (Notification)  │  You get SMS/Email/Push
└─────┬────────────┘
      ↓
┌──────────────────┐
│  ACTIVE          │  Alert stays on for
│  (Ready again)   │  next crossing
└──────────────────┘
```

---

## How the System Works Behind-the-Scenes

```
┌──────────────────────────────────────────────────────────────┐
│                     YOUR ALERTS APP                          │
│                                                               │
│  Step 1: You Create Alert                                   │
│  "Alert me when ETH > $3000 on Binance Futures"             │
│         ↓                                                    │
│  Step 2: Saved to Database                                  │
│  Alert ID: 12345 | User: you | Status: ACTIVE              │
│         ↓                                                    │
│  Step 3: Alert Engine Monitors                              │
│  ┌─ Connects to Binance live prices                         │
│  ├─ Checks every price tick                                 │
│  ├─ Compares against your conditions                        │
│  └─ If triggered → Sends notification                       │
│         ↓                                                    │
│  Step 4: You Get Notified                                   │
│  📱 SMS / 📧 Email / 🔔 Browser Push                        │
│  "ETH reached $3000!"                                       │
│         ↓                                                    │
│  Step 5: Alert Remains Active                               │
│  Ready to trigger again if price crosses again              │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Comparison: Price vs Complex

| Feature | Price Alert | Complex Alert |
|---------|-----------|---------------|
| **Monitors** | 1 coin | Many coins |
| **Watch for** | Reaching a price | Moving X% |
| **Timeframe** | Any (hours/days/weeks) | 1 minute only |
| **Use case** | Long-term targets | Quick momentum trades |
| **Triggers on** | Price crossing | Fast movement |
| **Example** | "BTC hits $100K" | "Any coin jumps 10% in 60s" |

---

## Real-World Examples

### Example 1: Day Trader
**Setup:** Complex alert - "Alert if any top 20 coin moves 5% in 1 minute on Binance Spot"
**Why:** Catch quick trading opportunities throughout the day
**Trigger:** SOL jumps 5% in 1 minute → Ready to trade

### Example 2: Long-term Investor
**Setup:** Price alert - "Alert when Bitcoin reaches $100K on Binance Futures"
**Why:** Set it and forget it, get notified when major target hit
**Trigger:** Months later, Bitcoin finally hits $100K

### Example 3: Selective Trader
**Setup:** Complex alert - "Alert if Bitcoin, Ethereum, or Solana move 8% in 1 minute"
**Why:** Watch only favorite coins
**Trigger:** ETH jumps 8% → You're notified

---

## Important Notes

✅ **Alerts work 24/7** - System monitors even when you're offline
✅ **Real-time checking** - Price updates every second
✅ **Multiple exchanges** - Create different alerts per exchange
✅ **Easy to manage** - Enable/disable alerts with one click
✅ **Historical view** - See all notifications you've received

⚠️ **Alert doesn't hold your hand** - Just notifies you, you decide to trade
⚠️ **Markets move fast** - By the time you see alert, price might have moved further
⚠️ **No auto-trading** - Alert only tells you, doesn't place orders for you

