# Alerts Visual Diagrams & Flow Charts

## Alert System Overview

### System Components Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CRYPTO EXCHANGE ALERTS                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────┐                                             │
│  │   /ALERTS PAGE (UI)     │                                             │
│  │                         │                                             │
│  │  • List all alerts      │                                             │
│  │  • Create/Edit/Delete   │                                             │
│  │  • Filter & search      │                                             │
│  │  • Toggle active/off    │                                             │
│  └────────────┬────────────┘                                             │
│               │ HTTP/WebSocket                                           │
│               ↓                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │            API SERVER (Express.js)                              │   │
│  │  Routes:  GET/POST/PUT/PATCH/DELETE /alerts                   │   │
│  └────────┬──────────────────────────────────┬────────┬───────────┘   │
│           │                                  │        │                 │
│           ↓                                  ↓        ↓                 │
│  ┌────────────────────┐      ┌──────────────────────────────────────┐ │
│  │   PRICE ALERT      │      │   COMPLEX ALERT ENGINE               │ │
│  │   ENGINE           │      │                                       │ │
│  │                    │      │  • 30s cache of active alerts        │ │
│  │ • Monitors 1 coin  │      │  • Checks ALL coins or whitelist    │ │
│  │ • Price crossing   │      │  • % movement in 1 minute           │ │
│  │ • Target value     │      │  • 300ms polling                    │ │
│  │ • Real-time check  │      │                                       │ │
│  └────────┬───────────┘      └──────────────────┬───────────────────┘ │
│           │ Real-time price feeds               │                     │
│           └───────────────┬──────────────────────┘                     │
│                           │                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │           EXCHANGE DATA FEEDS                                    │  │
│  │  ├─ Binance WebSocket (live prices)                             │  │
│  │  ├─ Bybit WebSocket                                             │  │
│  │  ├─ OKX WebSocket                                               │  │
│  │  ├─ Gate.io WebSocket                                           │  │
│  │  ├─ MEXC WebSocket                                              │  │
│  │  └─ Bitget WebSocket                                            │  │
│  │                                                                   │  │
│  │  Updates: Every 1-5 seconds per symbol                          │  │
│  └──────────────────────┬──────────────────────────────────────────┘  │
│                         │                                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │             DATABASE (PostgreSQL)                                │  │
│  │                                                                   │  │
│  │  • alerts table (alert configs)                                 │  │
│  │  • alertTriggers table (history)                                │  │
│  │  • EngineLease (single worker)                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │           NOTIFICATION SERVICE                                   │  │
│  │  ├─ Email (Gmail)                                               │  │
│  │  ├─ SMS (Twilio)                                                │  │
│  │  ├─ Browser Push                                                │  │
│  │  └─ WebSocket (in-app)                                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Complete Alert Lifecycle

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     ALERT LIFECYCLE FLOWCHART                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. USER CREATES ALERT                                                   │
│     └─ Fills form: Exchange, Market, Type, Conditions                    │
│                                                                            │
│  2. FORM SUBMISSION                                                      │
│     └─ POST /alerts { alertType, exchange, symbols, conditions }         │
│                                                                            │
│  3. SERVER PROCESSES                                                     │
│     ├─ Validates input                                                   │
│     ├─ Creates alert record in DB                                        │
│     ├─ Returns alert with ID                                             │
│     └─ Status: INACTIVE (not yet in engine)                              │
│                                                                            │
│  4. ALERT ENGINE PICKS UP (within 30s)                                   │
│     ├─ Complex alerts: Added to in-memory cache                          │
│     ├─ Price alerts: Will be checked on next price tick                  │
│     └─ Status changes: ACTIVE (now monitoring)                           │
│                                                                            │
│  5. MONITORING BEGINS                                                    │
│     │                                                                     │
│     ├─ PRICE ALERT:                                                      │
│     │  ├─ Checks new price ticks for symbol                             │
│     │  ├─ Compares current price vs target                              │
│     │  ├─ Checks crossing logic (ABOVE/BELOW)                           │
│     │  └─ Every new price tick (1-5 sec)                                │
│     │                                                                     │
│     └─ COMPLEX ALERT:                                                    │
│        ├─ Maintains 60+ second history                                   │
│        ├─ Calculates % change for all symbols                            │
│        ├─ Checks if any symbol ≥ threshold                              │
│        └─ Every 300ms or new price                                       │
│                                                                            │
│  6. CONDITION MET? (At some point...)                                    │
│     ├─ YES: Continue to step 7                                           │
│     └─ NO: Continue monitoring (loop back to 5)                          │
│                                                                            │
│  7. ALERT TRIGGERS! 🎯                                                   │
│     ├─ Record trigger event in alertTriggers table                       │
│     ├─ Update alert.triggered = true                                     │
│     ├─ Update alert.triggeredAt = NOW()                                  │
│     ├─ For complex: Save triggeringSymbol & pctChange                    │
│     └─ Status changes: TRIGGERED                                         │
│                                                                            │
│  8. NOTIFICATIONS SENT                                                   │
│     ├─ Email: "Your alert caught BTC reaching $100K!"                    │
│     ├─ SMS: "ALERT: BTC $100K Binance Spot (Price Alert)"                │
│     ├─ Browser push: Toast notification                                  │
│     └─ WebSocket: Real-time UI update                                    │
│                                                                            │
│  9. USER SEES NOTIFICATION                                               │
│     ├─ Opens app/email/SMS                                               │
│     ├─ Reads alert details                                               │
│     ├─ Sees [TRIGGERED] badge in alerts table                            │
│     └─ Takes action: BUY/SELL/IGNORE                                     │
│                                                                            │
│  10. ALERT REMAINS ACTIVE                                                │
│      ├─ Example: Price alert at $100K                                    │
│      ├─ Price drops to $95K later                                        │
│      ├─ If crosses back to $100K → fires again!                          │
│      ├─ User can disable if not needed anymore                           │
│      └─ Or keep watching for next crossing                               │
│                                                                            │
│  11. ALERT ENDS WHEN                                                     │
│      ├─ User disables (toggle OFF)                                       │
│      ├─ User deletes                                                     │
│      └─ System error/engine outage                                       │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Price Alert Crossing Logic

