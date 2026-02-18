# Deleted Files – Restore Backup

**Date:** 2025-02-10  
**Reason:** Remove unused plan/task docs; keep main plan (README) only.

If something breaks and you need to bring a file back, restore its content from below.

---

## 1. COMPLEX_ALERT_FIX_AGENT_TASKS.md (DELETED)

**Full path:** `c:\Users\admin\Desktop\crypto-exchange-alerts\COMPLEX_ALERT_FIX_AGENT_TASKS.md`

**To restore:** Create a new file at that path and paste the content between the markers below.

<!-- BEGIN COMPLEX_ALERT_FIX_AGENT_TASKS.md -->

# Complex Alert Fix - Agent Tasks

## Overview

This document contains specific tasks for each agent type (Backend, Frontend, UI, Database) to fix complex alerts so they trigger instantly and remain active after triggering.

**Reference**: See `COMPLEX_ALERT_FIX_PLAN.md` for detailed architecture and logic.

---

## Backend Agent Tasks

### Task B1: Fix Alert Engine Query to Include Triggered Complex Alerts

**File**: `server/src/services/alertEngine.js`

**Location**: Line ~132 in `checkAlerts()` function

**Current Code**:
```javascript
const activeAlerts = await prisma.alert.findMany({
  where: { isActive: true, triggered: false },
});
```

**Required Change**:
```javascript
const activeAlerts = await prisma.alert.findMany({
  where: {
    isActive: true,
    OR: [
      { triggered: false }, // All non-triggered alerts
      { alertType: 'complex', triggered: true } // Triggered complex alerts (they stay active)
    ]
  },
});
```

**Why**: Complex alerts should continue to be checked after triggering, so they can trigger multiple times.

**Validation**: After change, triggered complex alerts should appear in `activeAlerts` array.

---

### Task B2: Fix Complex Alert Trigger Logic - Keep Active

**File**: `server/src/services/alertEngine.js`

**Location**: Line ~328-335 in `checkAlerts()` function, complex alert trigger section

**Current Code**:
```javascript
const updatedAlert = await prisma.alert.update({
  where: { id: alert.id },
  data: {
    triggered: true,
    triggeredAt: new Date(),
    isActive: false, // ❌ WRONG - deactivates complex alerts
  },
});
```

**Required Change**:
```javascript
const updatedAlert = await prisma.alert.update({
  where: { id: alert.id },
  data: {
    triggered: true,
    triggeredAt: new Date(),
    // DO NOT set isActive: false - complex alerts stay active
  },
});
```

**Why**: User requirement states complex alerts should NOT self-destroy after trigger.

**Validation**: After trigger, complex alert should have `triggered: true` but `isActive: true`.

---

### Task B3: Fix Start Price Cleanup on Trigger

**File**: `server/src/services/alertEngine.js`

**Location**: Line ~337-338 in `checkAlerts()` function, after complex alert trigger

**Current Code**:
```javascript
// Clean up start prices for this alert (it's now triggered)
cleanupComplexAlertPrices(alert.id);
```

**Required Change**: Keep the cleanup call, but add comment explaining why:
```javascript
// Reset start prices so they initialize fresh on next check cycle
// This allows the alert to trigger again in the next candle period
cleanupComplexAlertPrices(alert.id);
```

**Why**: We need to clear start prices so they reset for the new period, allowing the alert to trigger again. The cleanup is correct, but the comment should clarify it's for reset, not permanent deletion.

**Note**: The `cleanupComplexAlertPrices` function is correct - it clears the in-memory tracking. On the next check cycle, `getOrSetStartPrice` will initialize new start prices for the new period.

**Validation**: After trigger, start prices should be cleared. On next check (new period), new start prices should be set.

---

### Task B4: Speed Up Alert Engine Check Interval

**File**: `server/src/services/alertEngine.js`

**Location**: Line ~367 in `startAlertEngine()` function

**Current Code**:
```javascript
cron.schedule('*/10 * * * * *', () => checkAlerts());
console.log('Alert engine started (checking every 10 seconds)');
```

**Required Change**:
```javascript
cron.schedule('*/2 * * * * *', () => checkAlerts());
console.log('Alert engine started (checking every 2 seconds)');
```

**Why**: 2 seconds provides "instant" triggering feel. 10 seconds is too slow.

**Validation**: Alert engine should check every 2 seconds (verify in logs).

---

### Task B5: Improve Condition Value Parsing

**File**: `server/src/services/alertEngine.js`

**Location**: Line ~287-290 in `checkAlerts()` function, complex alert condition parsing

**Current Code**:
```javascript
const threshold = Math.abs(Number(cond.value));
if (!Number.isFinite(threshold) || threshold <= 0) continue;
```

**Required Change**: Add more robust parsing:
```javascript
// Parse condition value - handle string numbers from form
const condValue = typeof cond.value === 'string' ? parseFloat(cond.value) : cond.value;
const threshold = Math.abs(Number(condValue));
if (!Number.isFinite(threshold) || threshold <= 0) {
  console.warn(`Complex alert ${alert.id} invalid condition value: ${cond.value}`);
  continue;
}
```

