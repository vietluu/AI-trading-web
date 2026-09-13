# Adaptive Professional Entry Design

**Date:** 2026-09-13

**Status:** Approved direction; written specification pending final review

**Related design:** `docs/superpowers/specs/2026-09-09-proactive-ai-trading-design.md`

## Purpose

Make the trading system participate intelligently across ranging, transitional,
breakout, and trending markets without becoming either a permanent `WAIT`
machine or a late momentum chaser. The system must select an entry tactic from
market regime and price location, express the tactic as an executable thesis,
and preserve that intent through Risk and exchange execution.

The production ZRO-USDT trade opened at 2026-09-13 06:02 Asia/Ho_Chi_Minh is
the motivating failure. The pipeline classified the market as ranging, the
scenario called for a short after rejection at resistance, the risk plan changed
the setup to a downtrend pullback, and execution sold at market near the lower
boundary. The stop worked correctly; setup selection and entry location did not.

## Goals

- Trade ranging markets actively at validated boundaries.
- Detect and probe plausible regime transitions before lagging indicators fully
  confirm the move.
- Avoid entering after price has already traversed most of the expected move.
- Make AI produce a falsifiable, executable thesis rather than a narrative added
  after a deterministic decision.
- Make Judge challenge entry location, evidence quality, and contradictory
  regime assumptions.
- Use Quant evidence to choose normal size, probe size, or rejection according
  to relevance and maturity instead of applying a universal veto.
- Ensure order type, limit price, expiry, stop, and targets approved by Risk are
  the values sent to the exchange.
- Preserve deterministic loss limits and exchange protection.

## Non-goals

- Predict the exact first tick of every market move.
- Increase trade count by lowering every confidence or risk threshold.
- Guarantee profit or eliminate normal stopped trades.
- Allow AI to bypass account risk, exposure, leverage, drawdown, or mandatory
  protection controls.
- Promote a configuration to live trading based on the motivating trade alone.

## Core Principle

The system does not ask only, “Is direction bearish or bullish?” It asks:

1. What regime is active or emerging?
2. Where is price inside that regime's structure?
3. Which setup is valid at this location?
4. Has the favorable entry already passed?
5. What evidence invalidates the thesis?
6. Should the system wait, probe, or use normal risk?

Direction without location is not actionable.

## Regime Playbooks

### Ranging

- Long entries are permitted in the lower boundary zone after rejection,
  reclaim, or liquidity-sweep evidence.
- Short entries are permitted in the upper boundary zone under symmetric
  evidence.
- The middle 40% of the range remains a no-entry zone unless a transition or
  breakout setup is active.
- Targets favor the range midpoint first and opposite boundary second.
- A directional EMA alignment does not convert a range-boundary setup into a
  trend setup.

### Pre-breakout transition

- A small probe may be authorized when compression, liquidity displacement,
  volume expansion, derivatives evidence, and structural pressure form a
  coherent transition thesis.
- A probe uses 10–20% of normal risk and must have an explicit invalidation and
  expiry.
- The system can add only after the breakout or reclaim trigger is confirmed.
- Missing secondary data reduces size and confidence; it does not automatically
  force `WAIT` when core price/volume evidence is complete.

### Breakout

- Prefer breakout-and-retest or a bounded trigger order over an unbounded market
  chase.
- Reject an entry when distance from the breakout trigger exceeds the setup's
  maximum chase distance in ATR units or consumes too much planned reward.
- A breakout without acceptable post-cost reward-to-risk is not actionable.

### Trending

- Prefer pullbacks to a structural level, EMA zone, or reclaimed breakout level.
- A sequence of same-direction candles and lagging indicator agreement is
  context, not an entry trigger by itself.
- If the planned pullback price has not traded, keep or expire the limit order;
  do not silently replace it with a market order.

### Uncertain

- Use `WAIT` when no playbook has both a valid location and a falsifiable
  trigger. `WAIT` must include the next price/event condition that can make the
  setup actionable.

## Canonical Regime and Location Contract

The pipeline produces one canonical execution context consumed unchanged by
Decision, Judge, Risk, and Execution:

```ts
interface ExecutionContext {
  regime: 'RANGING' | 'PRE_BREAKOUT' | 'BREAKOUT' | 'TRENDING' | 'UNCERTAIN';
  regimeDetail: string;
  priceLocation: {
    rangePercentile?: number;
    distanceFromSupportAtr?: number;
    distanceFromResistanceAtr?: number;
    distanceFromTriggerAtr?: number;
  };
  setup: 'RANGE_REVERSION' | 'TRANSITION_PROBE' | 'BREAKOUT_RETEST' | 'TREND_PULLBACK';
  sourceDataCutoff: string;
  usesClosedPrimaryCandle: boolean;
}
```

Risk may reject or reduce a setup but may not silently replace its regime or
setup. A material change requires a new Decision and Judge review tied to the
same or newer source-data cutoff.

## Closed-candle and Early-entry Policy

- Normal-size entries require a closed primary timeframe candle for structural
  confirmation.
- Intrabar observations may create or update a `TRANSITION_PROBE`, but must be
  labeled intrabar and cannot receive normal size.
- Higher-frequency data may refine a trigger without pretending that the
  primary candle has closed.
- Every decision records the primary candle open/close timestamps and whether
  each feature came from a closed candle or a live observation.

This avoids treating a one-minute move inside a new 15-minute candle as a fully
confirmed regime change while retaining the ability to enter early with bounded
risk.

## AI Thesis Contract

Before an actionable order, the Decision Agent must return:

