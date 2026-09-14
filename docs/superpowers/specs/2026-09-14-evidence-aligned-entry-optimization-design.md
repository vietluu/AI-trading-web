# Evidence-Aligned Entry Optimization Design

**Date:** 2026-09-14

**Status:** Approved on 2026-09-14

**Related design:** `docs/superpowers/specs/2026-09-13-adaptive-professional-entry-design.md`

## Purpose

Improve realized, post-cost PnL by correcting execution provenance, matching
Quant evidence to the exact decision cohort, detecting recovery/reclaim setups
without hindsight, and evaluating new behavior in shadow before any broader
execution authority is granted.

The motivating production audit covered 279 pipeline runs between 00:00 and
10:37 Asia/Ho_Chi_Minh on 2026-09-14. Five directional decisions reached Risk
and all five were correctly rejected as range entries away from the permitted
boundary. Later recovery LONG candidates in ARB-USDT, ZEC-USDT, and BNB-USDT
were blocked by negative expected value, regime conflict, stale validation, or
validation-assumption mismatch despite favorable subsequent MFE/MAE. This is a
diagnostic signal, not proof that those candidates would be profitable live.

## Goals

- Persist the actual blocking gate and retain every advisory or passing reason
  without labeling an approval reason as the skip cause.
- Prevent validation from one timeframe or execution policy from authorizing a
  materially different cohort.
- Represent a recovery after a liquidity sweep as a stateful, falsifiable setup
  confirmed by closed primary candles.
- Evaluate immature but coherent recovery candidates as shadow probes before
  any DEMO execution is enabled.
- Attribute outcomes and post-cost PnL to the exact symbol, strategy, direction,
  regime, timeframe, policy, and configuration version that produced them.
- Reject promotion unless predeclared sample, stability, calibration, drawdown,
  and post-cost expectancy requirements pass.

## Non-goals

- Lower global Risk, drawdown, leverage, exposure, or protection limits.
- Enter merely because price rose after a blocked decision.
- Treat MFE, endpoint return, confidence, or win rate as realized PnL.
- Enable production exchange connections or real-capital execution.
- Introduce an LLM override for deterministic Risk or Quant gates.
- Rewrite the existing range, breakout, trend, or position-management systems.

## Global Safety Constraints

- New entry behavior is shadow-only until its promotion criteria pass.
- The first executable release, if separately approved, is OKX DEMO only and
  uses at most 10% of the normal risk allocation.
- A probe cannot bypass account, exposure, leverage, drawdown, cooldown,
  liquidity, structural stop, post-cost reward-to-risk, or exchange-protection
  checks.
- Only a closed primary-timeframe candle can confirm a recovery entry.
- Missing, stale, mismatched, or materially negative exact evidence cannot
  authorize normal size.
- Existing live/production feature flags and human approval remain unchanged.

## Phase 1: Decision Provenance and Deduplication

### Canonical gate result

Every evaluated strategy candidate produces a canonical gate record:

```ts
type GateStage = 'SIGNAL_FILTER' | 'JUDGE' | 'QUANT' | 'MULTI_TIMEFRAME' | 'RISK' | 'EXECUTION';
type GateDisposition = 'PASS' | 'ADVISORY' | 'REDUCE_SIZE' | 'BLOCK';

interface GateDecisionRecord {
  stage: GateStage;
  disposition: GateDisposition;
  reasonCodes: string[];
  selectedBlockingReason?: string;
}
```

The pipeline derives `skippedReason` from the first stage in execution order
whose disposition is `BLOCK`. Passing reasons such as `VALID_EXACT_EVIDENCE`
remain in the relevant gate record but can never become `skippedReason`.

The stored result contains:

- the raw candidate decision;
- every gate record in evaluation order;
- the selected blocking stage and reason;
- the final execution decision;
- Risk assessment and exchange submission outcome when reached.

Alerts, analytics, and the diagnostic UI read the canonical record rather than
reconstructing the blocker from unrelated arrays.

### Evaluation identity

The system derives an evaluation key from:

```text
user + provider + symbol + primary timeframe + closed candle cutoff
+ strategy + direction + configuration version
```

Scheduled and event-triggered jobs with the same key reuse the persisted
decision result. An event can create a new evaluation only when the closed
candle cutoff, strategy, direction, or configuration version changes. Intrabar
events may update observation state but cannot create additional calibrated
performance samples.

Deduplication applies to decisions, paper signals, and performance labels. It
does not suppress exchange reconciliation, protective-order management, or a
material external event that changes the decision inputs and is recorded under
a newer source-data cutoff.

## Phase 2: Exact Quant Cohorts and Probability Semantics

### Cohort identity

Execution evidence is keyed by:

