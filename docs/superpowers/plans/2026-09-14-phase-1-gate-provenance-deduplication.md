# Phase 1 Gate Provenance and Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Persist one truthful blocker per candidate and prevent scheduled/event duplicates from inflating paper and performance samples.

**Architecture:** A pure domain helper normalizes every gate into an ordered record and selects only `BLOCK` dispositions. Pipeline persistence stores the canonical records and an evaluation key; database uniqueness protects paper-signal sampling while Redis remains an optimization, not the source of truth.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Vitest, Next.js

**Spec:** `docs/superpowers/specs/2026-09-14-evidence-aligned-entry-optimization-design.md`

## Global Constraints

- This phase must not change which candidates become actionable.
- Passing reasons such as `VALID_EXACT_EVIDENCE` cannot become `skippedReason`.
- Historical rows are not assigned fabricated provenance.
- Deduplication must not suppress position management or exchange reconciliation.

---

### Task 1: Canonical gate-decision domain contract

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/gate-decision.ts`
- Test: `apps/api/test/pipeline/gate-decision.spec.ts`

**Interfaces:**
- Produces: `GateStage`, `GateDisposition`, `GateDecisionRecord`, and `selectBlockingGate(records)`.

- [x] **Step 1: Write failing tests for ordered blocker selection**

```ts
expect(selectBlockingGate([
  { stage: 'JUDGE', disposition: 'PASS', reasonCodes: ['VALID_EXACT_EVIDENCE'] },
  { stage: 'QUANT', disposition: 'BLOCK', reasonCodes: ['QUANT_ASSUMPTION_MISMATCH'] },
])).toEqual({ stage: 'QUANT', reason: 'QUANT_ASSUMPTION_MISMATCH' });
expect(selectBlockingGate([{ stage: 'JUDGE', disposition: 'PASS', reasonCodes: ['VALID_EXACT_EVIDENCE'] }])).toBeUndefined();
```

- [x] **Step 2: Run the focused test and confirm it fails because the module is absent**

Run: `pnpm --filter @platform/api test -- gate-decision.spec.ts`
Expected: FAIL resolving `gate-decision`.

- [x] **Step 3: Implement immutable records and execution-order selection**

```ts
export type GateStage = 'SIGNAL_FILTER' | 'JUDGE' | 'QUANT' | 'MULTI_TIMEFRAME' | 'RISK' | 'EXECUTION';
export type GateDisposition = 'PASS' | 'ADVISORY' | 'REDUCE_SIZE' | 'BLOCK';
export interface GateDecisionRecord { stage: GateStage; disposition: GateDisposition; reasonCodes: string[]; selectedBlockingReason?: string }
export function selectBlockingGate(records: GateDecisionRecord[]) {
  const hit = records.find((record) => record.disposition === 'BLOCK');
  return hit?.reasonCodes[0] ? { stage: hit.stage, reason: hit.reasonCodes[0] } : undefined;
}
```

- [x] **Step 4: Run the focused test**

Run: `pnpm --filter @platform/api test -- gate-decision.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit the domain contract**

```bash
git add apps/api/src/modules/pipeline/domain/gate-decision.ts apps/api/test/pipeline/gate-decision.spec.ts
git commit -m "feat(pipeline): add canonical gate decision contract"
```

