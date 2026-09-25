# Profit-First Practical Trading Design

## Objective

Make the proactive AI trading path operational and judge it by realized net
profit after fees, while enforcing a maximum 15% DEMO drawdown. The system must
participate early through bounded probes without converting missing or fallback
calibration into either a false hard rejection or unrestricted risk.

This design applies to DEMO and shadow execution first. It does not authorize
LIVE promotion.

## Production Evidence Driving the Design

The configured remote database showed, for the seven-day window ending
2026-09-21:

- about 5,070 full-analysis runs but only four directional runs with no blocker;
- 173 transitions into `WATCHING`, zero proactive theses, and 418 explicit
  proactive scheduling failures;
- dominant blockers of `DECISION_IS_WAIT`, `NO_TRADE_ZONE`,
  `CONFIDENCE_BELOW_THRESHOLD`, `EXPECTED_VALUE_NEGATIVE`, and
  `CALIBRATED_PROBABILITY_TOO_LOW`;
- 35 closed DEMO trades in 30 days, with 13 wins, 22 losses, and net PnL of
  -38.5903;
- 17 stop-loss exits, of which 16 lost, producing -51.4841 net PnL.

Performance records are observations at multiple horizons, not independent
trades. They must not be treated as realized PnL or allowed to inflate sample
counts.

## Profit-First Decision Flow

1. A market event, technical precursor, or high-importance news event creates
   or updates an opportunity.
2. Every transition to `WATCHING` must result in exactly one of:
   - a persisted proactive pipeline run and trade thesis;
   - a persisted explicit scheduling or thesis-generation failure.
3. The AI thesis owns direction, setup, entry zone, trigger, invalidation,
   maximum chase distance, evidence for/against, and missing evidence.
4. Deterministic policy owns data freshness, instrument validity, exposure,
   drawdown, stop validity, and maximum loss. It cannot silently replace the AI
   thesis with `WAIT` because of global/fallback calibration.
5. An exact, sufficiently sampled and hard-gate-eligible calibration may block
   a cohort. Global or fallback calibration is telemetry only.
6. A strong candidate without exact calibration becomes a `PROBE`, limited to
   0.10R-0.15R. It does not become a full-size entry.
7. After thesis creation, a lightweight price watcher evaluates the persisted
   entry zone and trigger. It must not rerun the full AI analysis before entry.
8. A thesis enters, waits for pullback, expires, or becomes `TOO_LATE`. It never
   chases beyond `maximumChaseDistanceAtr`.
9. One terminal lifecycle outcome is recorded and used for profitability
   evaluation.

## News and Market Causality

High-impact unexpected news may accelerate an opportunity into a probe only
when all of the following hold:

- the source is allowlisted and the item survives canonicalization and
  deduplication;
- importance and directional confidence meet the configured shock threshold;
- price and volume confirm expansion;
- at least one corroborating input exists: a second independent source, OI,
  funding, or real liquidation data.

Missing liquidation data must remain explicit. It cannot be inferred from price
or volume. OI history must be normalized chronologically before computing a
delta.

## Entry and Exit Policy

The execution policy distinguishes three actions:

- `ENTER`: exact profitable cohort evidence and current trigger confirmation;
- `PROBE`: strong directional evidence with incomplete cohort calibration;
- `WAIT`: weak, stale, invalid, contradictory, or uneconomic evidence.

Probe risk is capped at 0.15 of normal risk. Full-size entry requires exact
cohort evidence with positive net expectancy and Profit Factor above 1 after
fees and slippage.

Stop placement must follow structural invalidation plus an ATR buffer, subject
to the account loss cap. A stop that is so tight that normal market noise would
invalidate it must cause `WAIT` or smaller size, not an artificially close
stop. Each stopped lifecycle records MFE, MAE, entry distance from the thesis
zone, spread, slippage, and whether the original direction later recovered.

## Drawdown Controls

Drawdown uses high-water-mark equity and realized plus marked-to-market PnL:

- below 8%: normal eligible sizing;
- 8% to below 12%: multiply new risk by 0.50;
- 12% to below 15%: reject full-size entries; permit only 0.10R diagnostic
  probes in DEMO when daily probe-loss budget remains;
- 15% or above: reject every new order until an explicit review resets the
  circuit breaker.

Open-position protective exits remain active at every drawdown level.

## Cohort Profitability Authority

Promotion and suppression are evaluated by the independent lifecycle key:

`symbol × provider × timeframe × regime × direction × setup × configuration`

Each thesis contributes at most one terminal lifecycle outcome. Multiple
performance horizons are diagnostic labels only.

A cohort may receive full-size authority only after all conditions hold:

- at least 30 completed independent lifecycles;
- positive net expectancy after fees, slippage, and funding;
- Profit Factor greater than 1.10;
- no single trade contributes more than 35% of cohort net profit;
- maximum cohort drawdown is below 15%;
- results are positive in at least two sequential validation windows.

Before 30 samples, an otherwise strong cohort remains probe-only. A cohort with
negative expectancy after at least 20 completed lifecycles is suppressed until
a new configuration version is evaluated.

## Observability and Failure Handling

The system records one canonical blocker per candidate and retains all
secondary diagnostics separately. Required operational metrics are:

- `WATCHING → proactive run` success rate;
- `proactive run → thesis` success rate;
- thesis-to-probe, thesis-to-entry, expiry, invalidation, and too-late rates;
- entry latency and chase distance;
- realized net PnL, expectancy, Profit Factor, win rate, MFE, MAE, and drawdown;
- stop-out rate followed by directional recovery;
- news freshness, source coverage, corroboration, and causality completeness.

Any scheduling failure is an audit failure. A successful audit cannot be
reported solely because a failure log exists.

## Rollout Gates

### Gate 1: Contract and lifecycle integrity

- zero proactive pipeline schema rejections;
- zero unmatched `WATCHING` transitions;
- every failure has a stable reason code and correlation identifiers.

### Gate 2: Shadow and DEMO economics

- at least 50 independent completed lifecycles across the enabled universe;
- aggregate net expectancy above zero;
- aggregate Profit Factor above 1.0;
- maximum drawdown below 15%;
- no increase in protection failures or unresolved exchange errors.

### Gate 3: Cohort authority

Only cohorts satisfying the stricter cohort profitability rules may use normal
DEMO size. Other eligible cohorts remain probe-only or suppressed.

LIVE promotion is outside this design and requires a separate explicit review.

## Testing Strategy

- Contract tests prove `proactive-thesis` is accepted end to end.
- Lifecycle tests prove every `WATCHING` transition yields a thesis or explicit
  failure.
- Calibration tests prove fallback evidence cannot create a hard blocker or a
  hidden negative expected-net-R gate.
- Entry tests prove a persisted thesis can trigger without rerunning full AI,
  while late entries are rejected.
- Risk tests cover the 8%, 12%, and 15% drawdown boundaries and probe caps.
- Cohort tests prove lifecycle deduplication, profitability authority, and
  suppression behavior.
- Replay tests cover the observed pump, pullback, stop-out, and recovery paths.
- Audit tests fail on scheduling failures, unmatched lifecycles, or missing PnL
  provenance.

## Non-Goals

- guaranteeing profit;
- maximizing trade count;
- enabling LIVE execution;
- fabricating liquidation or news evidence;
- using AI confidence alone as proof of edge;
- loosening exchange, stale-data, collateral, or protective-order safety checks.