```ts
interface ExecutionCohortKey {
  symbol: string;
  strategyKey: string;
  direction: 'LONG' | 'SHORT';
  regime: string;
  timeframe: string;
  executionPolicy: string;
  configurationVersion: number;
}
```

The provider is retained as provenance and becomes part of the key when the
execution policy depends on provider-specific fills, fees, or instrument rules.

Quant matching returns one of:

- `EXACT_MATURE_POSITIVE`: may authorize normal size after all other gates;
- `EXACT_IMMATURE`: shadow/probe eligible only;
- `PARTIAL_MATCH`: shadow-only and reported as assumption mismatch;
- `EXACT_MATURE_NEGATIVE`: blocked;
- `STALE`: shadow-only until refreshed;
- `MISSING`: shadow-only with no profitability claim.

A 1h cohort cannot authorize a 15m entry. A partial match is useful research
context but not execution evidence.

### Separate metrics

Decision output separates four concepts:

```ts
interface ExecutionEvidenceScore {
  signalStrength: number;
  estimatedWinProbability?: number;
  expectedNetR?: number;
  calibrationQuality: 'RELIABLE' | 'UNRELIABLE' | 'INSUFFICIENT';
}
```

`signalStrength` is not displayed or persisted as a probability. `expectedNetR`
is calculated from entry, structural stop, targets, fees, slippage, and funding
assumptions. Calibration is fitted and evaluated only against deduplicated,
provenance-eligible samples from the matching cohort.

## Phase 3: Recovery/Reclaim State Machine

The existing canonical regime and location contract remains authoritative. A
new recovery setup augments, rather than replaces, the playbooks in the related
adaptive-entry design.

```text
RANGING
  -> LIQUIDITY_SWEEP
  -> RECLAIM_PENDING
  -> MOMENTUM_CONFIRMED
  -> BREAKOUT | TRENDING | INVALIDATED | EXPIRED
```

### Transition requirements

`LIQUIDITY_SWEEP` requires a sweep of a persisted structural level and a close
back inside the prior range. A long recovery uses a swept support; a short
recovery uses a swept resistance.

`RECLAIM_PENDING` requires price to reclaim a configured structural level or
EMA zone, but it is not executable.

`MOMENTUM_CONFIRMED` requires all of:

- a closed primary-timeframe candle;
- close beyond the reclaim level in the proposed direction;
- non-negative short-horizon structure, with no opposite break;
- acceptable distance from the reclaim trigger in ATR units;
- post-cost expected R above the configured minimum;
- no unresolved high-severity contradictory market event.

Volume is confirmation evidence, not a universal veto. Weak volume reduces
size or keeps the candidate in shadow according to configuration. On-chain and
sentiment may add or subtract conviction but cannot fabricate core price
confirmation when their quality is `PARTIAL` or `INSUFFICIENT`.

### Direction stability

One closed candle can advance a setup by at most one executable state. An
opposite direction cannot replace a confirmed direction at the same source-data
cutoff. A reversal requires explicit invalidation plus a newer closed candle.

Each state transition records the structural level, candle cutoff, evidence,
invalidation, expiry, and calculation/configuration versions.

## Phase 4: Governed Shadow and DEMO Probe

### Shadow first

Every `MOMENTUM_CONFIRMED` recovery candidate creates a shadow execution plan
with immutable entry, stop, targets, expiry, maximum chase distance, assumed
fees, slippage, and funding. It is evaluated using the same fill and
position-management semantics intended for execution.

Shadow candidates do not call exchange order APIs and do not reserve account
capital. Their results are labeled separately from actual orders.

### DEMO probe eligibility

DEMO probes are a later, separately approved release. Eligibility requires:

- exact cohort is `EXACT_IMMATURE` or `EXACT_MATURE_POSITIVE`;
- calibration quality is not `UNRELIABLE`;
- expected net R and structural reward-to-risk pass;
- primary candle is closed and the trigger is confirmed;
- entry drift remains inside maximum chase distance;
- all existing Risk and account controls approve;
- a verified OKX DEMO connection is selected explicitly.

Probe allocation is the minimum of all size reducers and is capped at 0.10 of
normal risk. At most one recovery probe per symbol and two recovery probes per
account may be open concurrently. A one-hour symbol cooldown starts after a
probe closes or expires. These values are configuration-owned and default to
the stated limits.

`EXACT_MATURE_NEGATIVE`, `PARTIAL_MATCH`, `STALE`, `MISSING`, or
`UNRELIABLE` remains shadow-only. There is no dislocation exception that
converts these states to normal size.

## Phase 5: PnL Evaluation and Promotion

### Outcome contract

Each shadow or executed plan records:

- cohort key and source-data cutoff;
- entry intent and actual/assumed fill;
- stop, targets, expiry, and position-management events;
- gross PnL, fees, slippage, funding, and net PnL;
- initial risk, realized net R, MFE, MAE, and holding duration;
- terminal reason and source-data completeness;
- policy, prompt, model, schema, calculation, and configuration versions.