```
┌──────────────────────────────────────────────────────────────────┐
│          PRICE ALERT: HOW CROSSING WORKS                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  SCENARIO 1: ABOVE (You want price to RISE)                      │
│                                                                   │
│    Initial Price: $45K                                           │
│    Target: $50K (ABOVE)                                          │
│                                                                   │
│    Price timeline:                                               │
│    $45K → $48K → $50K → $52K                                     │
│                         ↓                                         │
│                    TRIGGER ✓                                     │
│                                                                   │
│    (First time crosses above $50K → FIRES)                       │
│                                                                   │
│  ─────────────────────────────────────────────────────────────   │
│                                                                   │
│  SCENARIO 2: BELOW (You want price to DROP)                      │
│                                                                   │
│    Initial Price: $55K                                           │
│    Target: $50K (BELOW)                                          │
│                                                                   │
│    Price timeline:                                               │
│    $55K → $52K → $50K → $48K                                     │
│                    ↓                                              │
│               TRIGGER ✓                                          │
│                                                                   │
│    (First time crosses below $50K → FIRES)                       │
│                                                                   │
│  ─────────────────────────────────────────────────────────────   │
│                                                                   │
│  SCENARIO 3: ALREADY PAST TARGET (NO TRIGGER)                    │
│                                                                   │
│    Initial Price: $55K                                           │
│    Target: $50K (ABOVE)  ← Problem!                              │
│                                                                   │
│    ✗ WON'T TRIGGER                                               │
│      (Already ABOVE target, nothing to cross)                    │
│                                                                   │
│  ─────────────────────────────────────────────────────────────   │
│                                                                   │
│  SCENARIO 4: OSCILLATING (Only fires on FIRST crossing)          │
│                                                                   │
│    Initial: $48K                                                 │
│    Target: $50K (ABOVE)                                          │
│                                                                   │
│    Price bounces:                                                │
│    $48K → $50.1K  → TRIGGER ✓                                    │
│         → $49.5K  (no re-trigger)                                │
│         → $50.2K  (no re-trigger, already fired)                 │
│         → $48K    (stays fired)                                  │
│         → $51K    (no re-trigger, was already fired)             │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Complex Alert Percentage Change Logic

```
┌──────────────────────────────────────────────────────────────────┐
│        COMPLEX ALERT: % CHANGE CALCULATION                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Setup: Watch Bitcoin, Movement: ±5%, Timeframe: 1 minute        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  CALCULATION:                                            │   │
│  │                                                          │   │
│  │  % Change = ((Price Now - Price 60s ago) / Price 60s)   │   │
│  │           × 100                                         │   │
│  │                                                          │   │
│  │  IF |% Change| ≥ 5% → TRIGGER                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  EXAMPLE 1: POSITIVE MOVEMENT                                   │
│  ┌─────────────────────────────────────┐                        │
│  │ 60 seconds ago: BTC = $100          │                        │
│  │ Now:           BTC = $105           │                        │
│  │                                     │                        │
│  │ % Change = (105 - 100) / 100 × 100  │                        │
│  │          = 5%                       │                        │
│  │                                     │                        │
│  │ 5% ≥ 5% ✓ TRIGGER!                  │                        │
│  └─────────────────────────────────────┘                        │
│                                                                   │
│  EXAMPLE 2: NEGATIVE MOVEMENT                                   │
│  ┌─────────────────────────────────────┐                        │
│  │ 60 seconds ago: ETH = $2000         │                        │
│  │ Now:           ETH = $1900          │                        │
│  │                                     │                        │
│  │ % Change = (1900 - 2000) / 2000 × 100                       │
│  │          = -5%                      │                        │
│  │                                     │                        │
│  │ |-5%| ≥ 5% ✓ TRIGGER! (either dir) │                        │
│  └─────────────────────────────────────┘                        │
│                                                                   │
│  EXAMPLE 3: NO TRIGGER (BELOW THRESHOLD)                        │
│  ┌─────────────────────────────────────┐                        │
│  │ 60 seconds ago: SOL = $200          │                        │
│  │ Now:           SOL = $208           │                        │
│  │                                     │                        │
│  │ % Change = (208 - 200) / 200 × 100  │                        │
│  │          = 4%                       │                        │
│  │                                     │                        │
│  │ 4% < 5% ✗ NO TRIGGER (need ≥5%)    │                        │
│  └─────────────────────────────────────┘                        │
│                                                                   │
│  ─────────────────────────────────────────────────────────────  │
│                                                                   │
│  MULTI-SYMBOL MONITORING                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Alert checking 50 coins at once:                         │  │
│  │                                                          │  │
│  │ Check all 50 coins in the 1-minute window:              │  │
│  │                                                          │  │
│  │ BTC:    +2% (below 5%) ❌                               │  │
│  │ ETH:    +1% (below 5%) ❌                               │  │
│  │ SOL:   +5.2% (above 5%) ✓ TRIGGER!                     │  │
│  │ XRP:    +3% (below 5%) ❌                               │  │
│  │ ADA:    +2% (below 5%) ❌                               │  │
│  │ ...                                                      │  │
│  │ (Any single coin ≥ threshold fires the alert)          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Alert Trigger to Notification

