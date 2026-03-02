# Alerts Quick Reference Card

## The 2-Minute Overview

### What Alerts Do
🎯 **Watch crypto prices** → 📱 **Notify you** when conditions are met

---

## Alert Types (Pick One)

### 🟢 Price Alert
Watch ONE coin hit ONE price target

```
Setup: Choose Exchange → Market → Symbol → Target Price
Example: "Alert me when Bitcoin hits $100,000"
Trigger: Price crosses target ONCE
Timeframe: Minutes to months
```

### 🔴 Complex Alert
Watch MANY coins move X% in 1 minute

```
Setup: Choose Exchange → All Coins or Whitelist → % Movement
Example: "Alert when any of top 20 coins moves 5% in 1 minute"
Trigger: Any coin in your list moves X%
Timeframe: Always 1 minute
```

---

## Quick Setup Flowchart

```
START
  ↓
Click [+ New Alert]
  ↓
[ ] Price Alert? OR [ ] Complex Alert?
  │                    │
  ↓                    ↓
Step 2a:             Step 2b:
• Exchange           • Exchange
• Market             • Market
• Name               • Name
  ↓                    ↓
Step 3a:             Step 3b:
• Symbol             • All or specific coins?
• Target Price       • % Movement (e.g., 5%)
  ↓                    ↓
Create!              Create!
  ↓
✓ ACTIVE in list
  ↓
Monitor Begins
```

---

## Exchanges (Pick One)

| Exchange | Best For | Speed |
|----------|----------|-------|
| 🟡 **Binance** | All markets, most coins | Fastest |
| 🟣 **Bybit** | Derivatives, leverage | Very fast |
| 🟠 **OKX** | Advanced features | Fast |
| 🟢 **Gate.io** | Altcoins | Good |
| 🔵 **MEXC** | New tokens | Good |
| ⚫ **Bitget** | Copy trading | Good |

---

## Markets (Pick One)

| Market | What You Own | Risk | Best For |
|--------|------------|------|----------|
| **SPOT** | Real coin | Low | Long-term holding |
| **FUTURES** | Price bet (leverage) | High | Short-term traders |

---

## Price Alert Conditions

| Condition | When Triggers | Example |
|-----------|---------------|---------|
| **ABOVE** | Price goes UP to target | BTC $45K → target $50K → triggers at ≥$50K |
| **BELOW** | Price goes DOWN to target | BTC $55K → target $50K → triggers at ≤$50K |

**Key:** Only triggers ONCE on crossing. Won't re-trigger if already above/below.

---

## Complex Alert Conditions

**Single type:** `% Change in 1 Minute`

| Setup | Triggers | Example |
|-------|----------|---------|
| 5% movement | Any coin ±5% in 60s | ETH $2000 → $2100 (+5%) ✓ |
| 10% movement | Any coin ±10% in 60s | BTC up 10% or down 10% ✓ |
| Either direction | + or - counts | SOL down 7% still triggers (if set to 7%) |

---

## The /Alerts Page - Key Buttons

| Button | Function | Location |
|--------|----------|----------|
| **[+ New Alert]** | Create new alert | Top left |
| **[🗑 Delete Selected]** | Bulk delete | Top right |
| **[Filter]** | Filter by status/exchange/type | Top right |
| **[✏️]** | Edit alert | Right of each row |
| **[🗑]** | Delete single alert | Right of each row |
| **[ON/OFF]** | Enable/Disable alert | Status column |

---

## Alert Table Columns

```
┌─────┬──────────────┬──────────┬────────┬────────┬──────────────────┐
│ ☐   │ NAME         │ EXCHANGE │ MARKET │ TYPE   │ STATUS           │
├─────┼──────────────┼──────────┼────────┼────────┼──────────────────┤
│ ☑   │ BTC Target   │ Binance  │ Spot   │ Price  │ ⚫ (Active)      │
│ ☐   │ Pump Alert   │ Bybit    │ Fut.   │ Compl. │ ⚫ (Triggered) ✓ │
│ ☐   │ Monitor All  │ Gate.io  │ Spot   │ Compl. │ → (Disabled)    │
└─────┴──────────────┴──────────┴────────┴────────┴──────────────────┘
```

---

## Filter Examples

```
Filter Panel:

Status: [Active ▼]          Market: [All ▼]
├─ Active     (ON)          ├─ Spot
├─ Triggered  (fired)       └─ Futures
├─ Inactive   (OFF)
└─ All

Exchange: [All ▼]          Type: [All ▼]
├─ Binance                  ├─ Price
├─ Bybit                    └─ Complex
├─ OKX
├─ Gate.io
├─ MEXC
└─ Bitget
```

---

## How It Works Behind Scenes

```
Your Alert
   ↓
Saved to Database
   ↓
Alert Engine Picks It Up
   ↓
Real-time Monitoring Begins
   ├─ Checks prices every second
   ├─ Compares to your condition
   └─ Price movements tracked
   ↓
Condition Met? YES
   ↓
TRIGGERED! 
   ├─ Database updated
   ├─ Notification sent (📧📱🔔)
   ├─ Alert shows [TRIGGERED] badge
   └─ Time recorded
   ↓
Alert Stays Active (ready for next trigger)
```

---

## Notification Channels

When alert triggers, you get notified via:

| Channel | Speed | Reliability |
|---------|-------|-------------|
| 🔔 **Push/In-App** | Instant | High (if online) |
| 📧 **Email** | 1-2 minutes | High |
| 📱 **SMS** | 1-5 minutes | Very high |

---

## Example Creation Walkthrough

