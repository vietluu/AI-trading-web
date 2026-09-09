# Proactive AI Trading Design

**Date:** 2026-09-09  
**Status:** Proposed for review  
**Scope:** Turn the existing deterministic consensus pipeline into an AI-led, regime-aware trading system that can prepare before breakouts, trade range boundaries, reject late entries, and remain bounded by deterministic risk controls.

## 1. Problem

The current system calculates useful anticipatory features but does not carry them through the decision and execution path. `squeezeState` is produced by the indicator calculator, yet the pipeline does not pass it to regime classification or the trade plan. The liquidity-sweep and derivatives-imbalance modules exist but are not invoked by the pipeline. `PRE_BREAKOUT_ACCUMULATION`, anticipatory scenarios, and `SQUEEZE_BREAKOUT` therefore cannot operate as designed.

The active analyst path is predominantly deterministic. The LLM Reflection step runs only after a directional candidate exists and primarily reduces confidence or changes the result to WAIT. It cannot create a thesis while the market is neutral, prepare an entry zone before a move, or promote a watched opportunity when its trigger occurs. Its `adjustedDecision` is not applied except through the separate trap-probability override, and its scenario input is incomplete.

The result is an over-defensive pipeline: historical data from 05/09 onward contained 658 stored directional candidates and all 658 became final WAIT decisions. Some vetoes were appropriate, but the architecture cannot distinguish a new setup deserving a small exploratory position from a proven bad setup deserving a hard block.

## 2. Goals

The updated system must:

1. Make AI responsible for forming and comparing trading theses from verified market evidence.
2. Detect accumulation, distribution, volatility compression, liquidity sweeps, and derivatives positioning before a visible trend is mature.
3. Trade sideways markets at defensible boundaries while refusing entries in the middle of an unclear range.
4. Support staged entries: a small probe before expansion and an add only after confirmation.
5. Reject chase entries after price has moved too far from the planned zone.
6. Keep sizing, leverage, exposure, mandatory protection, drawdown limits, exchange permissions, and order submission deterministic.
7. Record every thesis before its outcome and evaluate the actual trade lifecycle rather than only the price at a fixed future timestamp.
8. Measure performance by `symbol × timeframe × regime × direction × setup × model/prompt/config version` so unrelated cohorts do not veto each other.

The design does not promise prediction certainty or profit in every market. It aims for positive expectancy after costs with bounded losses and auditable decisions.

## 3. Non-goals

- The LLM will not choose unrestricted leverage, remove a stop, bypass account limits, or call an exchange directly.
- The first release will not allow autonomous reversal from LONG to SHORT inside the critic step.
- Historical endpoint accuracy will not authorize LIVE trading by itself.
- Missing data will not be fabricated or converted into neutral evidence.
- The implementation will not enable LIVE mode, approve a strategy version, or create a production exchange connection automatically.

## 4. Selected Architecture

The system will use an **AI-led thesis with deterministic execution**. This balances proactive reasoning with enforceable capital protection.

```text
Closed market data + derivatives + external context
  -> Anticipatory Feature Builder
  -> Opportunity Watcher and regime transition state
  -> AI Researcher: LONG / SHORT / WAIT theses
  -> AI Critic: approve / reduce / require trigger / cancel
  -> Deterministic thesis validator
  -> Cohort evidence policy: block / reduce size / approve
  -> Deterministic Risk Engine and Trade Plan
  -> Exchange execution
  -> AI Position Copilot recommendations
  -> Deterministic position guard
  -> Trade lifecycle outcome and memory
```

The current rules-only Decision remains available as a baseline and fallback. It must not silently masquerade as an AI decision. Every decision records `decisionSource` as `AI`, `RULES`, or `AI_WITH_RULES_FALLBACK`.

## 5. Anticipatory Market Snapshot

A new pure builder will create one versioned `AnticipatoryMarketSnapshot` per symbol, provider, primary timeframe, and closed-candle cutoff. It uses only information available at `sourceDataCutoff`.

Required evidence:

- Price structure: confirmed pivots, range boundaries, equal highs/lows, distance to boundary, and invalidation candidates.
- Volatility: ATR, ATR percentile, Bollinger/Keltner squeeze state, squeeze duration, compression slope, and first expansion state.
- Momentum: historical RSI and MACD series at corresponding confirmed pivots; momentum acceleration/deceleration.
- Participation: volume compression/expansion and available order-book imbalance with timestamp and age.
- Derivatives: current and historical funding percentile, OI level/change, price/OI divergence, and liquidation context when available.
- Context: news, sentiment, macro, and on-chain observations with explicit coverage, age, and unavailable fields.
- Execution context: spread, estimated round-trip cost, tick/lot constraints, current exposure, and whether price is already too far from candidate zones.

