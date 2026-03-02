# /Alerts Page - Complete UX & Features Guide

## Page Overview

The `/alerts` page is your command center for managing all cryptocurrency price monitoring alerts.

### Main Page Layout

```
┌────────────────────────────────────────────────────────────────┐
│                      ALERTS MANAGEMENT                         │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [+ New Alert]  [Delete Selected]     [Filter by: Status]     │
│                                       [Filter by: Exchange]    │
│                                       [Filter by: Type]        │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│  ☐  Name          Exchange  Market  Type     Description       │
├────────────────────────────────────────────────────────────────┤
│  ☑  BTC Moon      Binance   Spot    Price    Monitoring rise   │
│                                               to $100K (init    │
│                                               $88K)             │
│  ☐  ETH Dip       Bybit     Futures Price    Monitoring drop   │
│                                               to $3000 (init    │
│                                               $3500)            │
│                                                                 │
│  ☐  Pump Alert    Binance   Spot    Complex  Triggered by SOL: │
│                                               +5.2%             │
│                                                [Triggered]      │
│                                               2024-01-15        │
│  ☐  All Coins     Gate.io   Futures Complex  Monitor all       │
│                                               100+ tokens       │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Page Features Breakdown

### 1. Top Action Bar

```
┌─────────────────────────────────────────────────────────────┐
│                    ACTION BUTTONS                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [+ NEW ALERT]              [🗑 DELETE SELECTED (3)]         │
│   Creates new alert          Delete currently selected        │
│   Opens 3-step wizard        alerts (checkbox selection)      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Create New Alert Flow:**
1. Click **[+ NEW ALERT]**
2. Modal opens with 3-step wizard:
   - **Step 1**: Choose alert type (Price / Complex)
   - **Step 2**: Select exchange, market, name
   - **Step 3**: Configure specific settings
3. Click **Create alert**
4. Alert added to list and becomes ACTIVE

### 2. Filter Panel

```
┌──────────────────────────────────────┐
│         FILTER ALERTS                │
├──────────────────────────────────────┤
│                                      │
│  Status: [Active ▼]                 │
│  • Active      (only active alerts) │
│  • Triggered   (fired at least once)│
│  • Inactive    (disabled)            │
│  • All                               │
│                                      │
│  Exchange: [All ▼]                  │
│  • Binance, Bybit, OKX              │
│  • Gate.io, MEXC, Bitget            │
│                                      │
│  Market: [All ▼]                    │
│  • Spot                             │
│  • Futures                          │
│                                      │
│  Type: [All ▼]                      │
│  • Price alerts                     │
│  • Complex alerts                   │
│                                      │
└──────────────────────────────────────┘
```

### 3. Alerts Table Columns

| Column | Description |
|--------|-------------|
| **☐ Checkbox** | Select multiple alerts for bulk actions |
| **Name** | Your custom alert name (e.g., "BTC Target", "ETH Pump") |
| **Exchange** | Where alert monitors (Binance, Bybit, OKX, etc.) |
| **Market** | Spot or Futures |
| **Type** | "Price" or "Complex" badge |
| **Description** | Auto-generated summary of alert conditions |
| **Status Toggle** | ON/OFF switch to enable/disable alert |
| **Actions** | Edit (pencil icon) or Delete (trash icon) |

---

## Creating Alerts - The 3-Step Wizard

### Step 1: Choose Alert Type

```
┌────────────────────────────────────────────────────────────┐
│  STEP 1: WHAT TYPE OF ALERT?                              │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐  ┌──────────────────────────────┐│
│  │  PRICE ALERT        │  │  COMPLEX ALERT               ││
│  ├─────────────────────┤  ├──────────────────────────────┤│
│  │ Monitor 1 coin      │  │ Monitor many coins           ││
│  │ price target        │  │ Notify when any move X%      ││
│  │                     │  │                              ││
│  │ Examples:           │  │ Examples:                    ││
│  │ • BTC hits $100K    │  │ • Any coin +5% in 1 minute   ││
│  │ • ETH drops to $2K  │  │ • Bitcoin & Ethereum +10%    ││
│  │                     │  │ • All 100 tokens jump 15%    ││
│  │ ☑ SELECTED          │  │                              ││
│  │ [Next →]            │  │ [Next →]                     ││
│  └─────────────────────┘  └──────────────────────────────┘│
│                                                             │
│  [Cancel]                                           [Next →]│
└────────────────────────────────────────────────────────────┘
```

### Step 2: Exchange & Basic Info

```
┌────────────────────────────────────────────────────────────┐
│  STEP 2: WHERE & WHAT DO YOU CALL IT?                      │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Exchange: [Binance ▼]                                     │
│  • Binance, Bybit, OKX, Gate.io, MEXC, Bitget             │
│                                                             │
│  Market: [Futures ▼]                                       │
│  • Spot (own the coin)                                    │
│  • Futures (predict price)                                │
│                                                             │
│  Alert Name (optional):                                   │
│  [________________] e.g., "BTC Moon Landing"              │
│                                                             │
│                                                             │
│  [← Back]                                         [Next →]  │
└────────────────────────────────────────────────────────────┘
```