### Example 1: BTC Price Target

```
Step 1: Price Alert (selected)
Step 2: 
  Exchange: Binance
  Market: Spot
  Name: "Bitcoin Break Through"
Step 3:
  Symbol: BTCUSDT
  Target: 105000
  Current: 98000
  Condition: ABOVE (will trigger when ≥ $105K)
  ↓
[Create Alert]
  ↓
✓ Added to list - ACTIVE
```

### Example 2: Quick Pump Scanner

```
Step 1: Complex Alert (selected)
Step 2:
  Exchange: Binance
  Market: Futures
  Name: "Moon Coins"
Step 3:
  Alert for: All coins (500+ tokens)
  Movement: 5% (either direction)
  Timeframe: 1 minute (fixed)
  ↓
[Create Alert]
  ↓
✓ Added to list - ACTIVE - watching all coins
```

---

## Status Icons Explained

| Icon | Meaning | Can Trigger? |
|------|---------|-------------|
| ⚫ | ACTIVE (ON) | YES - monitoring |
| ✓ | TRIGGERED | YES - fired once, ready for more |
| → | DISABLED (OFF) | NO - paused |

---

## Common Actions Cheatsheet

```
CREATE ALERT:
[+ New Alert] → Step 1 → Step 2 → Step 3 → Create ✓

ENABLE ALERT:
Find alert → Toggle switch to ⚫ ON

DISABLE ALERT:
Find alert → Toggle switch to → OFF

EDIT ALERT:
Find alert → Click [✏️] → Change (name/settings) → Update

DELETE ALERT:
Find alert → Click [🗑] → Confirm ✓ DELETED

BULK DELETE:
☑ Select multiple → [Delete Selected] → Confirm ✓

FILTER ALERTS:
Click [Filter] → Choose criteria → Auto-applies
```

---

## What Gets Locked After Creation

### Price Alert ❌ CAN'T CHANGE:
- Symbol (BTCUSDT, ETHUSDT, etc.)
- Target Price ($50,000, etc.)

### Price Alert ✅ CAN CHANGE:
- Alert Name ("Bitcoin Target" → "BTC Moon")

### Complex Alert ✅ CAN CHANGE:
- Whitelist coins (add/remove)
- % threshold (5% → 10%)
- Alert Name

### Complex Alert ❌ CAN'T CHANGE:
- Scope mode (All vs Whitelist) - revert to creation

---

## When Alerts Fire

### Price Alerts Fire When:
```
Your target: $50K (ABOVE)
Price path: $45K → $48K → $50.50K → FIRE! ✓

Your target: $50K (BELOW)
Price path: $55K → $52K → $49.50K → FIRE! ✓

Already crossed: Started at $51K with target $50K above = NO FIRE
Already crossed: Started at $49K with target $50K below = NO FIRE
```

### Complex Alerts Fire When:
```
Any symbol in scope moves ±X% in any given 60-second window

Example 1: Target 5%
BTC: $100 → $104 (+4%) = NO
BTC: $100 → $105 (+5%) = FIRE! ✓

Example 2: Target 5% (any direction)
ETH: $2000 → $2100 (+5%) = FIRE! ✓
SOL: $200 → $190 (-5%) = FIRE! ✓
```

---

## Performance Expectations

| Operation | Speed |
|-----------|-------|
| Create alert | Instant visible |
| Alert becomes active | Within 30 seconds |
| Price monitoring starts | Within 30 seconds |
| Trigger detection | 1-5 seconds after condition |
| Notification sent | Instant |
| Page refresh | 30 sec auto-refresh |

---

## Troubleshooting Quick Guide

| Problem | Solution |
|---------|----------|
| Alert not showing | Refresh page (F5) |
| Alert not triggering | Check if it's enabled (⚫) |
| Missed notification | Check triggered status in table |
| Can't edit symbol | Price alerts lock symbol (by design) |
| Missing coin in list | Try different exchange |
| Same alert twice created | Both stay active (independent) |

---

## Pro Tips

💡 **Create multiple price targets** = Catch price on way up
```
Alert 1: BTC > $90K
Alert 2: BTC > $95K
Alert 3: BTC > $100K (All can trigger independently)
```

💡 **Use whitelist for focused trading** = Less noise
```
Instead of: Monitor all 500 coins
Try: Whitelist only [BTC, ETH, SOL] you care about
```

💡 **Complex alerts for opportunities** = Find hidden gems
```
Set 15% threshold to catch unusual activity
Scale in positions as alerts fire
```

💡 **Price alerts for discipline** = Removes emotion
```
Set targets ahead of time
Wait for alert instead of watching chart all day
```

💡 **Review triggered alerts** = Track your accuracy
```
See which alerts fired
Analyze: Did you trade it? What was the result?
```

---

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `Tab` | Navigate form fields |
| `Enter/Space` | Select button |
| `Esc` | Close modal |
| `Ctrl+A` | Select all checkboxes |

---

## FAQ Mini

**Q: Do alerts auto-trade?**
A: No. Alerts only notify. You decide to buy/sell.

**Q: What if I'm offline?**
A: Alert still triggers in database. You'll see [TRIGGERED] tag when online.

**Q: Do alerts wear out?**
A: No. Stays active forever until you disable it.

**Q: Can I create duplicate alerts?**
A: Yes. System allows it. Both independent.

**Q: What if price crosses target before I see it?**
A: Alert still triggers. Shows [TRIGGERED] tag with time.

**Q: Most reliable timeframe?**
A: Complex alerts use 1-minute (most reliable data).

