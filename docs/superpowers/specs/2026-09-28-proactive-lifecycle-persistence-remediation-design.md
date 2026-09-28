# Proactive Lifecycle Persistence Remediation Design

## Goal

Make the proactive trading pipeline persist a complete, immutable research
chain before any execution gate can terminate the run. Production must be able
to reconcile every eligible `WATCHING` transition to a proactive run, a
persisted thesis, or an explicit scheduling failure without weakening any
trading or risk control.

## Production Evidence

The read-only production audit on 28 September 2026 found:

- 390 opportunity transitions entered `WATCHING`;
- only 50 transitions matched a proactive pipeline run;
- 340 transitions had no matching run;
- 109 proactive runs terminated as `BASELINE_DECISION_WAIT`;
- 58 terminated as `THESIS_NOT_EXECUTABLE`;
- `trade_theses`, `thesis_reviews`, `execution_plan_versions`,
  `shadow_execution_plans`, and `trade_lifecycle_outcomes` all contained zero
  rows;
- the rollout audit exceeded its fixed 15-second transaction timeout on the
  production database;
- several audit checks returned `passed: true` without evaluating their stated
  invariant.

`TradeResearcherService` currently persists context and `agent_runs`, but no
production code creates `TradeThesis`, `ThesisReview`, or
`ExecutionPlanVersion` records. In the pipeline runner, a baseline `WAIT`
returns before critic review persistence. Reordering that call alone would not
populate the lifecycle tables and therefore would not repair calibration,
promotion, or audit evidence.

## Scope

This remediation implements immutable persistence for:

1. `TradeThesis` after every completed research attempt, including a valid
   `WAIT` thesis;
2. `ThesisReview` after critic evaluation;
3. `ExecutionPlanVersion` only after a directional thesis passes critic and
   deterministic validation;
4. the relationship from the originating opportunity/transition to its
   persisted thesis;
5. production audit checks for lifecycle delivery, shadow/executed separation,
   PnL arithmetic, incomplete-plan provenance, and canonical blocker
   reconciliation.

The remediation does not create `TradeLifecycleOutcome` from exchange fills.
That remains a separate execution-ledger integration because it requires order,
fill, partial-exit, funding, and position-lifecycle attribution.

## Safety Invariants

- A persisted thesis is evidence, not execution authority.
- A baseline `WAIT` remains a hard execution stop even when a directional
  researcher thesis was persisted.
- A thesis with direction `WAIT`, an invalid thesis, a critic cancellation, or
  a non-executable thesis cannot create an authorized execution plan.
- Only the existing Decision, Judge, Quant, Risk, exchange preflight, and
  runtime trading gates can authorize an order.
- No trading flag, confidence threshold, leverage limit, risk threshold, or
  production connection setting changes in this remediation.
- Persistence failure is fail-closed: the pipeline must not execute when its
  pre-execution evidence cannot be stored.
- Retries must reuse immutable records rather than create duplicate thesis,
  review, or plan versions.

## Architecture

### 1. Persistence Ownership

`TradeResearcherService` remains responsible for producing research output and
agent-run provenance. A focused proactive lifecycle repository owns relational
lifecycle persistence. Keeping database mapping out of the pipeline runner
prevents the runner from duplicating schema knowledge and gives idempotency one
authority.

The repository exposes operations equivalent to:

```ts
persistResearch(input): Promise<{ thesisId: string }>;
persistReview(input): Promise<{ reviewId: string }>;
persistExecutionPlan(input): Promise<{ planId: string }>;
```

Each operation accepts the immutable snapshot cutoff, schema/calculation
versions, configuration hash, model provenance, and the complete validated JSON
artifact. It maps those values to indexed columns and also retains the original
validated JSON.

### 2. Thesis Identity and Idempotency

The existing database uniqueness constraint on
`symbol + provider + timeframe + thesisVersion + sourceDataCutoff` is the
canonical thesis identity. Persistence uses an atomic upsert or create-after-
unique-conflict lookup so a queue retry resolves to the same thesis ID.

The persisted thesis includes `opportunityId`, `snapshotId` when the referenced
snapshot is a relational `anticipatory_market_snapshots` row, and `userId`.
Agent context snapshot IDs are not written into the anticipatory snapshot
foreign key. When no relational anticipatory snapshot ID exists, `snapshotId`
remains null and source cutoff plus opportunity identity preserve provenance.

Review identity is one immutable version per thesis and configuration. Plan
identity uses the existing `thesisId + version` uniqueness constraint. Retry
handling may return an identical existing artifact, but must reject a collision
whose stored content differs from the requested content.

### 3. Pipeline Data Flow

For a `proactive-thesis` job:

1. validate the source opportunity identity;
2. build the pinned anticipatory snapshot;
3. run the researcher and persist its agent-run provenance;
4. persist the preferred `TradeThesis` and link it to the opportunity;
5. calculate the deterministic baseline;
6. if the baseline is `WAIT`, finalize the run as non-actionable while retaining
   the thesis; no critic review or execution plan is fabricated;
