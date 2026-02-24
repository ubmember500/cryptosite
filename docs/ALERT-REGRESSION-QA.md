# ALERT Regression QA

## Scope

- Validate alert behavior only; no product logic rewrite.
- Confirm regression coverage for trigger direction, symbol handling, resilience, duplicate processing behavior, and latency expectation.

## Scenario Matrix

| ID | Scenario | Goal | Script / Mapping |
|---|---|---|---|
| AR-01 | Up-cross (below -> above threshold) | Alert triggers exactly once when price crosses upward | `node server/test-price-alert-crossing.js` |
| AR-02 | Down-cross (above -> below threshold) | Alert triggers exactly once when price crosses downward | `node server/test-price-alert-crossing.js` |
| AR-03 | Equal-at-create | No immediate false trigger when initial price equals threshold at create time; trigger only on valid crossing condition after updates | `node server/test-price-alert-crossing.js` |
| AR-04 | Symbol variants | Symbol canonicalization/resolution works for common variants (e.g., pair formatting differences) | `node server/test-price-resolver-live.js --mode=regression` |
| AR-05 | Unresolved symbol | Invalid/unresolvable symbol fails gracefully with explicit FAIL/skip reason and no crash | `node server/test-price-resolver-live.js --mode=regression` |
| AR-06 | Temporary exchange outage | Resolver path handles temporary upstream errors and recovers on next valid cycle | `node server/test-price-alert-live-sim.js --mode=regression` |
| AR-07 | Duplicate-processing simulation | Duplicate processing path does not produce duplicate trigger outcomes for one crossing event | `node server/test-price-alert-live-sim.js --mode=regression` |
| AR-08 | Latency expectation | Trigger is effectively instant on next observed price update after crossing condition is met | `node server/test-price-alert-live-sim.js --mode=regression` |

## Repro Commands & Expected Log Signatures

### 1) Crossing regression

Command:

```bash
node server/test-price-alert-crossing.js
```

Expected signatures:
- Scenario-level `PASS` lines for crossing conditions (up/down/equality/related checks).
- Final summary in script output indicates all checks passed and `failed=0`.

### 2) Resolver regression

Command:

```bash
node server/test-price-resolver-live.js --mode=regression
```

Expected signatures:
- `PASS` lines for symbol resolution and outage/retry handling checks.
- Final summary contains regression totals with `failed=0`.

### 3) Live-sim regression

Command:

```bash
node server/test-price-alert-live-sim.js --mode=regression
```

Expected signatures:
- `PASS` lines for duplicate-processing simulation and trigger timing checks.
- Final summary reports all regression cases passed and `failed=0`.

## Pass/Fail Interpretation

- **PASS run**: all scripted scenarios emit `PASS`, and final summary reports `failed=0`.
- **FAIL run**: any scenario emits `FAIL`, script exits non-zero, or final summary reports `failed>0`.
- **Inconclusive run**: infrastructure/runtime interruption (network outage, env misconfig, process killed) before summary; rerun after environment recovery.
- Do not modify product logic during QA execution; log evidence first, then escalate failures with command output attached.
