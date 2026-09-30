# Thesis Consensus and Entry Attribution Design

## Objective

Prevent proactive execution from combining the direction and geometry of one
hypothesis with the probability of another. Make every executed thesis traceable
to a single direction, setup, entry plan, and empirical probability authority.
The change improves prediction and entry selection; it does not lower account
risk limits or claim that trades can be predicted with certainty.

This design applies to the proactive thesis pipeline in OBSERVE, SHADOW, and
DEMO. It does not authorize LIVE trading.

## Root Cause

The current proactive flow asks the AI researcher to choose a preferred thesis
before the deterministic decision baseline is produced. The pipeline rejects a
baseline `WAIT`, but it does not reject an actionable AI thesis whose direction
opposes the baseline. It then copies the baseline's expected win probability
onto the AI thesis geometry and uses that mixed result to calculate expected
value and estimated profit factor.

The critic sees the current snapshot and baseline calibration, but the pipeline
does not provide recent losses despite the critic contract supporting them.
Alternative AI hypotheses are schema-validated but never ranked by deterministic
policy. Consequently, the system cannot reliably attribute a losing trade to
direction selection, entry geometry, timing, or execution.

## Design Principles

- Risk sizing is not a substitute for prediction and entry correctness.
- A probability estimate may govern only the hypothesis cohort from which it was
  measured.
- LLM output proposes candidates; deterministic policy authorizes one candidate.
- A disagreement between independent directional authorities is uncertainty,
  not permission to choose one silently.
- Missing empirical probability produces bounded probe authority, never a
  fabricated probability or unrestricted entry.
- Exchange execution continues to use the persisted thesis without rerunning AI.

## Candidate Selection

The researcher continues to return `preferred` and `alternatives`, but the
pipeline treats them as an unordered candidate set for authorization.

A pure selector receives:

- every AI candidate;
- the baseline decision;
- the pinned anticipatory snapshot;
- the evaluation time.

It performs these steps:

1. If the baseline is `WAIT`, reject the candidate set with
   `BASELINE_DECISION_WAIT`.
2. Validate every candidate with the existing trade-thesis validator.
3. Retain only candidates whose direction exactly equals the actionable baseline
   direction.
4. Retain only `PROBE_READY` or `CONFIRMED` candidates.
5. Rank retained candidates deterministically by:
   - highest calculated net R;
   - greatest count of valid supporting evidence references;
   - lowest count of missing-evidence items;
   - original candidate order as the stable final tie-breaker.
6. If the AI produced an actionable opposite-direction thesis and no aligned
   actionable candidate remains, reject with
   `AI_BASELINE_DIRECTION_CONFLICT`.
7. If no valid aligned candidate remains for another reason, reject with the
   first stable validation reason or `NO_ALIGNED_EXECUTABLE_THESIS`.

The selected candidate, not the raw LLM `preferred` field, is persisted as the
authorized thesis. The complete candidate set and selection reason remain in
the agent audit output.

## Probability and Economics Authority

The selected AI thesis must not inherit `baseline.expectedWinProbability`.

The exact lifecycle authority is extended to expose an empirical win
probability only when its exact finalized cohort contains sufficient evidence.
The minimum probability sample is the same 30 independent lifecycle outcomes
required for full-size authority. Its cohort key remains:

`symbol × provider × timeframe × regime × direction × setup × configuration`

For an exact mature cohort, proactive economics use:

- reward: calculated net R from the selected thesis;
- loss: 1R;
- probability: exact cohort wins divided by exact finalized outcomes;
- execution cost: already represented in lifecycle net R and the downstream
  deterministic cost checks;
- expected value: `p × reward - (1 - p)`;
- estimated profit factor: `(p × reward) / (1 - p)`.

For an immature or unavailable exact cohort:

- probability authority is `UNAVAILABLE`;
- expected value and profit-factor estimate are neutral telemetry values, not
  borrowed baseline values;
- the existing lifecycle gate remains `PROBE_ONLY` at no more than 0.15 normal
  size;
- missing probability alone does not convert a geometrically valid DEMO or
  SHADOW thesis into a false full-size approval.

Exact negative expectancy retains its existing suppression behavior.

## Critic Loss Context

Before critic review, the pipeline loads at most five recent finalized losing
lifecycle outcomes matching the selected thesis symbol and timeframe. Each
entry is rendered as a bounded, non-narrative summary containing:

- direction;
- setup;
- regime;
- net R;
- exit reason;
- entry price and exit price when available.

The query must use outcomes closed no later than the pinned snapshot cutoff to
avoid future-data leakage. Failure to load this optional context is logged and
produces an empty list; it does not bypass deterministic gates.

The critic remains unable to reverse direction. It may approve, reduce size,
require a trigger, or cancel.

## Decision Attribution

Every proactive evaluated result records a `thesisAttribution` object:

- `researchPreferredDirection`;
- `selectedDirection`;
- `baselineDirection`;
- `directionAgreement`;
- `candidateCount`;
- `selectedCandidateIndex`;
- `selectionReason`;
- `entrySource`, fixed to `AI_THESIS` or `RULES_FALLBACK`;
- `probabilityAuthority`, one of `EXACT_LIFECYCLE` or `UNAVAILABLE`;
- `probabilitySampleSize`;
- `empiricalWinProbability`, nullable;
- `criticRecentLossCount`.

Terminal rejection stores the same attribution fields available at that point
plus the stable rejection code. This makes post-trade analysis able to separate
direction selection from entry selection and exchange execution.

No database migration is required because pipeline results and lifecycle
metadata already use JSON fields. Stable TypeScript types and schemas are still
required at the domain boundary.

## Failure Handling

- Direction conflict fails closed before risk assessment and order submission.
- Invalid alternatives cannot displace a valid aligned candidate.
- Missing exact probability never falls back to baseline probability.
- Failure to fetch optional loss context does not authorize a trade; deterministic
  selection and all existing execution gates still apply.
- Existing stale-data, trigger, entry-zone, chase-distance, invalidation,
  protection, collateral, and exposure gates remain unchanged.

## Testing Strategy

- Unit tests for deterministic candidate selection cover aligned selection,
  opposite-direction rejection, invalid preferred with valid alternative,
  deterministic tie-breaking, and all-invalid input.
- Pipeline integration tests prove an AI/baseline direction conflict never
  reaches risk assessment or execution.
- Pipeline integration tests prove a valid aligned alternative can replace the
  LLM preferred candidate.
- Economics tests prove baseline probability is never copied onto an AI thesis.
- Lifecycle tests prove exact empirical probability is derived only from the
  matching finalized cohort and respects the snapshot cutoff.
- Critic integration tests prove recent loss summaries are passed without future
  leakage and that query failure degrades to an empty list.
- Existing proactive entry-zone, trigger, chase, stop, and exchange-protection
  suites remain green.

## Rollout and Success Criteria

The change first runs in SHADOW and DEMO. Success requires:

- zero submitted orders with AI/baseline direction disagreement;
- zero proactive results whose probability authority is baseline or fallback;
- every proactive terminal result contains attribution or a pre-analysis failure
  code;
- post-trade reports can group losses by selected direction, setup, entry source,
  probability authority, and exit reason;
- no regression in existing entry protection and exchange safety tests.

## Non-Goals

- lowering `RISK_PER_TRADE`, leverage ceilings, or drawdown thresholds;
- guaranteeing profitable trades;
- using recent losses as an unconditional veto;
- allowing the critic to reverse a thesis;
- rerunning an LLM at order-submission time;
- enabling LIVE execution.
