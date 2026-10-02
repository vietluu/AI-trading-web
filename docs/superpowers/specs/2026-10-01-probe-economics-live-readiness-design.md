# Probe Economics and Live-Readiness Design

## Objective

Remove the cold-start deadlock in proactive thesis execution without weakening
entry quality, account-risk, market-quality, or exchange-protection controls.
Immature exact cohorts must be able to collect bounded SHADOW and DEMO evidence,
while mature cohorts must continue to earn sizing authority from realized net
results after fees, funding, and execution effects.

This change does not promise positive PnL and does not enable LIVE trading by
itself. It makes the promotion evidence honest and the pre-LIVE verification
path executable.

## Root Cause

The proactive pipeline correctly refuses to borrow the baseline probability
when the selected AI thesis lacks 30 exact finalized outcomes. It currently
represents that absence by setting expected value to `0` and profit factor to
`1`, then sends those telemetry values through the ordinary Decision Risk and
Judge profitability gates. Both gates interpret the neutral placeholders as
proven bad economics and block the trade before the later lifecycle authority
can apply its `PROBE_ONLY` size cap.

The integration suite misses this interaction because its proactive pipeline
tests replace the real Judge and Decision Risk policy with approving doubles.
The system can therefore report a passing probe test while the production gate
order prevents the probe from reaching risk assessment.

Recent-loss critic context has a related attribution weakness: it is selected
only by symbol and timeframe, so opposite directions, unrelated setups,
different regimes, providers, and configurations can influence the current
thesis review.

## Authority Model

Proactive economics carry an explicit authority state:

- `EXACT_LIFECYCLE`: at least 30 deduplicated finalized outcomes from the exact
  cohort. Empirical probability, expected value, and profit factor are
  authoritative inputs to profitability gates.
- `UNAVAILABLE`: the exact cohort is immature or absent. No probability is
  fabricated. Geometry and execution safety may authorize a bounded probe, but
  telemetry placeholders are not treated as measured poor performance.

The exact cohort identity remains:

`symbol × provider × timeframe × regime × direction × setup × configuration`

The lifecycle action remains independent and fail-closed:

- `SUPPRESSED` always blocks execution.
- `PROBE_ONLY` caps the composed position size at `0.15` and can never be
  upgraded by another gate.
- `FULL_SIZE` does not bypass any existing gate and requires authoritative
  exact-cohort economics.

## Gate Semantics

Decision Risk and Judge receive the economics authority explicitly rather than
inferring it from numeric placeholders.

For `EXACT_LIFECYCLE`, existing expected-value and profit-factor thresholds
remain mandatory.

For `UNAVAILABLE`, only the empirical profitability comparisons are
non-applicable. All other checks remain mandatory, including:

- actionable direction and calibrated confidence;
- core data freshness and quality;
- evidence coverage and directional agreement;
- conflict, volatility, and risk-score limits;
- minimum geometric net R after deterministic cost assumptions;
- stop-loss and target orientation;
- entry zone, trigger, expiry, invalidation, and chase distance;
- spread, liquidity, collateral, exposure, and exchange protection;
- quant validation and multi-timeframe confirmation.

An unavailable probability is not positive evidence. It grants only eligibility
to reach the lifecycle `PROBE_ONLY` reducer after the remaining gates pass.

The decision output must not expose `0.5` as if it were an estimated win rate.
The nullable empirical probability remains in thesis attribution, while legacy
numeric fields are treated only as non-authoritative compatibility telemetry.

## Exact Loss Context

Critic loss context uses the same cohort identity as probability authority and
the same pinned cutoff. The query accepts symbol, provider, timeframe, regime,
direction, setup, and configuration hash, and returns at most five finalized
negative-net-R outcomes whose `closedAt` is no later than the snapshot cutoff.

The context remains advisory. Query failure yields an empty list and a warning;
it never authorizes or blocks execution on its own.

## Pipeline Data Flow

1. Select and validate an AI thesis aligned with the deterministic baseline.
2. Apply critic review without allowing a direction reversal.
3. Resolve exact lifecycle authority and empirical probability provenance.
4. Construct decision economics with explicit authority metadata.
5. Run Decision Risk, Judge, quant, multi-timeframe, geometry, and market-safety
   gates using authority-aware semantics.
6. Compose reductions from Judge, quant, critic, and lifecycle authority.
7. Reject `SUPPRESSED`; cap `PROBE_ONLY` at `0.15`; retain normal sizing limits
   for `FULL_SIZE`.
8. Persist complete thesis attribution for both approvals and terminal
   rejections.

## Regression Strategy

The primary regression test must instantiate the real `DecisionJudgeService`
and `DecisionRiskPolicyService`. It must prove that a valid immature thesis
reaches risk assessment with a final size factor no greater than `0.15`.

Companion tests must prove:

- unavailable probability never borrows the baseline probability;
- poor or invalid trade geometry remains blocked;
- stale core data and excessive spread remain blocked;
- `SUPPRESSED` never reaches risk persistence or execution;
- a mature exact cohort uses its empirical probability and remains subject to
  EV and profit-factor thresholds;
- no gate can increase a probe above `0.15`;
- recent losses cannot cross provider, direction, regime, setup,
  configuration, or cutoff boundaries;
- attribution is persisted on critic rejection and downstream rejection.

The complete API test suite, lint, typecheck, and production build must pass.
Exchange sandbox and end-to-end suites must be run when their external
credentials and services are available; skipped suites are reported as
unverified and cannot support a LIVE-ready claim.

## Promotion and PnL Criteria

The implementation optimizes for realized net expectancy subject to risk, not
for the highest historical headline PnL. Full-size promotion requires all
existing exact-cohort safeguards, including at least 30 outcomes, positive mean
net R, acceptable drawdown and concentration, and positive sequential windows.

Before LIVE can be recommended, DEMO or canary evidence must also show that
fill rate, slippage, fees, funding, and protection placement do not materially
invalidate replay assumptions. A later LIVE rollout must remain staged and
kill-switch protected.

## Non-Goals

- lowering risk-per-trade, leverage, exposure, or drawdown limits;
- bypassing stale-data, spread, quant, geometry, or protection gates;
- treating missing probability as a 50% win rate;
- optimizing thresholds to make historical results look better;
- guaranteeing profitable trading;
- enabling or submitting a real LIVE order as part of this code change.
