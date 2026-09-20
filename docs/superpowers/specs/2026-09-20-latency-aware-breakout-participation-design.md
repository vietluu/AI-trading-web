# Latency-Aware Breakout Participation Design

## Goal

Reduce missed profitable momentum moves without converting the system into a market-chasing strategy. The system must detect opportunities before breakout, let AI form and critique a time-bounded trade thesis, and reprice deterministically immediately before execution into one of four outcomes: `ENTER_NOW`, `PROBE`, `WAIT_RETEST`, or `CANCEL`.

## Production Evidence

The production audit on 20 September 2026 found that the current behavior is asymmetrically conservative during broad bullish expansion:

- During 18–19 September, ARB closed about 20.40% higher, SOL 10.47%, and ZRO 10.56% higher in the audited 48-hour window.
- The pipeline produced timely LONG candidates, including ARB candidates later showing +16.29% to +24.57% endpoint returns and SOL candidates later showing about +4% to +5% endpoint returns.
- For final-WAIT LONG candidates evaluated four hours later, `PARTIAL_DATA_CONVICTION_TOO_LOW` had 10 observations, 70% positive outcomes, and +3.96% average endpoint return. `CONFIDENCE_BELOW_THRESHOLD` had 14 observations, 71.4% positive outcomes, and +1.07% average endpoint return. `EXPECTED_VALUE_NEGATIVE` had 32 observations, 56.3% positive outcomes, and +0.79% average endpoint return.
- Not every blocker was harmful. `ENTRY_ACTION_NOT_EXECUTABLE` LONG candidates averaged -0.20% after four hours, while `QUANT_REGIME_CONFLICT` LONG candidates averaged -1.03%. Those gates must not be globally relaxed.
- The configured decision universe covered only five symbols during the window, while stronger moves in AVAX, NEAR, SUI, ADA, and LINK were outside that execution universe.
- LLM analysis adds material latency: successful Gemini analyst calls commonly take several seconds, while deterministic fallback paths can take more than 30 seconds. An analysis-time price cannot be assumed executable when the decision finishes.
- Production contained no `trade_theses`, `thesis_reviews`, `execution_plan_versions`, `trade_lifecycle_outcomes`, or `shadow_execution_plans`, so the existing proactive architecture has not produced evidence that it participates in live market opportunities.

Endpoint returns above are diagnostic labels, not executable PnL. They justify investigation and shadow experiments, not relaxed live trading.

## Non-Goals

- Do not enable LIVE trading or production exchange connections.
- Do not lower account drawdown, exposure, loss-streak, protection, liquidity, stale-data, or exchange preflight gates.
- Do not treat a higher trade count, higher signal count, or higher confidence as success.
- Do not allow an LLM to calculate final quantity or submit an exchange order.
- Do not automatically trade every top-gainer or every green candle.
- Do not promote a candidate using legacy one-hour endpoint returns alone.

## Safety Invariants

1. AI output is advisory evidence and never an execution command.
2. Market and technical core data must be fresh for any automated entry.
3. Every executable thesis has a structural invalidation, stop loss, target set, expiry, and maximum chase distance.
4. Entry geometry and expected net R are recalculated with a fresh quote immediately before submission.
5. `PROBE` risk is capped at 0.15R during SHADOW and DEMO validation; leverage cannot compensate for reduced size.
6. Total risk after any scale-in cannot exceed the existing full-trade risk budget of 1R or stricter account limits.
7. Missing optional evidence can reduce size or prevent scale-in, but cannot masquerade as fresh positive evidence.
8. Stale core data, unsafe spread/liquidity, invalid protection, macro blackout, account risk breach, and invalidated thesis remain hard blocks.
9. Failure to obtain an acceptable fill returns the opportunity to a governed state; it never authorizes repeated market chasing.
10. All rollout stages remain SHADOW or DEMO until independently approved through the existing promotion policy.

## Architecture