The snapshot must expose evidence, not conclusions only. All derived values carry calculation version and source timestamps. Incomplete optional evidence lowers confidence; stale Market or Technical evidence makes the snapshot ineligible.

Existing components will be wired as follows:

- Indicator `squeezeState` feeds the snapshot, detailed regime classifier, AI prompt, scenario builder, and Trade Plan.
- `identifyLiquidityZones` and `detectLiquiditySweep` run on closed candles without future pivots. A pivot is usable only after the required right-side bars have closed.
- `predictDerivativesImbalance` receives actual funding history and OI history. It returns `UNAVAILABLE` when the history requirement is not met.
- Support, resistance, current price, ATR, and anticipatory evidence are passed to the scenario builder; undefined placeholders are forbidden for an executable thesis.

## 6. Regime and Opportunity State

The detailed regime vocabulary is:

- `RANGING_CONSOLIDATION`
- `PRE_BREAKOUT_ACCUMULATION`
- `PRE_BREAKDOWN_DISTRIBUTION`
- `TRENDING_BULL`
- `TRENDING_BEAR`
- `VOLATILE_LIQUIDITY_EXPANSION`
- `EXHAUSTION_REVERSAL_RISK`
- `UNKNOWN`

An `OpportunityWatcher` persists a state machine per symbol and setup:

```text
OBSERVING -> WATCHING -> PROBE_READY -> PROBE_OPEN -> CONFIRMED -> POSITION_OPEN
     |          |             |             |             |
     +----------+-------------+-------------+-------------+-> INVALIDATED / EXPIRED / TOO_LATE
```

- `WATCHING`: a setup is forming; no order authorization.
- `PROBE_READY`: anticipatory alignment and a nearby invalidation justify a small limit order.
- `PROBE_OPEN`: an exploratory position exists; adding is prohibited until confirmation.
- `CONFIRMED`: expansion/reclaim/retest confirms the thesis and an add may be assessed.
- `TOO_LATE`: price exceeded the allowed chase distance; no entry, even if the trend is obvious.
- `INVALIDATED` and `EXPIRED` are terminal for that thesis version.

State transitions are deterministic from stored evidence and AI recommendations. Redis may accelerate active watches, but PostgreSQL is the audit source of truth. Idempotency keys include thesis ID, state transition, and candle cutoff.

## 7. AI Researcher Contract

The AI Researcher receives the versioned snapshot and produces up to three competing theses: LONG, SHORT, and WAIT. It must select one preferred action, but preserve the alternatives for audit.

Each `TradeThesis` contains:

```ts
type OpportunityState =
  | "WATCHING"
  | "PROBE_READY"
  | "CONFIRMED"
  | "TOO_LATE"
  | "WAIT";

interface TradeThesis {
  thesisVersion: number;
  decisionSource: "AI" | "RULES" | "AI_WITH_RULES_FALLBACK";
  state: OpportunityState;
  direction: "LONG" | "SHORT" | "WAIT";
  regime: DetailedRegime;
  transitionProbability: number;
  setup:
    | "RANGE_REVERSAL"
    | "LIQUIDITY_SWEEP_REVERSAL"
    | "SQUEEZE_PROBE"
    | "BREAKOUT_RETEST"
    | "TREND_PULLBACK"
    | "NO_TRADE";
  entryZone: { lower: number; upper: number } | null;
  trigger: StructuredTrigger[];
  invalidation: StructuredInvalidation | null;
  stopLoss: number | null;
  targets: Array<{ price: number; fraction: number }>;
  expectedNetR: number | null;
  maximumChaseDistanceAtr: number;
  confidence: number;
  evidenceFor: EvidenceRef[];
  evidenceAgainst: EvidenceRef[];
  missingEvidence: string[];
  expiresAt: string;
}
```

Natural-language reasoning is supplementary. Execution consumes only validated structured fields. The model cannot cite evidence absent from the snapshot; every `EvidenceRef` points to a snapshot field and source timestamp.