**Why**: Frontend may send condition values as strings. Need to parse them properly.

**Validation**: Test with condition values as strings (e.g., "3" instead of 3).

---

### Task B6: Add Logging for Complex Alert Triggers

**File**: `server/src/services/alertEngine.js`

**Location**: Line ~352-353, after emitting socket event

**Current Code**:
```javascript
console.log(`Complex alert ${alert.id} triggered for user ${updatedAlert.userId} (${triggerSymbol}: ${triggerPctChange.toFixed(2)}%)`);
```

**Required Change**: Enhance logging:
```javascript
console.log(`[Complex Alert Triggered] ID: ${alert.id}, User: ${updatedAlert.userId}, Symbol: ${triggerSymbol}, Change: ${triggerPctChange.toFixed(2)}%, Threshold: ${threshold}%, Timeframe: ${timeframe}, Alert stays active: true`);
```

**Why**: Better debugging and monitoring of complex alert triggers.

**Validation**: Check logs after trigger - should show detailed information.

---

## Frontend Agent Tasks

### Task F1: Verify Complex Alerts Not Removed from Store

**File**: `client/src/App.jsx`

**Location**: Line ~41-44 in `useSocket` hook, `onAlertTriggered` callback

**Current Code**:
```javascript
// Auto-remove price alerts from store since they're deleted on backend
if (alertData.alertType === 'price' && alertData.id) {
  removeAlert(alertData.id);
}
```

**Required Change**: Verify this is correct - complex alerts should NOT be removed. Current code is correct, but add comment:
```javascript
// Auto-remove price alerts from store since they're deleted on backend
// Complex alerts stay in store - they remain active after trigger
if (alertData.alertType === 'price' && alertData.id) {
  removeAlert(alertData.id);
}
```

**Why**: Clarify that complex alerts are intentionally kept in store.

**Validation**: When complex alert triggers, it should remain in the alerts list.

---

### Task F2: Verify Alert Store Updates Triggered Complex Alerts

**File**: `client/src/store/alertStore.js`

**Location**: `addOrUpdateAlert` function (if exists) or socket handler

**Action**: Ensure that when a complex alert triggers, the store updates the alert's `triggered` and `triggeredAt` fields, but keeps `isActive: true`.

**Current Behavior**: Check if `addOrUpdateAlert` or socket handler properly updates triggered alerts.

**Required Change**: If not already correct, ensure triggered complex alerts are updated in store with:
- `triggered: true`
- `triggeredAt: <timestamp>`
- `isActive: true` (should remain true)

**Validation**: After complex alert triggers, check store - alert should show as triggered but still active.

---

### Task F3: Verify Alert List Displays Triggered Complex Alerts

**File**: `client/src/pages/Alerts.jsx`

**Location**: Alert rendering logic

**Action**: Verify that triggered complex alerts are displayed correctly in the list.

**Required Behavior**:
- Triggered complex alerts should show in the list
- Should display "Triggered" status/badge
- Should still show toggle button (can be manually deactivated)
- Should NOT be filtered out

**Validation**: Create complex alert, trigger it, verify it appears in list with triggered status.

---

## UI Agent Tasks

### Task U1: Verify Triggered Complex Alert Display

**File**: `client/src/components/alerts/AlertsTable.jsx`

**Location**: Alert row rendering, status display

**Action**: Ensure triggered complex alerts display correctly:
- Show "Triggered" badge/indicator
- Show trigger timestamp
- Show which symbol triggered and percentage change
- Toggle button should still be functional (can deactivate)

**Current Behavior**: Check if triggered alerts are displayed correctly.

**Required Change**: If not already correct, add UI elements to show:
- Triggered status badge
- Trigger time
- Trigger details (symbol, percentage)

**Validation**: Visual inspection - triggered complex alert should be clearly marked but still interactive.

---

### Task U2: Verify Alert Modal Shows Triggered Status

**File**: `client/src/components/alerts/AlertTriggeredModal.jsx` (if exists)

**Location**: Modal content rendering

**Action**: If alert triggered modal exists, verify it shows correct information for complex alerts:
- Alert name
- Symbol that triggered
- Percentage change
- Direction (up/down)
- Note that alert remains active

**Validation**: When complex alert triggers, modal should show correct information.

---

## Database Agent Tasks

### Task D1: Verify Schema Supports Requirements

**File**: `server/prisma/schema.prisma`

**Location**: Alert model definition

**Current Schema**:
```prisma
model Alert {
  id                   String    @id @default(uuid())
  userId               String
  alertType            String    @default("price")    // "price" | "complex"
  triggered            Boolean   @default(false)
  isActive             Boolean   @default(true)
  triggeredAt          DateTime?
  // ... other fields
}
```

**Required Verification**: 
- Schema allows `triggered: true` AND `isActive: true` simultaneously ✅ (already correct)
- No constraints prevent this combination ✅ (already correct)

**Action**: Verify schema is correct - no changes needed.