### 1. Separate Signal Time, Decision Time, and Execution Time

Every candidate records three price/time checkpoints:

- `sourceDataCutoff` and `analysisReferencePrice`: the closed-candle snapshot used by analysts.
- `decisionCompletedAt` and `decisionCompletedPrice`: the quote observed after AI and deterministic synthesis finish.
- `preSubmitAt` and `preSubmitPrice`: the final fresh quote used for risk, geometry, and order construction.

No downstream component may use `analysisReferencePrice` as an assumed fill price. The execution quote has a short validity deadline. If it expires before order submission, the system must reprice or return to `WATCHING`.

### 2. Detect Before Breakout

The deterministic opportunity watcher runs continuously on closed candles and inexpensive market observations. It creates or updates an opportunity before price escapes the setup, based on:

- distance to an established breakout boundary;
- squeeze/compression state;
- relative volume and volume acceleration;
- ATR expansion;
- market-wide participation;
- open-interest/funding observations when available;
- spread, instrument availability, and minimum liquidity.

The watcher does not predict direction with an LLM and does not execute. Its purpose is to put likely opportunities into `WATCHING` early enough for AI analysis to finish before the trigger.

### 3. AI Researcher Produces a Bounded Thesis

For a watchable opportunity, the existing trade researcher produces a validated thesis containing:

- direction and setup type;
- entry zone rather than a single entry price;
- structured trigger;
- structural invalidation and stop loss;
- targets and expected net R;
- maximum chase distance in ATR units;
- evidence for, evidence against, and missing evidence;
- source-data cutoff and expiry;
- model, prompt, schema, calculation, and configuration identity.

The thesis must distinguish `BREAKOUT`, `CONTINUATION`, and `RETEST`. Evidence references must resolve to immutable snapshot fields. Invalid or invented references fail validation and use the governed rules fallback only when that fallback itself produces a valid thesis.

### 4. AI Critic Challenges the Thesis

The critic receives the same immutable snapshot and may return only:

- `APPROVE`;
- `REDUCE_SIZE` with a bounded size factor;
- `REQUIRE_TRIGGER`;
- `CANCEL`.

The critic explicitly evaluates false-breakout evidence, late-news risk, volume confirmation, contradictory higher-timeframe structure, remaining reward after expected drift, and missing auxiliary evidence. It cannot override deterministic hard blocks or increase size.

### 5. Deterministic Execution Repricing

Immediately before execution, a pure repricing policy evaluates:

- drift from analysis price and entry zone in basis points and ATR units;
- distance beyond the breakout boundary;
- current spread and quote age;
- structural stop distance;
- remaining reward to validated targets;
- fees, estimated slippage, and funding;
- current expected net R and risk/reward;
- current opportunity/thesis expiry and invalidation;
- account exposure, correlated exposure, drawdown, and loss streak.

It returns exactly one action:

#### `ENTER_NOW`

The quote remains inside the validated entry zone, protection geometry is valid, and net expectancy satisfies the normal strategy requirements. Existing position sizing applies.

#### `PROBE`

The quote has moved slightly beyond the entry zone but remains inside the configured maximum chase distance; a closed-candle breakout and core Market + Technical agreement exist; liquidity, protection, and net R remain acceptable. The initial risk is capped at 0.15R. Missing optional social/on-chain evidence may permit this reduced-size action but can never authorize a full-size entry.

#### `WAIT_RETEST`

The thesis remains directionally valid but the current quote has moved too far, net R has fallen below the entry requirement, or the trigger is not yet executable. The opportunity persists with retest and continuation triggers, expiry, invalidation, and the last evaluated quote. It is not reconstructed from scratch on every pipeline run.

#### `CANCEL`

The thesis is invalidated, expired, structurally contradicted, unsafe to protect, or no longer offers acceptable expectancy. Cancellation is terminal for that thesis version; a new setup requires a new version and new evidence.

### 6. Controlled Scale-In