Endpoint returns remain diagnostic labels and are never reported as account
PnL. Superseded or overlapping samples do not enter promotion statistics.

### A/B evaluation

The current policy is the immutable control. The recovery candidate policy runs
on the same snapshots and source-data cutoffs. The comparison reports:

- incremental eligible setups and actual fill rate;
- post-cost expectancy in R;
- profit factor and win/loss payoff;
- maximum mark-to-market drawdown;
- MFE/MAE and stop-before-target frequency;
- calibration error;
- results by symbol, regime, timeframe, and volatility bucket;
- sensitivity to doubled fees and slippage.

### Promotion criteria

Promotion thresholds are configured before the holdout begins. Default DEMO
probe eligibility requires all of:

- at least 100 deduplicated finalized shadow trades in the exact cohort;
- positive lower confidence bound for mean net R;
- post-cost profit factor at least 1.20;
- no material degradation under doubled fee/slippage assumptions;
- stable walk-forward performance across at least three sequential folds;
- calibration quality `RELIABLE`;
- maximum drawdown within the existing strategy limit;
- no unresolved protection, attribution, or source-data-completeness incident.

Failure leaves the candidate in shadow. Promotion to real-capital LIVE is not
part of this design and always requires a separate review and human action.

## Data and Migration Strategy

Additive schema changes persist gate records, evaluation identity, cohort
identity, and recovery transitions without rewriting historical facts. Existing
runs receive no fabricated blocker or recovery state. A read-only audit may
classify old rows as `LEGACY_PROVENANCE_INCOMPLETE`; these rows cannot satisfy
new promotion samples.

New uniqueness constraints are introduced only after a dry-run duplicate report
confirms their effect. Backfills are idempotent, resumable, and do not delete
historical rows.

## Error Handling

- If canonical blocker derivation fails, execution fails closed with
  `GATE_PROVENANCE_INVALID`.
- If exact-cohort lookup fails, the candidate remains shadow-only with
  `QUANT_EVIDENCE_UNAVAILABLE`.
- If candle finality or structural levels are missing, recovery state cannot
  advance to `MOMENTUM_CONFIRMED`.
- If outcome cost components are incomplete, the result is excluded from
  promotion and marked `SOURCE_DATA_INCOMPLETE`.
- Telemetry persistence failure cannot be silently ignored on an actionable
  path; execution is withheld when its audit record cannot be persisted.

## Testing Strategy

### Unit tests

- Canonical blocker selection never chooses PASS or ADVISORY reasons.
- Exact cohort matching rejects timeframe and execution-policy mismatches.
- Probability, signal strength, and expected net R cannot be interchanged.
- Recovery transitions require closed candles and follow legal state order.
- Direction reversal requires invalidation and a newer cutoff.
- Probe sizing composes reducers and never exceeds 10% of normal risk.

### Integration tests

- Scheduled and event triggers on the same candle create one evaluation and one
  performance sample.
- The same snapshot produces aligned Decision, Judge, Quant, Risk, analytics,
  alert, and diagnostic blocker provenance.
- Shadow recovery plans never call an exchange adapter.
- DEMO probe tests use a fake adapter and verify immutable order terms,
  protection, cooldown, and concurrency limits.
- Incomplete funding, fill, or source provenance excludes an outcome from
  promotion metrics.

### Production verification

- Run a read-only audit proving blocker counts reconcile with gate records.
- Compare control and candidate in shadow on identical source-data cutoffs.
- Verify zero production-environment orders are possible from the new path.
- Publish a cohort report before any request to enable DEMO probes.

## Rollout and Rollback

1. Deploy Phase 1 with no decision-policy change and reconcile telemetry.
2. Deploy exact-cohort matching in report-only mode, then enforce shadow-only
   handling for non-exact evidence.
3. Enable the recovery state machine in shadow only.
4. Accumulate and review the predeclared sample; do not tune thresholds against
   the holdout.
5. If criteria pass, request separate approval for bounded OKX DEMO probes.

Each phase has its own feature flag. Rollback disables the newest phase while
retaining its records for audit. Rollback never rewrites outcomes or promotes a
fallback cohort.

## Success Criteria

- Every non-executed directional candidate has exactly one truthful blocking
  stage and reason.
- Duplicate triggers do not inflate calibration or performance sample counts.
- No 1h validation authorizes a 15m decision.
- Recovery candidates are reproducible from closed-candle data without future
  information.
- Candidate PnL reports reconcile gross PnL, costs, and net PnL.
- No new execution authority is granted before its explicit rollout gate.
- Any claimed PnL improvement is based on deduplicated, post-cost, out-of-sample
  evidence rather than the motivating 2026-09-14 market move.