### Task 2: Persist canonical blocker and expose it consistently

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-alert.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-analytics.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-health.service.ts`
- Modify: `packages/shared/src/schemas/pipeline.ts`
- Modify: `apps/web/src/app/ai/pipeline-runs/[id]/page.tsx`
- Test: `apps/api/test/pipeline/pipeline-runtime.spec.ts`
- Test: `apps/api/test/pipeline/pipeline-alert.service.spec.ts`
- Test: `apps/api/test/pipeline/pipeline-analytics.spec.ts`

**Interfaces:**
- Consumes: `selectBlockingGate(records)` from Task 1.
- Produces: `result.gates`, `result.blockingGate`, and matching `skippedReason`.

- [x] **Step 1: Add a failing runtime regression for the production mislabel**

```ts
expect(run.result.blockingGate).toEqual({ stage: 'QUANT', reason: 'QUANT_ASSUMPTION_MISMATCH' });
expect(run.skippedReason).toBe('QUANT_ASSUMPTION_MISMATCH');
expect(run.result.gates).toContainEqual(expect.objectContaining({ stage: 'JUDGE', disposition: 'PASS' }));
```

- [x] **Step 2: Run the runtime, alert, and analytics tests**

Run: `pnpm --filter @platform/api test -- pipeline-runtime.spec.ts pipeline-alert.service.spec.ts pipeline-analytics.spec.ts`
Expected: FAIL because canonical gate fields are absent.

- [x] **Step 3: Build ordered gate records at candidate evaluation and derive the blocker once**

Replace `filter.reason ?? judge.reasons[0] ?? quantBlockReason` with records in the order `SIGNAL_FILTER`, `JUDGE`, `QUANT`, `MULTI_TIMEFRAME`, then append `RISK` and `EXECUTION` when reached. Store passing Judge reasons with `PASS`, Quant reductions with `REDUCE_SIZE`, and only use `selectBlockingGate` for `skippedReason`.

- [x] **Step 4: Route alerts, analytics, health, shared response parsing, and UI through `blockingGate`**

```ts
rejectReason: blockingGate?.reason,
blockingStage: blockingGate?.stage,
```

- [x] **Step 5: Run focused API tests and web type checking**

Run: `pnpm --filter @platform/api test -- pipeline-runtime.spec.ts pipeline-alert.service.spec.ts pipeline-analytics.spec.ts && pnpm --filter @platform/web typecheck`
Expected: PASS.

- [x] **Step 6: Commit canonical provenance integration**

```bash
git add apps/api/src/modules/pipeline packages/shared/src/schemas/pipeline.ts apps/web/src/app/ai/pipeline-runs
git commit -m "fix(pipeline): persist truthful blocking gate provenance"
```

### Task 3: Durable evaluation identity and sample deduplication

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260914090000_pipeline_evaluation_identity/migration.sql`
- Create: `apps/api/src/modules/pipeline/domain/evaluation-identity.ts`
- Modify: `apps/api/src/modules/pipeline/infrastructure/pipeline.repository.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Test: `apps/api/test/pipeline/pipeline-idempotency.spec.ts`
- Test: `apps/api/test/reflection/performance-provenance.spec.ts`

**Interfaces:**
- Produces: `buildEvaluationKey(input): string`, nullable `PipelineRun.evaluationKey`, and unique `PaperSignal.evaluationKey`.

- [x] **Step 1: Write failing identity tests**

```ts
expect(buildEvaluationKey(scheduleInput)).toBe(buildEvaluationKey(eventInput));
expect(buildEvaluationKey({ ...scheduleInput, sourceDataCutoff: nextCandle })).not.toBe(buildEvaluationKey(scheduleInput));
```

- [x] **Step 2: Run the focused tests and confirm missing behavior**

Run: `pnpm --filter @platform/api test -- pipeline-idempotency.spec.ts performance-provenance.spec.ts`
Expected: FAIL because `evaluationKey` is unavailable.

- [x] **Step 3: Implement SHA-256 identity from normalized cohort fields**

```ts
buildEvaluationKey({ userId, provider, symbol, timeframe, sourceDataCutoff, strategyKey, direction, configurationVersion }): string
```

Use uppercase provider/symbol/direction, canonical timeframe, ISO cutoff, and explicit configuration version; do not include trigger source.

- [x] **Step 4: Add nullable columns, dry-run duplicate query, and partial unique indexes**

The migration adds `evaluationKey` to `pipeline_runs` and `paper_signals`, reports existing duplicate groups before index creation, and creates a unique partial index on non-null paper-signal keys. Do not backfill legacy rows.

- [x] **Step 5: Use create-or-reuse semantics and exclude duplicates from performance labeling**

Catch Prisma unique-conflict `P2002`, load the existing run/signal by evaluation key, and return it without creating an additional calibration sample.

- [x] **Step 6: Verify schema and tests**

Run: `pnpm --filter @platform/api exec prisma validate && pnpm --filter @platform/api test -- pipeline-idempotency.spec.ts performance-provenance.spec.ts`
Expected: schema valid and tests PASS.

- [x] **Step 7: Commit durable deduplication**

```bash
git add apps/api/prisma apps/api/src/modules/pipeline apps/api/test/pipeline apps/api/test/reflection
git commit -m "feat(pipeline): deduplicate decision evaluation samples"
```