A probe may scale only when new closed-candle evidence is persisted after the probe:

- successful retest and reclaim;
- continuation base followed by renewed breakout;
- liquidity and spread remain acceptable;
- updated net R remains valid;
- critic and deterministic validation permit the transition.

No averaging down is allowed. At most two probe attempts are permitted per symbol/setup thesis. The combined daily probe loss budget is 0.5R during validation. Any scale-in plus existing probe exposure remains within the normal 1R trade budget and account-level limits.

### 7. Dynamic Research Universe, Static Execution Eligibility

The research scanner ranks a broader liquid universe using relative volume, ATR expansion, squeeze release, breakout proximity, open-interest changes, news catalysts, and liquidity. This prevents the system from ignoring the strongest market moves solely because they were absent from a static five-symbol schedule.

Research eligibility does not imply execution eligibility. A symbol can progress to automated SHADOW/DEMO execution only if:

- the exchange instrument exists in the target environment;
- minimum notional, tick size, and quantity constraints are known;
- sufficient closed-candle history exists;
- spread and liquidity pass policy;
- symbol-specific quant evidence is available or the action is an explicitly isolated shadow cohort.

### 8. Data-Quality Semantics

Core and auxiliary evidence are treated differently:

- Missing or stale Market/Technical evidence is a hard block.
- Missing social, on-chain, or non-imminent macro evidence is recorded explicitly and reduces authority.
- In a validated short-term breakout, fresh aligned Market + Technical evidence plus one valid auxiliary observation may authorize a SHADOW/DEMO probe, never a full-size entry.
- A macro blackout or reliable adverse news remains a hard block.

This removes the observed false veto caused by unavailable optional feeds without pretending those feeds are healthy.

## State and Persistence

Reuse the existing `Opportunity`, `OpportunityTransition`, `TradeThesis`, `ThesisReview`, `ExecutionPlanVersion`, `TradeLifecycleOutcome`, and `ShadowExecutionPlan` models. Add fields only when existing JSON contracts cannot provide indexed operational queries.

Required persisted evidence includes:

- all three price/time checkpoints;
- repricing metrics and selected action;
- canonical blocking or transition reason;
- entry order type, slippage cap, and quote validity;
- probe/scale risk fractions;
- parent thesis and plan version identity;
- AI and rules cohort identity;
- actual fills, fees, funding, MFE, MAE, net PnL, and net R.

Every state transition must be idempotent on opportunity, snapshot cutoff, thesis version, and calculation version.

## Order Policy

- `ENTER_NOW` and `PROBE` use the existing maker-first or marketable-limit/IOC policy with an explicit slippage cap.
- A missed entry does not automatically fall back to an unlimited market order.
- `WAIT_RETEST` may create a time-bounded limit plan, but the order must be cancelled on expiry, invalidation, configuration change, or stale quote.
- Protective exits prioritize reliable risk reduction. Existing exchange protection preflight and local emergency protection remain mandatory.
- A quote that expires during submission causes reconciliation and reassessment, not blind resubmission.

## AI Lift Experiment

Run three mutually exclusive cohorts on the same immutable opportunity snapshots:

1. `RULES_CONTROL`: current governed entry behavior without probe.
2. `RULES_PROBE`: deterministic thesis/probe policy without LLM judgment.
3. `AI_THESIS_PROBE`: AI researcher and critic plus the identical deterministic repricing and risk policy.

The comparison between cohorts 2 and 3 measures AI lift. The comparison between cohorts 1 and 2 measures the value and cost of probe participation. Cohort assignment is deterministic, persisted before outcome, and stable for the thesis lifecycle.

## Success Metrics and Promotion Gates

Trade count is diagnostic only. A candidate cannot progress beyond SHADOW unless the evaluation uses complete lifecycle outcomes and satisfies all of the following predeclared conditions:

