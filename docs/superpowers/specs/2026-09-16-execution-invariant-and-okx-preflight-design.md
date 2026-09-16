# Execution Invariant and OKX Preflight Design

## Problem

Production runs after the previous deployment generated directional candidates but no fills. Some candidates were marked actionable while their execution context still declared `action: WAIT`, `triggerConfirmed: false`, and `usesClosedPrimaryCandle: false`. One ZRO short produced a resting limit that expired without a fill; one ZRO long was rejected by OKX because its attached protection was invalid in the live price context. Independent confidence, judge, quant, and risk gates also blocked the same candidate for overlapping manifestations of missing execution evidence.

The goal is not to increase trade count unconditionally. The goal is to make every executable decision internally consistent, exchange-valid, and attributable to one owning gate, while retaining hard safety controls.

## Invariants

An automatic entry is executable only when all of these are true:

1. The directional decision is `LONG` or `SHORT`.
2. `executionContext.action` is `ENTER` or `PROBE`.
3. `executionContext.triggerConfirmed` is `true`.
4. `executionContext.usesClosedPrimaryCandle` is `true`.
5. `sourceDataCutoff` matches the primary closed-candle cutoff used by technical analysis.
6. Required price-location fields for the selected setup are present and pass `validateSetupLocation`.
7. Entry, stop loss, and take profit remain valid against a fresh ticker after tick-size normalization.

Violation of an invariant produces one explicit blocking reason. It cannot be promoted to actionable by calibration, quant fallback, judge approval, or risk sizing.

## Architecture

### 1. Single execution-readiness policy

Add a pure domain policy that consumes the final calibrated decision and returns either an executable context or a typed rejection. The pipeline invokes it after strategy calibration and before Judge/Quant/Risk. Gate records identify this as `EXECUTION_READINESS`, making it the sole owner of closed-candle, trigger, and setup-location failures.

Decision synthesis may still emit a directional forecast with a waiting context. Such a forecast remains useful for evaluation and opportunity watching, but is never called actionable and never reaches live order creation.

### 2. Closed-candle execution context

Build execution context from the same pinned indicator snapshot and closed candle used by fusion. Populate price, ATR, setup-specific boundary/trigger distances, and primary-candle provenance. A trigger is confirmed only by deterministic setup rules:

- `RANGE_REVERSION`: price is at the correct range boundary and a closed-candle rejection exists.
- `TREND_PULLBACK`: trend alignment holds and a closed candle rejects the relevant EMA/support/resistance zone.
- `BREAKOUT_RETEST`: a closed breakout is followed by a valid retest within chase limits.
- `MOMENTUM_CONTINUATION`: closed-candle impulse, volume, ADX, and multi-timeframe direction agree.
- `TRANSITION_PROBE`: explicit dislocation canary conditions pass; size remains reduced.

No LLM output can set these execution facts.

### 3. Gate ownership

- Signal filter owns signal strength, data quality, and minimum opportunity score.
- Execution readiness owns trigger, closed candle, setup, geometry, and chase distance.
- Judge owns contradictory evidence and exceptional market/news risk.
- Quant owns empirical expectancy only when the evidence cohort is applicable.
- Risk owns account exposure, leverage, drawdown, stop distance, and position sizing.
- Exchange preflight owns provider constraints and current-price validity.

`NEW_COHORT`, `QUANT_NOT_APPLICABLE`, and global fallback are advisory in DEMO and may authorize a reduced-size probe only after execution readiness passes. Exact cohorts with reliable negative expectancy remain hard blocks.

### 4. Setup-aware entry policy

- Range reversal and ordinary trend pullback use resting GTC limits with a bounded candle TTL.
- Confirmed breakout and momentum continuation use a marketable IOC limit derived from the fresh best bid/ask plus a maximum slippage allowance.
- IOC orders never fall back to MARKET.
- Expired GTC orders may be reassessed once using fresh data. Repricing requires the same execution invariant and acceptable reward-to-risk; otherwise the order is canceled.

This prevents a momentum entry from waiting above or below the market until the move is over while retaining bounded execution cost.

### 5. Provider-neutral protection preflight

Add a pure protection validator before adapter submission. It normalizes all prices to instrument tick size and verifies:

- LONG: stop < entry < take profit.
- SHORT: take profit < entry < stop.
- A stop is not already breached by the current executable price.
- A take profit is not already crossed.
- A marketable limit remains inside the configured slippage bound.

Invalid protection rejects locally with a stable reason and stores normalized inputs. OKX receives only validated values. Provider-specific formatting stays inside the adapter.

## Data Flow

1. Load candles, indicator snapshot, ticker, book, and instrument metadata.
2. Pin technical/market analysis to one closed-candle cutoff.
3. Produce directional strategy forecasts.
4. Calibrate each forecast without changing execution facts.
5. Derive and validate deterministic execution readiness.
6. Apply Judge and applicable Quant evidence.
7. Select the first candidate passing all owned gates.
8. Build the setup-aware trade plan and risk assessment.
9. Refresh ticker/book and run protection preflight.
10. Submit, reconcile, fill, expire, or cancel with explicit provenance.

## Failure Handling and Observability

Every run stores raw direction, calibrated direction, execution-readiness result, each gate owner, selected blocking reason, normalized order geometry, and exchange acknowledgement. Exchange rejection never replaces the local root cause. Alerts fire for provider rejection, repeated TTL expiry, directional candidates with zero execution-ready candidates, and stale/mismatched cutoffs.

Missed-opportunity evaluation remains retrospective and cannot bypass a live gate. It reports MFE, MAE, and net hypothetical R after 1h/4h for blocked candidates.

## Tests and Acceptance Criteria

Regression fixtures reproduce the observed production cases:

- A directional candidate with `WAIT`/unconfirmed/open-candle context is not actionable.
- A valid closed-candle trigger becomes executable without weakening unrelated gates.
- The ZRO resting short retains GTC semantics and deterministic expiry.
- The ZRO long geometry is rejected locally before an OKX call when the stop is already invalid relative to the current market.
- Momentum/breakout uses bounded IOC; range/pullback uses GTC.
- Missing/global quant evidence produces only a reduced probe in DEMO, never unrestricted live authorization.
- Exact reliable negative expectancy remains blocked.
- SOL, BNB, ARB, ZEC, and ZRO replay fixtures exercise the same symbol-neutral code.

Completion requires targeted red-green regression tests, the full API test suite, lint, typecheck, build, and a clean worktree after commit. Push is to the existing `fix/strategy-signal-and-limit-ttl` branch. A code push is not described as deployed or production-verified.

## Non-goals

- Guaranteeing a trade or profitable outcome.
- Removing drawdown, exposure, or exchange safety limits.
- Automatically changing production configuration or deploying code.
- Using future candles in replay or live decisions.