```
┌───────────────────────────────────────────────────────────────────────┐
│              ALERT FIRES: WHAT HAPPENS BEHIND THE SCENES               │
├───────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. CONDITION MET (in alert engine memory)                             │
│     │                                                                  │
│     ├─ Price Alert: Current price ≥ target                            │
│     │  └─ Example: Target $100K, current price $100.5K ✓             │
│     │                                                                  │
│     └─ Complex Alert: Symbol moved ≥ X% in 60s                        │
│        └─ Example: SOL +5.2% in 1 minute ✓                            │
│                                                                         │
│  2. DATABASE UPDATE                                                    │
│     ├─ alertTriggers.insert({                                         │
│     │    alertId: "abc123",                                           │
│     │    userId: "user456",                                           │
│     │    triggeredAt: NOW(),                                          │
│     │    price: 100.5,                                                │
│     │    pctChange: 5.2  (if complex)                                 │
│     │  })                                                              │
│     │                                                                  │
│     └─ alerts.update({                                                │
│          id: "abc123",                                                │
│          triggered: true,                                             │
│          triggeredAt: NOW()                                           │
│        })                                                              │
│                                                                         │
│  3. NOTIFICATION SERVICE TRIGGERED                                     │
│     │                                                                  │
│     ├─ Build message:                                                 │
│     │  ├─ "Alert Triggered: BTC reaches $100K on Binance"            │
│     │  ├─ Time: 2024-01-15 14:32:45                                  │
│     │  └─ Price: $100,500                                             │
│     │                                                                  │
│     └─ Queue notifications:                                           │
│        ├─ Email notification                                          │
│        ├─ SMS notification                                            │
│        ├─ Browser push                                                │
│        └─ In-app toast                                                │
│                                                                         │
│  4. WEBSOCKET BROADCAST                                                │
│     │                                                                  │
│     └─ Send to user client:                                           │
│        {                                                              │
│          type: 'ALERT_TRIGGERED',                                     │
│          alertId: 'abc123',                                           │
│          message: 'BTC reaches $100K',                                │
│          timestamp: NOW()                                             │
│        }                                                              │
│                                                                         │
│  5. FRONTEND UPDATES                                                   │
│     │                                                                  │
│     ├─ Toast notification appears                                      │
│     ├─ Alert row in table gets [TRIGGERED] badge                     │
│     └─ Updates triggeredAt timestamp                                  │
│                                                                         │
│  6. EXTERNAL NOTIFICATIONS SENT                                        │
│     │                                                                  │
│     ├─ EMAIL (within 1-2 minutes)                                     │
│     │  ├─ To: user@example.com                                        │
│     │  ├─ Subject: Alert Triggered                                    │
│     │  └─ Body: Details of alert trigger                             │
│     │                                                                  │
│     ├─ SMS (within 1-5 minutes)                                       │
│     │  ├─ To: +1234567890                                             │
│     │  └─ Message: "ALERT: BTC $100K Binance"                         │
│     │                                                                  │
│     └─ BROWSER PUSH (if enabled, instant)                             │
│        └─ Desktop notification appears                                │
│                                                                         │
│  7. USER INTERACTION                                                   │
│     │                                                                  │
│     ├─ Sees notification                                              │
│     ├─ Clicks to open app                                             │
│     ├─ Reviews alert details                                          │
│     └─ Decides to trade or ignore                                     │
│                                                                         │
│  8. ALERT STATE                                                        │
│     │                                                                  │
│     └─ Remains ACTIVE                                                 │
│        ├─ Continues monitoring                                        │
│        ├─ Can fire again if price resets and crosses again            │
│        └─ User can manually disable if needed                         │
│                                                                         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## User Interface Navigation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    /ALERTS PAGE FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Entry Point: User clicks "Alerts" in navigation                │
│       ↓                                                          │
│  ┌─ [/Alerts Page Loads]                                        │
│  │  ├─ Fetches user's alerts from API                          │
│  │  ├─ Groups by status (Active/Triggered/Inactive)            │
│  │  └─ Displays in table with filters                          │
│  │                                                              │
│  ├─ User Actions:                                               │
│  │                                                              │
│  │  Option A: CREATE NEW                                       │
│  │  └─ [+ NEW ALERT] → Modal opens                             │
│  │                                                              │
│  │     Step 1: Pick type                                       │
│  │     ├─ Select: Price Alert or Complex Alert                 │
│  │     └─ [Next]                                               │
│  │                                                              │
│  │     Step 2: Basic Info                                      │
│  │     ├─ Select: Exchange, Market                             │
│  │     ├─ Enter: Name (optional)                               │
│  │     └─ [Next] or [Back]                                     │
│  │                                                              │
│  │     Step 3: Specific Settings                               │
│  │     ├─ Price Alert:                                         │
│  │     │  ├─ Select: Symbol                                    │
│  │     │  ├─ Enter: Target Price                               │
│  │     │  └─ Condition: ABOVE/BELOW                            │
│  │     │                                                        │
│  │     ├─ Complex Alert:                                       │
│  │     │  ├─ Choose: All or Whitelist                          │
│  │     │  ├─ If whitelist: Add coins                           │
│  │     │  ├─ Enter: % threshold                                │
│  │     │  └─ Timeframe: 1 minute (fixed)                       │
│  │     │                                                        │
│  │     └─ [Create Alert] or [Back]                             │
│  │                                                              │
│  │     Result: Alert added to table (ACTIVE)                   │
│  │     └─ Refresh in <30s                                      │
│  │                                                              │
│  │  Option B: EDIT EXISTING                                    │
│  │  └─ Find alert in table                                     │
│  │     └─ Click [✏️ pencil icon]                               │
│  │        ├─ Modal opens with pre-filled data                 │
│  │        ├─ Edit allowed fields                               │
│  │        │  (Price Alert: name only)                          │
│  │        │  (Complex: name, coins, %)                         │
│  │        └─ [Update Alert] or [Cancel]                        │
│  │                                                              │
│  │  Option C: DELETE                                           │
│  │  └─ Find alert → Click [🗑️ trash icon]                     │
│  │     └─ Confirm deletion                                     │
│  │        -> Alert removed from table                          │
│  │        -> Deleted from database                             │
│  │                                                              │
│  │  Option D: BULK DELETE                                      │
│  │  └─ Check ☑️ multiple alerts                                │
│  │     └─ Click [DELETE SELECTED]                              │
│  │        └─ Confirm → All removed                             │
│  │                                                              │
│  │  Option E: TOGGLE ON/OFF                                    │
│  │  └─ Find alert → Click status toggle                        │
│  │     ├─ ⚫ (ON) → Alert monitoring                            │
│  │     └─ → (OFF) → Alert paused                               │
│  │                                                              │
│  │  Option F: FILTER                                           │
│  │  └─ Click [FILTER]                                          │
│  │     ├─ Select: Status (Active/Triggered/Inactive)           │
│  │     ├─ Select: Exchange                                     │
│  │     ├─ Select: Market                                       │
│  │     ├─ Select: Type (Price/Complex)                         │
│  │     └─ Table updates instantly                              │
│  │                                                              │
│  └─ Continuous Updates:                                        │
│     ├─ WebSocket: Real-time trigger notifications              │
│     ├─ Auto-refresh: Every 30 seconds                           │
│     ├─ On tab visibility: Immediate refresh                    │
│     └─ Manual: F5 to refresh                                   │
│                                                                  │
│  Exit: User navigates away or closes browser                    │
│  └─ Alerts continue monitoring in background                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Alert Types Decision Tree

```
                    WHICH ALERT TYPE?
                           │
                ┌──────────┴──────────┐
                │                     │
          I WANT TO         I WANT TO WATCH
          WATCH 1 COIN       MANY COINS
                │                     │
                │                     │
          PRICE ALERT        COMPLEX ALERT
                │                     │
                ├─ Symbol             ├─ Scope:
                ├─ Target Price       │  ├─ All coins ✓
                ├─ Condition          │  └─ Specific list
                │  ├─ ABOVE           │
                │  └─ BELOW           ├─ Movement %
                │                     │  (5%, 10%, 15%)
                ├─ When fires:        │
                │  ├─ Once at cross   ├─ Timeframe:
                │  └─ Can fire again  │  └─ Always 1 minute
                │
                ├─ Best for:          └─ When fires:
                │  ├─ Long targets       ├─ Any coin moves
                │  ├─ Set & forget       └─ Multiple times
                │  └─ Major milestones
                                       └─ Best for:
                                          ├─ Quick trades
                                          ├─ Finding gaps
                                          └─ Real-time scanning
