# Alert QA Report — 2026-02-24

## Summary

Final regression run status: **PASS** for all planned alert validation suites.

## Executed Commands and Outcomes

### 1) Crossing regression

Command:

```bash
node server/test-price-alert-crossing.js
```

Outcome:
- Passed: `11`
- Failed: `0`
- Result: PASS

### 2) Resolver regression

Command:

```bash
node server/test-price-resolver-live.js --mode=regression
```

Outcome:
- Passed: `5`
- Failed: `0`
- Result: PASS

### 3) Live-sim regression

Command:

```bash
node server/test-price-alert-live-sim.js --mode=regression
```

Outcome:
- Passed: `4`
- Failed: `0`
- Result: PASS

## Failed Cases

- None in final run.
- One earlier harness failure occurred before final run: missing module `priceAlertTrigger` in test script pathing/import context.
- Resolution: switched harness usage to `priceAlertEngine` test hooks, after which regression suites completed successfully.

## Root Causes and Resolutions

- Root cause (historical, now resolved): outdated/incorrect test harness dependency on `priceAlertTrigger` module reference.
- Resolution applied: aligned regression harness with `priceAlertEngine` test hook interface.
- Validation evidence: final command set above completed with zero failures.

## Go/No-Go Recommendation

**Recommendation: GO** for deployment gating based on final regression outcomes.

Note: run optional live probing commands in staging as a final runtime confidence check:

```bash
node server/test-price-resolver-live.js bybit futures BTCUSDT 8 1000
node server/test-price-alert-live-sim.js --mode=live bybit futures BTCUSDT
```
