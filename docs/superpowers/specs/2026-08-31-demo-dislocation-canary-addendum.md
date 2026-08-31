# DEMO Market Dislocation Canary Addendum

**Status:** Complete  
**Created:** 2026-08-31  
**Parent design:** `2026-08-28-platform-stabilization-design.md`

## Problem Statement

The 2026-08-30 and partial 2026-08-31 runtime audit found healthy pipeline and
event-scanner scheduling but no Risk assessments or orders. Fresh EVENT runs
correctly identified large directional moves, including the 2026-08-31 selloff,
then failed several correlated historical gates before reaching Risk. Globally
lowering those gates was rejected because the complete blocked-signal population
had negative or approximately flat one-hour expectancy.

## Corrective Scope

Add a narrow DEMO-only route for a confirmed market dislocation. The route may
make historical calibration, expected-value, profit-factor, and the specific
quant `WALK_FORWARD_UNSTABLE` or `PROBABILITY_TOO_LOW` outcomes advisory. It may
not bypass realtime market structure, freshness, conflict, execution, or Risk.

A candidate qualifies only when all of the following hold:

- the run was triggered by a persisted EVENT scan in DEMO mode;
- the event direction matches LONG or SHORT and has at least two scanner
  confirmations;
- the scanner evidence is no more than ten minutes old;
- the same event contains both a rolling-high/rolling-low breakout and a
  direction-aligned ATR impulse;
- decision confidence is at least 74, opportunity score at least 70, risk score
  below 80, and volatility adjustment above -30;
- core data quality is GOOD, conflict is LOW, directional agreement is at least
  80, evidence coverage is at least 60, and multi-timeframe confirmation is at
  least 80;
- regime is not HIGH_VOLATILITY, RSI is not in the anti-chase extreme, expected
  reward/loss is at least 1.5, and neutral-prior payoff remains positive.

An ATR impulse without a rolling boundary break is ordinary momentum and does
not qualify as a dislocation. This distinction was added after the first replay
showed that an impulse-only route overtraded and had profit factor below 1.

## Execution and Safety Contract

- Position sizing is capped at `0.10` of the normal Risk-approved size.
- A submitted canary starts a 60-minute cooldown per user, symbol, and direction.
- The existing distributed execution lock remains in force.
- Spread, stale-data, multi-timeframe conflict, extreme-volatility, anti-chase,
  exposure, collateral, position, drawdown, stop-loss, take-profit, instrument,
  and exchange checks remain hard gates.
- Advisory and blocking reasons are persisted separately for auditability.
- LIVE remains fail-closed. This addendum does not approve or promote any LIVE
  strategy version.

## Counterfactual Replay

Snapshot time: `2026-08-31T05:56:30.646Z` (`12:56:30` Asia/Ho_Chi_Minh).

The replay used the built policy implementation, persisted EVENT evidence,
persisted candidate/Judge reasons, persisted multi-timeframe confirmation, and
provenance-eligible `MID` performance records. `MID` measures the directional
return after 60 minutes and deducts the configured 0.1% round-trip cost. The
60-minute canary cooldown was then applied chronologically.

| Scope | EVENT runs | Raw eligible | After cooldown | Wins | Win rate | Average net return | Summed net return |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-08-30 | — | — | 10 | 6 | 60.00% | +0.1103% | +1.1028% |
| 2026-08-31 partial | — | — | 4 | 3 | 75.00% | +0.1718% | +0.6872% |
| Combined | 346 | 28 | 14 | 9 | 64.29% | +0.1279% | +1.7900% |

Combined profit factor was `1.7652`. At the enforced 0.10 size factor, the
simple summed return contribution was `+0.1790%` and maximum sequential
drawdown was `0.1274%` before portfolio interactions.

During the material 2026-08-31 decline, the corrected route would have sent
BTC-USDT, BNB-USDT, and SOL-USDT SHORT candidates to Risk at approximately
06:18 Asia/Ho_Chi_Minh. Their respective one-hour net returns were `+0.3859%`,
`+0.7245%`, and `+0.8507%`.

## Interpretation Limits

This is a counterfactual gate replay, not proof of exchange fills or LIVE edge.
The 14 candidates are opportunities that could reach the existing Risk boundary;
Risk may still reject them because of collateral, exposure, current positions,
drawdown, price drift, spread, or instrument constraints. The replay uses a
fixed one-hour evaluation horizon rather than reconstructing intrabar stop-loss
and take-profit execution. Two days and 14 observations are insufficient for
LIVE promotion and do not replace the parent design's minimum sample and
approval requirements.

## Verification Evidence

- Focused policy/runtime suite: 2 files, 41 tests passed.
- Safety regressions cover DEMO-only routing, LIVE fail-closed behavior,
  direction mismatch, impulse without breakout, 0.10 sizing, historical reasons
  as advisory, unexplained gate failures remaining fail-closed, and the
  60-minute cooldown.
- Repository lint and typecheck passed.
- Repository tests passed: 663 API tests, 37 web tests, and 6 shared-package
  tests. Six opt-in API integration/E2E tests remained skipped by the default
  test command and two API tests remained explicitly marked todo.
- API build passed and the web production build generated all 48 pages.