The AI may actively request a transition to `PROBE_READY` or `CONFIRMED`. It may not mark its own output executable. A deterministic validator checks schema, freshness, price geometry, net R, chase distance, and consistency between direction, stop, targets, and invalidation.

If the AI provider times out or returns invalid output, the pipeline records the failure and uses the explicit rules baseline. It does not label the fallback as AI.

## 8. AI Critic Contract

The critic receives the complete snapshot and thesis, including scenarios, entry geometry, cohort evidence, and recent losses. It returns one action:

- `APPROVE`
- `REDUCE_SIZE`
- `REQUIRE_TRIGGER`
- `CANCEL`

The critic cannot directly reverse direction. A contrary view becomes a separate Researcher thesis and must pass validation independently. `adjustedDecision` is removed from the critic contract to avoid an unused or ambiguous control path.

The critic must return structured reason codes and evidence references. A scalar trap probability may be included for monitoring but cannot be the sole execution rule. Detailed hidden reasoning is not required to be stored; the system stores a concise audit rationale and evidence references.

## 9. Regime Playbooks

### Sideways market

The system may trade only near a validated range boundary. The middle 40% of the range is a no-entry zone unless a separate breakout setup is active.

- LONG: range low or bullish liquidity sweep and reclaim.
- SHORT: range high or bearish liquidity sweep and reclaim.
- Stop: beyond the sweep extreme or structural boundary plus a small ATR buffer.
- Target: range midpoint for partial profit and opposite boundary for the remainder when net R permits.
- Risk: 0.20–0.30% of equity, capped below the global risk ceiling.
- Time stop: reassess after the configured number of primary candles; close or reduce when price fails to leave the boundary.

### Pre-breakout or pre-breakdown

A probe requires volatility compression plus directional evidence from at least two independent groups. Valid groups are structure/absorption, participation, derivatives, and catalyst/context. EMA and MACD derived from the same price series count as one group.

- Initial probe: 20–25% of the normal risk budget, normally 0.10–0.15% of equity.
- Entry: limit order inside the planned boundary zone.
- Stop: hard structural invalidation close enough to maintain the required net R.
- Confirmation: expansion, reclaim, or retest conditions declared before entry.
- Add: only after confirmation; total risk across probe and add remains at or below 0.50% of equity by default.
- Failed breakout: cancel remaining orders and close/reduce according to the predeclared invalidation.

### Confirmed breakout and trend

The system enters on a retest or controlled pullback. It rejects entries beyond the thesis `maximumChaseDistanceAtr`, initially bounded to 0.6–0.8 ATR by liquidity class and timeframe. A large expansion candle does not itself authorize a market entry.

## 10. Evidence Policy and Gates

Judge and Quant return a severity rather than only a Boolean:

- `BLOCK`: stale core data, invalid geometry, missing protection, cost greater than permitted risk, hard account limit, reliable negative cohort evidence, or exchange/configuration violation.
- `REDUCE_SIZE`: new cohort, insufficient sample, optional data missing, calibration uncertain, or validation assumptions unavailable.
- `APPROVE`: current evidence is compatible and the cohort meets predefined criteria.

Quant validation assumption mismatch remains a BLOCK for full-size LIVE execution, but it may authorize a tightly bounded DEMO/shadow probe. A future LIVE probe requires an explicitly approved exploration budget and strategy version; this design does not enable it automatically.

Calibration uses lifecycle trade outcomes for the same setup and execution policy. It does not use all symbols or fixed-horizon direction labels as interchangeable evidence. Hierarchical fallback may borrow strength from broader cohorts, but it can only reduce size until exact evidence matures.

## 11. Deterministic Risk and Execution

Risk and execution retain final authority over:

- Global and per-trade risk ceilings.
- Maximum positions, same-direction exposure, and correlated crypto beta exposure.
- Leverage bounded by stop distance, liquidation buffer, symbol class, and user ceiling.
- Mandatory stop and protective-order verification.
- Drawdown and loss-streak circuit breakers.
- Entry drift, spread, lot/tick validation, idempotency, cooldowns, and exchange permissions.
- Probe/add combined risk and prohibition of unplanned averaging down.

An AI thesis cannot weaken these limits. Risk may shrink size or reject a thesis. It never expands size beyond the thesis request and configured ceiling.

## 12. Position Management

The Position Copilot receives the original thesis, current state, realized fills, current market snapshot, and remaining risk. It recommends `HOLD`, `REDUCE`, `TAKE_PARTIAL`, `TIGHTEN_STOP`, or `EXIT_THESIS_INVALIDATED`.