**Verification Results**:
- ✅ Schema analysis: Both `triggered` and `isActive` are independent `Boolean` fields in the Alert model
- ✅ Database level: Both columns are `BOOLEAN NOT NULL` with no CHECK constraints or other constraints preventing simultaneous `true` values
- ✅ Migration check: No constraints found in any migration files that would prevent `triggered: true` AND `isActive: true`
- ✅ Schema location: `server/prisma/schema.prisma` lines 48-49 show:
  ```prisma
  isActive             Boolean   @default(true)
  triggered            Boolean   @default(false)
  ```
  Both fields are independent with no mutual constraints

**Conclusion**: Schema fully supports complex alerts remaining active (`isActive: true`) after triggering (`triggered: true`). No schema changes required.

**Validation**: Schema allows creating/updating alerts with `triggered: true` and `isActive: true` simultaneously. Backend can implement the query logic to include triggered complex alerts in active checks.

---

### Task D2: Verify Query Performance

**File**: `server/src/services/alertEngine.js`

**Location**: Alert query (Task B1)

**Action**: After implementing Task B1, verify query performance:
- Query should efficiently fetch active alerts including triggered complex alerts
- Should use appropriate indexes (if any)

**Current Indexes**: Check if `isActive` and `triggered` fields have indexes.

**Verification Results**:
- ✅ Query analysis: The alert engine query (lines 167-175 in `alertEngine.js`) filters by:
  ```javascript
  where: {
    isActive: true,
    OR: [
      { triggered: false }, // All non-triggered alerts
      { alertType: 'complex', triggered: true } // Triggered complex alerts
    ]
  }
  ```
- ✅ Index check: No indexes existed on Alert table for these fields
- ✅ Performance optimization: Added composite index `@@index([isActive, triggered, alertType])` to schema
- ✅ Migration created: `20260210113646_add_alert_performance_index` - creates index on Alert table
- ✅ Index benefits: SQLite can efficiently use this composite index for the WHERE clause pattern, especially as alert count grows

**Index Added**:
```prisma
@@index([isActive, triggered, alertType])
```

**Validation**: Query should execute quickly even with many alerts. The composite index optimizes the common query pattern used by the alert engine (runs every 2 seconds).

---

## Testing Tasks (All Agents)

### Task T1: Basic Trigger Test

**Steps**:
1. Create complex alert: 3% move in 1m for BTCUSDT
2. Monitor alert engine logs
3. Wait for BTCUSDT price to move 3%+ (or simulate)
4. Verify: Alert triggers within 2-4 seconds
5. Verify: Alert remains in list, `isActive: true`, `triggered: true`

**Expected Result**: Alert triggers instantly and stays active.

---

### Task T2: Multiple Triggers Test

**Steps**:
1. Create complex alert: 2% move in 1m for BTCUSDT
2. Trigger alert (price moves 2%+)
3. Wait for new minute period (e.g., 10:30 → 10:31)
4. Price moves 2%+ again in new period
5. Verify: Alert triggers again

**Expected Result**: Alert can trigger multiple times across different periods.

---

### Task T3: Large List Performance Test

**Steps**:
1. Create complex alert with 500 tokens
2. Monitor alert engine performance
3. Verify: Price fetching is batched (one call per market)
4. Verify: Check cycle completes in reasonable time (< 5 seconds)

**Expected Result**: Performance is acceptable with large token lists.

---

### Task T4: Period Transition Test

**Steps**:
1. Create alert: 5% move in 1m
2. Trigger at 10:30:45 (during minute)
3. Wait for 10:31:00 (new minute starts)
4. Verify: Start prices reset
5. Verify: Alert can trigger again in new period

**Expected Result**: Period transitions handled correctly.

---

### Task T5: Direction Test

**Steps**:
1. Create alert: 3% move in 1m
2. Price goes UP 3%+ → verify triggers
3. Reset alert (or wait for new period)
4. Price goes DOWN 3%+ → verify triggers

**Expected Result**: Both up and down movements trigger alert.

---

## Implementation Order

1. **Backend Tasks First** (B1-B6): Fix core logic
2. **Frontend Tasks** (F1-F3): Verify frontend handles correctly
3. **UI Tasks** (U1-U2): Ensure UI displays correctly
4. **Database Tasks** (D1-D2): Verify schema and performance
5. **Testing Tasks** (T1-T5): Comprehensive testing

---

## Success Criteria

✅ Complex alerts trigger instantly (within 2-4 seconds of price movement)
✅ Complex alerts remain active after trigger (`isActive: true`)
✅ Complex alerts can trigger multiple times
✅ Large token lists (500+) perform well
✅ Period transitions handled correctly
✅ Both up and down movements trigger alerts
✅ Frontend displays triggered complex alerts correctly
✅ Users can manually deactivate triggered complex alerts

<!-- END COMPLEX_ALERT_FIX_AGENT_TASKS.md -->

---

## Summary

| Deleted file | Restore from |
|-------------|--------------|
| `COMPLEX_ALERT_FIX_AGENT_TASKS.md` | Content between markers above |

**Kept:** `README.md` (main plan / project readme). No code or config files were removed.