7. otherwise run the critic, apply the review, validate the reviewed thesis, and
   persist `ThesisReview`;
8. if review or validation is non-executable, finalize as `WAIT` with the
   canonical reason;
9. for a valid directional thesis, persist a `DRAFT` execution plan containing
   the exact reviewed thesis and policy inputs;
10. continue through the existing execution-readiness, Quant, Judge, Risk, and
    exchange gates.

The persisted thesis ID, not the researcher `agentRun.id`, becomes the
`ProactiveExecutionContext.thesisId` used downstream.

### 4. Opportunity Linkage

After thesis persistence, the repository links the source opportunity to the
thesis through the matching `WATCHING` transition. The update is conditional:
it may fill a null `thesisId` but never overwrite a different thesis. A missing
matching transition is recorded as an explicit reconciliation failure and
prevents execution.

Historical unmatched transitions are reported by the audit; this change does
not silently backfill or rewrite production history.

### 5. Execution Plan Semantics

An `ExecutionPlanVersion` is created only after critic application and
deterministic thesis validation. Its initial status is `DRAFT`; the record is
evidence of an executable candidate, not proof that risk or exchange submission
was approved. `planJson` contains the reviewed thesis, validation result,
baseline decision identity, and the immutable policy inputs needed to reproduce
the candidate.

This remediation does not introduce automatic status mutation to `AUTHORIZED`
or `EXECUTED`. Those transitions require a separate design that binds plan IDs
to risk authorization and exchange orders.

## Audit Remediation

The rollout audit continues to run in a PostgreSQL read-only transaction. Its
interactive transaction timeout becomes configurable and defaults to 120
seconds, while individual queries remain bounded by existing result limits.

The checks behave as follows:

- **Shadow/executed separation:** fail if a shadow plan is associated with an
  exchange execution identifier or an executed lifecycle artifact. If the
  current schema cannot express such an association, report the check as
  unsupported rather than passing it unconditionally.
- **PnL arithmetic:** for complete shadow plans, require finite gross/net values
  and verify net PnL does not exceed gross PnL when fee, slippage, and funding
  fields represent non-negative costs. Validate all gross-PnL signs, not only
  profitable rows.
- **Incomplete provenance:** every incomplete plan must use terminal reason
  `INCOMPLETE_DATA`; null and any other reason fail.
- **Canonical blockers:** completed or skipped final-`WAIT` runs must have a
  canonical blocker, and completed runs must have no `PENDING` or `RUNNING`
  steps. The check reports observed counts and violations.
- **Proactive lifecycle:** every eligible `WATCHING` transition must match a
  proactive run, persisted thesis, downstream artifact, or explicit scheduling
  failure. Explicit failures reconcile delivery but still make rollout
  readiness fail.

Audit code must not catch database/query errors and convert them to empty
passing results. Unsupported fixture behavior may be adapted at the test-double
boundary; production query failures fail the audit.

## Error Handling

- Thesis persistence errors fail the pipeline before critic, risk, or execution.
- Review persistence errors fail the pipeline before execution-plan creation.
- Plan persistence errors fail the pipeline before risk assessment.
- Identity collisions with non-identical content use explicit invariant error
  codes and never overwrite the original artifact.
- Opportunity-link conflicts fail closed and include only non-sensitive IDs and
  canonical reason codes in telemetry.
- The audit returns a non-zero CLI exit code on invariant failure, timeout, or
  query failure.

## Testing

Implementation follows red-green-refactor:

1. A proactive baseline `WAIT` test proves that a thesis is persisted and no
   review, plan, risk assessment, or order submission occurs.
2. Research persistence tests cover directional and `WAIT` theses, relational
   mapping, retry reuse, and conflicting duplicate rejection.
3. Review tests prove correct thesis linkage and immutable version behavior.
4. Plan tests prove only reviewed, validated, directional candidates create a
   `DRAFT` plan.
5. Opportunity linkage tests cover null-to-thesis linkage, retry reuse, missing
   transitions, and conflicting existing links.
6. Audit tests reproduce each former false-positive and the production timeout
   configuration.
7. Focused tests run before the full API and workspace verification suites.

## Rollout

Deploy without changing trading flags. Run the repaired production audit in
read-only mode, then observe at least one complete schedule interval. Success
requires:

- new `WATCHING` transitions reconcile to a proactive run or explicit failure;
- every completed research attempt has a persisted thesis;
- baseline `WAIT` candidates retain evidence and produce no plan/order;
- valid reviewed candidates create at most one `DRAFT` plan per version;
- no completed pipeline run retains open steps;
- audit finishes within its configured timeout and returns no unsupported check
  as a pass.

No LIVE promotion follows automatically. Lifecycle outcomes and positive
post-cost expectancy remain prerequisites for any later promotion decision.
