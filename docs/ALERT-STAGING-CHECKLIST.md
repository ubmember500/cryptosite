# ALERT Staging Checklist

Ops-ready checklist for deployed stack:
- Client: Vercel
- API/worker: Render
- Database: Neon

## 1) Prerequisites

- [ ] Staging client points to staging API base URL.
- [ ] Render API and worker services are healthy and on expected release.
- [ ] Neon database is reachable from Render services.
- [ ] Required env vars for alert engine/worker are present.
- [ ] At least one test account can log in to staging client.

## 2) Smoke Checks

- [ ] Open staging client and verify app loads without blocking errors.
- [ ] Confirm authenticated API calls succeed (no global 5xx pattern).
- [ ] Verify worker/alert service is running (health/status/log heartbeat).
- [ ] Create and delete a test alert successfully.

## 3) Alert Create/Trigger Checks

- [ ] Create one up-cross alert and one down-cross alert for a liquid symbol (example: BTCUSDT).
- [ ] Confirm alerts persist in DB and appear in UI/API.
- [ ] Observe at least one real trigger event and verify alert status transition.
- [ ] Confirm only one notification/event per intended crossing.

## 4) Outage Recovery Check

- [ ] Simulate temporary exchange/API data interruption (or wait for transient upstream issue).
- [ ] Verify system logs recover automatically when feed returns.
- [ ] Confirm no permanent worker stall after recovery.
- [ ] Confirm alerts continue processing after recovery window.

## 5) Duplicate Trigger Check

- [ ] During volatile movement, verify a single crossing does not generate duplicate triggers.
- [ ] Confirm duplicate-processing protection remains effective after service restart.

## 6) Latency Check Definition

- Definition: trigger should occur on the next observed market update after crossing condition is met.
- [ ] Verify trigger timestamp aligns with first eligible post-cross update in logs.
- [ ] If delayed beyond normal feed interval, capture logs and mark as issue.

## 7) Rollback Criteria

Rollback is required if any of the following occurs:
- [ ] Reproducible duplicate triggers for one crossing event.
- [ ] Missed triggers in normal market conditions.
- [ ] Persistent outage recovery failure (worker does not resume processing).
- [ ] Regression command summary reports `failed>0` in staging validation.

If rollback criteria are met:
- [ ] Roll back to previous stable Render release.
- [ ] Re-verify smoke checks and critical alert flow.
- [ ] Attach incident notes and logs to release ticket.