- canonical regime and setup;
- current price location and the levels used to calculate it;
- entry zone and trigger;
- evidence for and against;
- invalidation price and expiry;
- maximum chase distance;
- targets and post-cost expected R;
- action: `WAIT`, `PROBE`, or `ENTER`;
- a statement explaining why the entry is not late.

The structured thesis is validated deterministically. Narrative text cannot
override missing or inconsistent fields. If AI is unavailable, a rules fallback
must satisfy the identical contract and identify its decision source.

## Judge Responsibilities

Judge independently rejects or reduces a thesis when:

- setup and canonical regime are incompatible;
- entry location contradicts the playbook;
- the stated trigger has not occurred;
- the entry is beyond maximum chase distance;
- evidence against is omitted or materially stronger than evidence for;
- candle finality is misrepresented;
- planned reward after costs is insufficient.

Judge approval reason codes must describe passed checks. A reason such as
`VALID_EXACT_EVIDENCE` cannot by itself approve a contradictory entry.

## Quant Policy

Quant evidence is matched by symbol, setup, regime, direction, execution policy,
and configuration version.

- Mature, relevant, positive evidence permits normal risk.
- Immature or partially matched evidence permits probe risk only.
- Mature, relevant, materially negative evidence rejects the setup.
- Stale or assumption-mismatched validation cannot claim normal-size support.
- Global evidence may reduce size but cannot overrule strongly negative exact
  evidence.

Thresholds and minimum sample sizes remain configuration-owned and auditable.
The policy decision records the matched cohort and why it selected normal,
probe, or blocked risk.

## Risk and Execution Integrity

Risk validates the canonical setup rather than reclassifying it. It calculates
size from the approved risk tier and post-cost stop distance.

The approved execution plan is immutable input to exchange submission:

- `LIMIT` remains `LIMIT` with the approved price, time-in-force, and expiry.
- `MARKET` is allowed only when the approved plan explicitly requests it.
- A failed or expired limit returns to reassessment; it is not converted to
  market automatically.
- Submitted parameters and exchange acknowledgements are compared with the
  approved plan and persisted for audit.
- Existing mandatory native stop-loss/take-profit protection remains in force.

## Decision Flow

```text
Closed candles + intrabar observations + external evidence
    -> canonical regime and price location
    -> playbook candidates
    -> AI thesis (WAIT / PROBE / ENTER)
    -> deterministic schema and location validation
    -> Judge challenge
    -> cohort-matched Quant sizing policy
    -> deterministic account Risk limits
    -> immutable execution plan
    -> exchange submission and parameter reconciliation
    -> lifecycle outcome and learning
```

## ZRO Acceptance Scenario

Given the ZRO snapshot used at 2026-09-13 06:01 Asia/Ho_Chi_Minh:

- canonical regime is `RANGING`;
- observed range is approximately 1.0151–1.0245;
- proposed short price is 1.0171, near the lower boundary;
- no confirmed downside breakout-and-retest exists;
- the scenario asks for rejection at resistance.

The system must not submit a normal market short. Valid outcomes are:

1. `WAIT` with a short entry zone near resistance;
2. an expiring short limit inside that approved resistance entry zone; or
3. a small transition probe only after an explicit breakdown trigger, with
   evidence and sizing satisfying the transition policy.

## Testing Strategy

- Unit tests for price-location calculation and every regime/setup combination.
- Regression test reproducing the ZRO snapshot and proving that a normal market
  short near range support is rejected.
- Tests proving an eligible range-boundary trade remains actionable so the fix
  does not create a permanent `WAIT` system.
- Tests distinguishing closed-candle normal entries from intrabar probes.
- Judge tests for regime/setup contradiction and late-entry rejection.
- Quant tests for exact-negative, immature, fallback, and positive cohorts.
- Integration tests proving a Risk-approved limit plan reaches the exchange
  adapter unchanged and expiry triggers reassessment rather than market chase.
- Replay metrics comparing trade frequency, expectancy after costs, range
  participation, chase rate, and maximum drawdown against the current policy.

## Observability and Rollout

Each candidate records regime, setup, location, candle finality, action, Judge
verdict, Quant cohort, risk tier, approved order parameters, submitted order
parameters, and final lifecycle outcome.

Rollout sequence:

1. Replay the existing production evidence without placing orders.
2. Run shadow mode alongside the current policy.
3. Enable demo probes and range-boundary entries with existing account limits.
4. Compare against predeclared acceptance criteria before any live promotion.

## Market Universe and Opportunity Ranking

BTC-USDT and ETH-USDT act as market-regime anchors even when they are not in
the executable symbol universe. Their trend, volatility, and correlation state
provide a common risk-on/risk-off context for altcoin theses.

The pipeline ranks actionable opportunities across symbols before execution.
Repeated observations of the same symbol, direction, setup, and structural
trigger update one opportunity rather than creating independent candidates.
Portfolio selection spends exposure on the best post-cost, location-adjusted
candidate instead of whichever scheduled symbol crosses its threshold first.

At minimum, promotion requires no execution-plan drift, no increase in chase
rate, positive post-cost expectancy on the holdout sample, and drawdown within
the existing deterministic limit. Trade frequency is reported but is not by
itself a promotion criterion.

## Safety Invariants

- AI never bypasses deterministic account risk limits.
- Every actionable position has a stop and explicit invalidation.
- Position size is bounded by the selected normal/probe tier.
- No future candle information is available to a decision or replay.
- Configuration/version and source-data cutoff are persisted end to end.
- Production rollout remains DEMO/shadow until promotion criteria pass.