Deterministic code validates every recommendation. Stops may only tighten after entry. Adding is allowed only for a planned confirmation transition and only if combined worst-case loss remains inside the original risk budget. The existing break-even, partial, trailing, and wick-retraction logic remains the safety baseline and is included in replay.

## 13. Persistence and Audit

Persist these versioned entities:

- `AnticipatoryMarketSnapshot`
- `TradeThesis`
- `ThesisReview`
- `OpportunityTransition`
- `ExecutionPlanVersion`
- `TradeLifecycleOutcome`

Each entity records source cutoff, data/calculation versions, model/provider, prompt version, configuration hash, timestamps, and parent IDs. No record is overwritten when a thesis changes; a new version is appended. Model prompts must not contain decrypted credentials or unnecessary personal/account data.

## 14. Evaluation

The primary evaluator replays the exact pipeline on timestamped snapshots:

1. Generate the thesis using only data available at the cutoff.
2. Enter no earlier than the next executable quote/candle after the decision.
3. Apply limit TTL, entry drift, spread, fees, slippage, funding, gaps, partial exits, stop movement, and Position Manager decisions.
4. Treat ambiguous same-candle SL/TP ordering conservatively unless finer data resolves it.
5. Enforce portfolio concurrency and exposure across symbols.
6. Mark unrealized equity through time and calculate drawdown from the account curve.

Required comparisons:

- Rules-only baseline.
- AI Researcher without critic.
- AI Researcher plus critic.
- Removal of each evidence group.
- Sideway, pre-breakout, breakout, and trend cohorts.
- Current release versus proposed release on untouched forward data.

Primary metrics are net expectancy in R, net PnL, Profit Factor, mark-to-market drawdown, calibration/Brier score, missed-opportunity cost, chase-entry rate, protection failure rate, and performance stability by cohort. Multiple overlapping observations from one thesis count as one lifecycle.

## 15. Release Stages

1. **Observe:** Build snapshots and theses without affecting current decisions.
2. **Shadow execution:** Replay full lifecycle with portfolio constraints.
3. **Demo canary:** Execute probe/add behavior on the verified DEMO connection with a separate risk budget.
4. **Eligible:** Freeze model, prompt, configuration, and validation evidence after predefined criteria pass.
5. **Approved LIVE canary:** Requires explicit version/hash approval and a production connection. Start with probe risk only.
6. **Scale or roll back:** Scale by predefined evidence thresholds; automatically return to shadow on drift, protection failures, or drawdown breach.

Promotion criteria must be declared before the forward sample begins. The existing defaults (minimum PF, Sharpe, drawdown, sample size) are inputs to review, not automatic proof that the simulator is correct.

## 16. Failure Handling

- Stale or invalid core market data: BLOCK.
- Optional data unavailable: mark unavailable and reduce confidence/size; do not invent a neutral value.
- AI timeout or invalid schema: explicit rules fallback with source label.
- Snapshot/thesis version mismatch: BLOCK and alert.
- Duplicate state transition: idempotent no-op.
- Redis unavailable: rebuild active state from PostgreSQL; do not lose audit history.
- Exchange or protection failure: fail closed, reconcile position, and trigger the existing protection recovery path.
- Model behavior drift or rising override error: disable AI execution influence while continuing observe-mode collection.

## 17. Acceptance Criteria

The design is implemented when:

- A closed-candle squeeze can create a persisted WATCHING thesis before breakout.
- A valid sideway boundary setup can reach a DEMO risk assessment without weakening global limits.
- `squeezeState`, liquidity sweep, and derivatives imbalance appear in the stored snapshot and are consumed by AI, regime classification, scenarios, and Trade Plan.
- Every executable thesis contains entry zone, trigger, invalidation, stop, targets, expiry, net R, chase limit, and evidence references.
- The AI can propose a probe or confirmation transition, while deterministic validation and Risk retain final execution authority.
- A late bullish/bearish signal is classified `TOO_LATE` and cannot submit an order.
- Rules fallback is observable and never counted as an AI decision.
- Replay reproduces Decision → Critic → Judge/Quant → Risk → Trade Plan → Position Manager with portfolio constraints and costs.
- Shadow reports separate lifecycle results by cohort and compare AI lift against rules-only.
- LIVE remains impossible without an approved version/hash and production connection.

