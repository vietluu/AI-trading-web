# Probe Economics Live-Readiness Report

Date: 2026-10-02 (Asia/Ho_Chi_Minh)

Tested commit: `f648e49`

## Executive decision

| Mode | Decision | Evidence |
| --- | --- | --- |
| SHADOW | READY | Full API unit/in-process integration suite, production build, typecheck, and lint pass. The real Risk and Judge services accept only bounded cold-start probes while retaining non-economic safety gates. |
| DEMO | NOT READY | HTTP integration and E2E evidence is unavailable because no API was reachable on port 3001 and `DATABASE_URL` was not configured. |
| LIVE | NOT READY | DEMO evidence is incomplete, exchange/testnet execution was not demonstrated in this verification, and no forward PnL sample proves profitability. |

This change fixes an evidence-collection deadlock. It does not prove or guarantee optimal PnL.

## Root cause and correction

An immature proactive thesis cohort previously emitted placeholder economics (`EV=0`, `PF=1`, win probability `0.5`). Risk and Judge interpreted those placeholders as authoritative poor economics and rejected the trade before the lifecycle reducer could apply `PROBE_ONLY`. As a result, the system could not gather the evidence needed to mature the cohort.

The correction introduces explicit economics authority on decisions:

- `EXACT_LIFECYCLE`: exact-cohort empirical probability owns execution economics.
- `UNAVAILABLE`: no empirical win probability is invented; a lifecycle-approved probe may pass only as bounded `PROBE_ONLY`.
- `SUPPRESSED`: remains explicitly blocked.

Calibration can no longer overwrite exact lifecycle economics with a broader calibration cohort. Critic loss history is now isolated by the exact symbol/provider/timeframe/regime/direction/setup/configuration hash. Terminal critic outcomes retain thesis attribution for auditability.

## Safety properties retained

- Only the empirical placeholder economics checks are bypassed for `UNAVAILABLE + PROBE_ONLY`.
- Stale data, spread, stop geometry, reward/loss geometry, exposure, and other Risk/Judge checks remain active.
- Probe size remains capped at `0.15` in the end-to-end regression test.
- `SUPPRESSED` lifecycle decisions fail closed.
- No fallback probability of `0.5` is presented as empirical evidence.
- Existing decisions without the new authority field keep legacy calibration behavior.

## Verification evidence

### Passed

- Targeted cross-module verification: 6 files, 160/160 tests passed.
- Full API suite: 206 files passed; 1,460 tests passed; 5 files skipped; 6 tests skipped; 2 todo.
- Production workspace build: passed for shared package, API, and web.
- Workspace typecheck: passed.
- Workspace lint: passed.
- Regression uses the real `DecisionRiskPolicyService` and `DecisionJudgeService`, then verifies assessment and bounded execution are reached for an immature cohort.

### Not proven in this environment

- `pnpm test:integration`: 3 files failed, 5 tests failed.
  - HTTP tests could not connect to `localhost:3001` (`fetch failed`, sandbox/local endpoint unavailable).
  - Prisma tests could not initialize because `DATABASE_URL` was absent.
- `pnpm test:e2e`: 1 file failed, 1 test failed because `localhost:3001` was unavailable.
- No live or testnet exchange order lifecycle was executed as part of this run.
- No statistically sufficient forward cohort exists to claim improved or optimal PnL.

These failures do not contradict the in-process regression result, but they prevent promotion to DEMO or LIVE.

## Required promotion gates

Before DEMO:

1. Start the API and its required database/Redis dependencies with an isolated test database.
2. Provide `DATABASE_URL` and all required test configuration.
3. Make `pnpm test:integration` and `pnpm test:e2e` pass without skips.
4. Run exchange testnet/demo order submission, acknowledgement, protective-order placement, reconciliation, and restart recovery.

Before LIVE:

1. Accumulate forward SHADOW/DEMO samples for each exact thesis cohort.
2. Require predeclared minimum sample size and confidence bounds; do not promote on raw win rate alone.
3. Validate net expectancy after fees, slippage, funding, and rejected/partial fills.
4. Enforce drawdown, daily-loss, kill-switch, stale-data, and reconciliation drills.
5. Promote only when out-of-sample profit factor/expectancy and drawdown limits meet the configured policy.

## Change set

- `232a8ac` model proactive economics authority explicitly.
- `2f7a7e5` allow bounded probes through empirical economics gates.
- `d78218b` preserve exact thesis economics through calibration.
- `e1ffede` isolate critic losses to the exact thesis cohort.
- `f648e49` unblock safe proactive evidence collection end to end.