- at least 200 completed, provenance-valid lifecycle outcomes in the candidate cohort;
- positive net expectancy in R after fees, slippage, and funding;
- profit factor above 1.20 with uncertainty reported;
- no material increase in mark-to-market drawdown versus control;
- no protection failures;
- bounded chase rate and probe retry rate;
- stable results across multiple symbols, days, and at least two relevant regimes;
- AI cohort outperforms `RULES_PROBE` on net expectancy without worse tail risk before claiming AI lift;
- candidate passes the existing canary and explicit approval workflow.

Thresholds for ATR drift, slippage, chase rate, and cohort stability must be selected on training/replay data, frozen before holdout, and never tuned on the promotion holdout.

## Failure Handling and Observability

- Provider failure falls back to a validated rules thesis or `WAIT_RETEST`; it never silently weakens the entry contract.
- Providers without valid credentials or health are removed from the active fallback chain before invocation.
- Stale agent states are terminalized by recovery with canonical reasons.
- Every opportunity that reaches `WATCHING` must produce a thesis/review artifact, an explicit scheduling failure, or a recorded expiry reason.
- Dashboards show candidate direction separately from executable action and display analysis-to-decision and decision-to-submit latency.
- Alerts distinguish missed-entry expiry, excessive drift, liquidity rejection, invalidation, provider failure, and risk rejection.

## Testing Strategy

Implementation follows test-driven development:

1. Pure policy tests cover all four repricing actions for LONG and SHORT, boundary equality, stale quotes, invalidated theses, and cost-adjusted net R.
2. Regression fixtures reproduce the profitable ARB/SOL false-negative patterns from 18–19 September without using future data in the decision.
3. Negative fixtures prove that globally relaxing `ENTRY_ACTION_NOT_EXECUTABLE` and `QUANT_REGIME_CONFLICT` would admit losing candidates.
4. State-machine tests prove `WAIT_RETEST` persists across pipeline runs and transitions only on newer closed-candle evidence.
5. AI contract tests reject invented evidence, malformed entry zones, missing invalidation, and targets that fail deterministic geometry.
6. Execution tests prove final repricing uses a fresh quote, honors expiry and slippage caps, and never submits after `WAIT_RETEST` or `CANCEL`.
7. Cohort tests prove deterministic assignment, identical execution policy across AI/rules cohorts, and lifecycle-based metrics.
8. Universe tests prove research ranking cannot bypass instrument, liquidity, history, and quant eligibility.
9. Full API typecheck and test suites remain mandatory; exchange sandbox and deployment smoke checks are reported separately rather than inferred from unit tests.

## Rollout

1. Deploy measurement and persistence with trading behavior unchanged.
2. Activate the opportunity-to-thesis bridge in `OBSERVE` and verify complete lifecycle artifact coverage.
3. Enable all three experiment cohorts in `SHADOW`; do not submit exchange orders.
4. Freeze policy thresholds, run replay and forward shadow until promotion sample requirements are met.
5. If and only if shadow gates pass, enable `AI_THESIS_PROBE` for a small DEMO canary with 0.15R probe and 0.5R daily probe-loss limits.
6. Compare reconciled fills and lifecycle outcomes with shadow predictions; reject or roll back on protection failures, negative expectancy, unstable cohorts, or excessive chase.
7. LIVE enablement remains a separate operator decision and requires an approved version/configuration hash plus production connection review.

## Acceptance Criteria

- A valid early breakout can become `PROBE` without lowering hard safety gates.
- A late but directionally valid breakout becomes `WAIT_RETEST`, not forgotten and not market-chased.
- A fresh quote and updated cost-adjusted geometry are used immediately before every entry submission.
- Missing optional evidence can reduce size but cannot fabricate confidence or bypass hard blocks.
- AI participation is measurable against an identical rules-only probe cohort.
- The stronger research universe cannot directly expand execution authority.
- Production evidence tables no longer remain empty for eligible watched opportunities.
- No claim of improved profitability is made until lifecycle outcomes pass the predeclared shadow and DEMO gates.