```

---

## Engine Performance Monitor

```
┌───────────────────────────────────────────────────────┐
│         ALERT ENGINE PERFORMANCE SNAPSHOT              │
├───────────────────────────────────────────────────────┤
│                                                        │
│  PRICE ALERT ENGINE                                  │
│  ├─ Active price alerts: 234                         │
│  ├─ Unique symbols monitored: 456                    │
│  ├─ Check frequency: Every price tick (1-5s)         │
│  ├─ Trigger latency: 1-3 seconds                     │
│  ├─ CPU usage: 3-5%                                  │
│  └─ Memory: ~50MB                                    │
│                                                        │
│  COMPLEX ALERT ENGINE                                │
│  ├─ Active complex alerts: 78                        │
│  ├─ Cache refresh: Every 30 seconds                  │
│  ├─ Symbols checked: 2000+                           │
│  ├─ Poll frequency: Every 300ms                      │
│  ├─ Trigger latency: 1-5 seconds                     │
│  ├─ CPU usage: 5-7%                                  │
│  └─ Memory: ~100MB                                   │
│                                                        │
│  OVERALL SYSTEM                                       │
│  ├─ Total alerts: 312                                │
│  ├─ Triggered today: 45                              │
│  ├─ Database queries/minute: 120                     │
│  ├─ WebSocket connections: 89                        │
│  ├─ Uptime: 99.98%                                   │
│  └─ Average notification delay: 2.3s                 │
│                                                        │
└───────────────────────────────────────────────────────┘
```