### Step 3A: Price Alert Settings

```
┌────────────────────────────────────────────────────────────┐
│  STEP 3: PRICE ALERT SETTINGS                             │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Token / Symbol:                                           │
│  [Search: BTCUSDT] (locked if editing)                    │
│  Select from 500+ tokens                                  │
│                                                             │
│  Target Price:                                             │
│  [50000______]                                             │
│                                                             │
│  Current price: $45,000 → triggers when ≥ $50,000         │
│  (shows live price direction: ↑ green for direction)       │
│                                                             │
│  Note: Alert triggers ONCE when price first crosses       │
│  target. Both symbol and price are locked after creation  │
│  (you can only edit the name).                            │
│                                                             │
│  [← Back]                                    [Create Alert] │
└────────────────────────────────────────────────────────────┘
```

### Step 3B: Complex Alert Settings

```
┌────────────────────────────────────────────────────────────┐
│  STEP 3: COMPLEX ALERT SETTINGS                           │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ALERT FOR:                                                │
│  [All coins]  [One or more coins]  (toggle)               │
│                                                             │
│  If "All coins":                                           │
│  ┌──────────────────────────────────────────────┐         │
│  │ Monitor all 500+ tokens on Futures market    │         │
│  │ in real-time. Any coin that moves 5% = alert│         │
│  └──────────────────────────────────────────────┘         │
│                                                             │
│  If "One or more coins":                                   │
│  ┌──────────────────────────────────────────────┐         │
│  │ Selected coins (whitelist):                 │         │
│  │ [●Bitcoin] [●Ethereum] [●Solana]           │         │
│  │ [Search and add more...]                    │         │
│  │ 3 tokens in whitelist                       │         │
│  └──────────────────────────────────────────────┘         │
│                                                             │
│  MOVEMENT CONDITION:                                       │
│  ┌────────────────────────────────────┐                   │
│  │ % Move: [5____]%                   │                  │
│  │ Timeframe: 1 minute (fixed)        │                  │
│  └────────────────────────────────────┘                   │
│                                                             │
│  Alert fires when any coin in scope moves ≥ 5% in 60 sec │
│                                                             │
│  [← Back]                                    [Create Alert] │
└────────────────────────────────────────────────────────────┘
```

---

## Managing Alerts on the List

### Editing an Alert

**What can be edited:**
- **Price Alert**: Only the name ✏️
  - Symbol and target price are LOCKED (can't change)
  - Shows lock icon with message
  
- **Complex Alert**: Name, coin whitelist, % threshold ✏️
  - Can adjust which coins to monitor
  - Can change movement %

**How to edit:**
1. Click **pencil icon** on alert row
2. Modal opens with pre-filled data
3. Make changes
4. Click **Update alert**

### Toggling Alert Status

```
Active (ON):  ⚫→  Alert is monitoring
              ❌ Alert is disabled

Disabled (OFF): →⚫  Alert is paused
                     (won't trigger, can re-enable)
```

**Toggle behavior:**
- Click the **ON/OFF switch** in the Status column
- Active alert: Watches 24/7, notifies when triggers
- Disabled alert: Won't trigger, but data is saved
- Can re-enable anytime with one click

### Deleting Alerts

**Option 1: Delete Single Alert**
1. Click **trash icon** on alert row
2. Confirm deletion
3. Alert removed from system

**Option 2: Delete Multiple Alerts**
1. Check **☐ checkboxes** for alerts you want to delete
2. Click **Delete Selected** button
3. Confirm deletion of N alerts
4. All selected alerts removed

---

## Alert Status Meanings

### Active (Still Watching)
- ✓ Alert is ON
- Currently watching for conditions
- Will notify when triggered
- Light gray background

### Triggered (Fired!)
- ✓ Alert has fired at least once
- Shows **[TRIGGERED]** badge in Type column
- Shows timestamp of when it triggered
- Also shows which symbol caused trigger (complex alerts)
- Green highlight
- Alert stays active (ready for next trigger if conditions reset)

### Inactive (Disabled)
- ✗ Alert is OFF
- Will NOT trigger
- Manually disabled by user
- Data preserved (can re-enable)

---

## Real-Time Updates

### How Data Updates

```
User creates alert
       ↓
Alert appears in table immediately
       ↓
Alert engine picks it up (within 30 sec)
       ↓
Real-time monitoring begins
       ↓
If triggered → table updates instantly (WebSocket)
              → notification sent to user
              → [TRIGGERED] badge appears
       ↓
Page auto-refreshes every 30 seconds
       ↓ 
Fallback if WebSocket disconnects
       ↓
User back to tab → auto-refreshes
```

---

## Filtering Examples

### Example 1: See Active Price Alerts on Binance Futures

```
Filters:
• Status: Active
• Exchange: Binance
• Market: Futures
• Type: Price

Result: Shows only active price alerts on Binance Futures
```

### Example 2: All Triggered Alerts (Recently Fired)

```
Filters:
• Status: Triggered
• Exchange: All
• Market: All
• Type: All

Result: All alerts that have fired at least once
       (Recently caught opportunities)
```

### Example 3: Complex Alerts Across All Exchanges

```
Filters:
• Status: Active
• Exchange: All
• Market: Spot
• Type: Complex

Result: All active complex alerts monitoring spot markets
       (Watching for quick pumps)
```

---

## Notifications When Alert Triggers

### Alert Triggers → You Get Notified Through:

1. **In-App Notification** 🔔
   - Shows immediately on page
   - Desktop push notification
   - Updates alert table with [TRIGGERED] badge

2. **Email** 📧
   - Contains alert name, symbol, conditions
   - Shows current price/movement

3. **SMS** 📱
   - Quick text message
   - Key details (alert name, coin, price)

4. **Browser Push** 🔔
   - If enabled
   - Desktop notification

**What happens next:**
- You see notification
- You review the opportunity
- You decide whether to trade (app doesn't auto-trade)
- Alert stays active for next crossing

---

## Performance Tips

### Best Practices

✅ **DO:**
- Create alerts for realistic prices
- Use complex alerts to scan many coins
- Enable only alerts you actively monitor
- Review triggered alerts regularly
- Delete unused alerts

❌ **DON'T:**
- Create identical alerts (wastes resources)
- Set extremely aggressive % thresholds (will trigger on noise)
- Leave unnecessary alerts active
- Rely sole on alerts for trading decisions
- Set target prices too close to current (might already trigger)

### For Day Traders
- Use Complex alerts (1-minute movement)
- Watch top 20 coins whitelist
- Set 5-10% threshold
- Check page frequently
- Delete after trading session

### For Long-term Investors
- Use Price alerts
- Set realistic targets (weeks/months away)
- Set and forget
- Check occasionally
- Can leave active indefinitely

---

## Common Issues & Solutions

### Alert Not Triggering?

**Possible causes:**
1. Alert is disabled → Toggle it ON
2. Conditions already met when created → Edit and create new
3. Exchange data delayed → Wait 1-2 minutes
4. Network issue → Refresh page (F5)
5. Wrong market selected → Delete and recreate on correct market

### Alert Triggered but I Didn't See It?

1. Check [Triggered] badge in table
2. Notification might be hidden → Check browser notification panel
3. Was offline when fired → Alert still shows as triggered
4. Check triggered timestamp in alert details

### Can't Edit Symbol or Price?

- Price alerts lock symbol and target after creation (design choice)
- To change: Delete old alert and create new one
- Complex alerts: You CAN edit whitelist and % threshold

### Missing Coins in Token List?

1. Some coins only on specific exchanges
2. Try different exchange in Step 2
3. Not all 5000+ coins supported
4. Use symbol search instead of scrolling

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Create new alert | `Ctrl/Cmd + N` (if implemented) |
| Filter alerts | `Ctrl/Cmd + F` |
| Delete selected | `Delete` key |
| Select all | `Ctrl/Cmd + A` |

---

## Example Scenarios

### Scenario 1: Waiting for Big Bitcoin Move

**Setup:**
```
Type: Price Alert
Exchange: Binance Futures
Symbol: BTCUSDT
Target: $100,000
Current: $88,000
```

**User perspective:**
- Creates alert
- Sees it in table "ACTIVE"
- Goes about daily life
- Alert watches 24/7
- *Months later...*
- Bitcoin hits $100K
- 📱 Gets notified immediately
- Sees alert shows [TRIGGERED]
- Decides to buy/sell

### Scenario 2: Day Trading Pump Alert

**Setup:**
```
Type: Complex Alert
Exchange: Binance Spot
Market: Spot
Scope: Top 20 coins
Movement: 7%
Timeframe: 1 minute
```

**User perspective:**
- Creates alert before market hours
- Checks page every 30 minutes
- Looking for quick trading opportunities
- See alert triggers: SOL +7.2% in 1s minute
- 🚀 Quick buy! 
- Makes quick trade
- Disables alert (day done)

### Scenario 3: Multiple Targets on One Coin

**Setup:**
```
Alert 1: BTC reaches $90,000
Alert 2: BTC reaches $95,000  
Alert 3: BTC reaches $100,000
```

**User perspective:**
- Set multiple price targets
- Helps track progression
- Get notified at each level
- Can scale into position
- Every target potentially triggers once

