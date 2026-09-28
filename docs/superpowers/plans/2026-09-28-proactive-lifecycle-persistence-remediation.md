# Proactive Lifecycle Persistence Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist an immutable proactive thesis/review/plan chain before execution gates can terminate a run, and make the production rollout audit verify its stated invariants reliably.

**Architecture:** Add a focused `ProactiveLifecycleRepository` that maps validated domain artifacts into the existing Prisma lifecycle models and owns idempotency plus opportunity-transition linkage. `PipelineRunnerService` orchestrates persistence at the research, review, and executable-plan boundaries while preserving every existing execution gate. The rollout audit remains read-only but receives a production-safe timeout and evidence-backed checks instead of unconditional passes.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-28-proactive-lifecycle-persistence-remediation-design.md`

## Global Constraints

- A persisted thesis is evidence, not execution authority.
- Baseline `WAIT`, thesis `WAIT`, critic cancellation, and invalid thesis states cannot reach risk assessment or order submission.
- Persistence errors and lifecycle identity conflicts fail closed before external execution.
- Retries reuse byte-equivalent immutable artifacts and reject conflicting duplicates.
- Do not change trading flags, confidence thresholds, leverage limits, risk thresholds, or production connection settings.
- Do not create or backfill `TradeLifecycleOutcome` in this implementation.
- All database audit access remains inside a read-only transaction.

## File Structure

- Create `apps/api/src/modules/pipeline/infrastructure/proactive-lifecycle.repository.ts`: lifecycle mapping, immutable identity comparison, idempotent thesis/review/plan persistence, and opportunity-transition linkage.
- Create `apps/api/test/pipeline/proactive-lifecycle.repository.spec.ts`: repository behavior using stateful Prisma doubles and explicit conflict cases.
- Modify `apps/api/prisma/schema.prisma`: enforce one review identity per thesis and configuration hash.
- Create `apps/api/prisma/migrations/20260928110000_add_thesis_review_identity/migration.sql`: add the matching database uniqueness constraint without rewriting lifecycle data.
- Modify `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`: call lifecycle persistence at the three approved boundaries and use relational thesis IDs downstream.
- Modify `apps/api/src/modules/pipeline/pipeline.module.ts`: register the repository for dependency injection.
- Modify `apps/api/test/pipeline/proactive-thesis.integration.spec.ts`: prove baseline-WAIT evidence retention and fail-closed persistence behavior.
- Modify `apps/api/src/scripts/audit-recovery-rollout.ts`: configurable timeout and real invariant checks.
- Modify `apps/api/test/audit/trading-system-checklist.spec.ts`: pressure-test each repaired audit invariant.
- Modify `.env.example` and `apps/api/src/config/environment.ts`: document and validate `RECOVERY_ROLLOUT_AUDIT_TIMEOUT_MS` with a 120,000 ms default.

---

### Task 1: Persist immutable proactive theses and link their source transitions

**Files:**
- Create: `apps/api/src/modules/pipeline/infrastructure/proactive-lifecycle.repository.ts`
- Create: `apps/api/test/pipeline/proactive-lifecycle.repository.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `TradeThesis`, `AnticipatoryMarketSnapshot`, opportunity ID, user ID, configuration/model provenance.
- Produces:

```ts
export interface PersistProactiveThesisInput {
  userId: string;
  opportunityId: string;
  snapshotId?: string;
  thesis: TradeThesis;
  snapshot: AnticipatoryMarketSnapshot;
  configurationHash: string;
  modelProvider?: string;
  model?: string;
  promptVersion: number;
}

export interface PersistedProactiveThesis {
  thesisId: string;
  reused: boolean;
}

persistThesis(input: PersistProactiveThesisInput): Promise<PersistedProactiveThesis>;
```

- The operation creates or reuses the identity
  `symbol/provider/timeframe/thesisVersion/sourceDataCutoff`, compares the
  immutable stored payload on reuse, and conditionally links the matching
  `WATCHING` transition where `thesisId` is null or already equal.

- [ ] **Step 1: Write failing thesis-persistence tests**

Add stateful tests with hand-written expected data for:

```ts
it('persists a WAIT thesis with complete provenance and links its WATCHING transition', async () => {
  const result = await repository.persistThesis(waitInput);
  expect(result).toEqual({ thesisId: 'thesis-1', reused: false });
  expect(storedThesis).toMatchObject({
    opportunityId: 'opportunity-1',
    direction: 'WAIT',
    state: 'WAIT',
    sourceDataCutoff: new Date('2026-09-09T12:00:00.000Z'),
    configurationHash: 'config-v1',
  });
  expect(storedTransition.thesisId).toBe('thesis-1');
});

it('reuses an identical thesis after a unique conflict', async () => {
  await expect(repository.persistThesis(directionalInput)).resolves.toEqual({
    thesisId: 'thesis-existing', reused: true,
  });
});

it('rejects a duplicate identity whose immutable payload differs', async () => {
  await expect(repository.persistThesis(conflictingInput))
    .rejects.toThrow('PROACTIVE_THESIS_IDENTITY_CONFLICT');
});

it('fails closed when no matching WATCHING transition can be linked', async () => {
  await expect(repository.persistThesis(directionalInput))
    .rejects.toThrow('PROACTIVE_WATCHING_TRANSITION_REQUIRED');
});

it('never overwrites a transition linked to a different thesis', async () => {
  await expect(repository.persistThesis(directionalInput))
    .rejects.toThrow('PROACTIVE_TRANSITION_THESIS_CONFLICT');
});
```

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
pnpm --filter @platform/api exec vitest run test/pipeline/proactive-lifecycle.repository.spec.ts
```

Expected: FAIL because `ProactiveLifecycleRepository` does not exist.

- [ ] **Step 3: Implement the minimal repository thesis boundary**

Create `ProactiveLifecycleRepository` with `persistThesis()`. Map every indexed
field and retain `thesisJson`. Use `Prisma.InputJsonValue` for JSON fields and
`Prisma.Decimal`-compatible numeric inputs. On `P2002`, load by the exact
compound identity and compare a canonical immutable projection; never update
the existing thesis.

Perform thesis persistence and transition linkage in one Prisma transaction.
Use `opportunityTransition.findFirst()` scoped by `opportunityId`, `toState:
'WATCHING'`, and the same `sourceDataCutoff`; then use conditional `updateMany`
with `OR: [{ thesisId: null }, { thesisId }]`. Distinguish missing transition
from a conflicting existing link using a follow-up read inside the transaction.

- [ ] **Step 4: Run the repository test and verify GREEN**

Run the command from Step 2. Expected: all thesis persistence cases PASS.

- [ ] **Step 5: Commit the thesis repository**

```bash
git add apps/api/src/modules/pipeline/infrastructure/proactive-lifecycle.repository.ts apps/api/test/pipeline/proactive-lifecycle.repository.spec.ts
git commit -m "feat(pipeline): persist proactive thesis evidence"
```

---

### Task 2: Persist immutable reviews and draft execution plans

**Files:**
- Modify: `apps/api/src/modules/pipeline/infrastructure/proactive-lifecycle.repository.ts`
- Modify: `apps/api/test/pipeline/proactive-lifecycle.repository.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260928110000_add_thesis_review_identity/migration.sql`

**Interfaces:**
- Consumes the thesis ID returned by Task 1.
- Produces:

```ts
export interface PersistProactiveReviewInput {
  thesisId: string;
  review: ThesisReview;
  appliedThesis: TradeThesis;
  validation: ThesisValidationResult;
  sourceDataCutoff: Date;
  configurationHash: string;
  modelProvider?: string;
  model?: string;
  promptVersion: number;
  schemaVersion: number;
  calculationVersion: number;
}

persistReview(input: PersistProactiveReviewInput):
  Promise<{ reviewId: string; reused: boolean }>;

export interface PersistExecutionPlanInput {
  thesisId: string;
  reviewedThesis: TradeThesis;
  validation: ThesisValidationResult;
  baseline: DecisionOutput;
  sourceDataCutoff: Date;
  configurationHash: string;
  modelProvider?: string;
  model?: string;
  promptVersion: number;
  schemaVersion: number;
  calculationVersion: number;
}

persistExecutionPlan(input: PersistExecutionPlanInput):
  Promise<{ planId: string; reused: boolean }>;
```

- [ ] **Step 1: Write failing review and plan tests**

Add tests proving:

```ts
it('persists a critic review linked to the relational thesis ID', async () => {
  const result = await repository.persistReview(reviewInput);
  expect(result).toEqual({ reviewId: 'review-1', reused: false });
  expect(storedReview).toMatchObject({
    thesisId: 'thesis-1', action: 'APPROVE', configurationHash: 'config-v1',
  });
});

it('reuses only an identical review for the thesis and configuration', async () => {
  await expect(repository.persistReview(reviewInput)).resolves.toMatchObject({ reused: true });
  await expect(repository.persistReview(conflictingReviewInput))
    .rejects.toThrow('PROACTIVE_REVIEW_IDENTITY_CONFLICT');
});

it('creates one DRAFT plan containing the reviewed thesis and baseline identity', async () => {
  const result = await repository.persistExecutionPlan(planInput);
  expect(result).toEqual({ planId: 'plan-1', reused: false });
  expect(storedPlan).toMatchObject({ thesisId: 'thesis-1', version: 1, status: 'DRAFT' });
});

it.each(['WAIT', 'WATCHING', 'TOO_LATE'])(
  'rejects a non-executable %s thesis before plan persistence',
  async (state) => {
    await expect(repository.persistExecutionPlan(inputWithState(state)))
      .rejects.toThrow('PROACTIVE_EXECUTION_PLAN_NOT_ELIGIBLE');
  },
);
```

- [ ] **Step 2: Run the repository test and verify RED**

Run the Task 1 test command. Expected: new tests FAIL because review/plan
methods are missing.

- [ ] **Step 3: Implement review and plan persistence**

Add `@@unique([thesisId, configurationHash])` to `ThesisReview` and a migration
that creates `thesis_reviews_thesisId_configurationHash_key`. For reviews, find
the existing row by that compound identity before create; if found, compare the
canonical immutable review projection. If a create races and returns `P2002`,
repeat the lookup and comparison. Do not mutate prior reviews.

For plans, require `direction` LONG/SHORT, state `PROBE_READY` or `CONFIRMED`,
and `validation.valid === true`. Create version 1 with status `DRAFT` and a
`planJson` containing `{ reviewedThesis, validation, baselineIdentity }`. On the
existing `thesisId_version` unique conflict, compare the immutable plan before
reuse.

- [ ] **Step 4: Run the repository test and verify GREEN**

Run the Task 1 test command. Expected: all repository tests PASS.

- [ ] **Step 5: Commit review and plan persistence**

```bash
git add apps/api/src/modules/pipeline/infrastructure/proactive-lifecycle.repository.ts \
  apps/api/test/pipeline/proactive-lifecycle.repository.spec.ts \
  apps/api/prisma/schema.prisma \
  apps/api/prisma/migrations/20260928110000_add_thesis_review_identity/migration.sql
git commit -m "feat(pipeline): persist proactive reviews and plans"
```

---

### Task 3: Wire lifecycle persistence into the proactive runner

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/pipeline/pipeline.module.ts`
- Modify: `apps/api/test/pipeline/proactive-thesis.integration.spec.ts`

**Interfaces:**
- Consumes `ProactiveLifecycleRepository` from Tasks 1–2.
- Produces a proactive execution context whose `thesisId` is the relational
  `TradeThesis.id`, never the researcher `agentRun.id`.

- [ ] **Step 1: Add the failing baseline-WAIT integration test**

Extend the runner fixture with a lifecycle repository double whose methods
store concrete artifacts. Add:

```ts
it('persists researcher evidence before a baseline WAIT and never creates execution authority', async () => {
  mockDecision.decideForUser.mockResolvedValue({
    ...makeFusionResult().fusionOutput,
    decision: 'WAIT',
    overrides: [],
  });

  const result = await pipelineRunner.run(makeJob());

  expect(result).toEqual({ outcome: 'SKIPPED', reason: 'BASELINE_DECISION_WAIT' });
  expect(persistedTheses).toHaveLength(1);
  expect(persistedTheses[0]).toMatchObject({ opportunityId: 'opportunity-1' });
  expect(persistedReviews).toHaveLength(0);
  expect(persistedPlans).toHaveLength(0);
  expect(mockLiveTrading.assessPipelineDecision).not.toHaveBeenCalled();
  expect(mockLiveTrading.executePipeline).not.toHaveBeenCalled();
});
```

Add separate tests that thesis, review, and plan persistence failures reject the
run before `assessPipelineDecision`, and that a happy-path risk call receives the
relational thesis ID returned by the repository.

- [ ] **Step 2: Run the proactive integration test and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/pipeline/proactive-thesis.integration.spec.ts
```

Expected: the baseline-WAIT case has no persisted thesis and the constructor
does not accept the lifecycle repository.

- [ ] **Step 3: Inject and register the lifecycle repository**

Add `ProactiveLifecycleRepository` to the `PipelineRunnerService` constructor
beside the existing required `PipelineRepository` dependency, before optional
dependencies, and register it in `PipelineModule.providers`. Update direct constructor fixtures in the
focused test suite with a real stateful repository double; avoid assertions
whose only subject is a mock call.

- [ ] **Step 4: Persist at the approved runner boundaries**

Immediately after `research()`:

```ts
const persistedThesis = await this.proactiveLifecycle.persistThesis({
  userId: job.userId,
  opportunityId,
  thesis: research.preferred,
  snapshot,
  configurationHash: context.configHash,
  modelProvider: context.provider,
  model: context.model,
  promptVersion: context.promptVersion,
});
```

Keep baseline `WAIT` as the next early return. After critic application and
validation, persist the review even when the result is non-executable. Only
after the executable validation branch passes, persist a `DRAFT` plan. Set
`proactive.thesisId = persistedThesis.thesisId`.

- [ ] **Step 5: Run the proactive integration test and verify GREEN**

Run the Step 2 command. Expected: all proactive integration cases PASS and no
baseline-WAIT case reaches risk or exchange execution.

- [ ] **Step 6: Run adjacent pipeline suites**

```bash
pnpm --filter @platform/api exec vitest run \
  test/pipeline/proactive-thesis.integration.spec.ts \
  test/pipeline/proactive-joined-execution.spec.ts \
  test/pipeline/opportunity-watcher.spec.ts \
  test/pipeline/pipeline-runtime.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit runner integration**

```bash
git add apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/src/modules/pipeline/pipeline.module.ts apps/api/test/pipeline/proactive-thesis.integration.spec.ts
git commit -m "fix(pipeline): retain proactive evidence before wait gates"
```

---

### Task 4: Replace audit false-positive checks with executable invariants

**Files:**
- Modify: `apps/api/src/scripts/audit-recovery-rollout.ts`
- Modify: `apps/api/test/audit/trading-system-checklist.spec.ts`

**Interfaces:**
- Keeps `runRecoveryRolloutAudit(databaseUrlOrPrisma?)` as the public entrypoint.
- Produces evidence-backed `AuditCheckResult` entries; query failures reject the
  audit instead of becoming empty passing results.

- [ ] **Step 1: Write failing audit invariant tests**

Create a shared stateful audit fixture and add independent tests:

```ts
it('AUDIT: fails shadow separation when a shadow artifact carries execution identity', ...);
it('AUDIT: reports shadow separation unsupported rather than passing when schema has no execution linkage', ...);
it('AUDIT: rejects net PnL above gross PnL for negative and positive gross outcomes', ...);
it('AUDIT: rejects incomplete plans with null or non-canonical terminal reasons', ...);
it('AUDIT: rejects final WAIT runs without a canonical blocker', ...);
it('AUDIT: rejects completed runs that retain PENDING or RUNNING steps', ...);
it('AUDIT: propagates duplicate-key query failures instead of treating them as zero duplicates', ...);
```

For unsupported shadow/execution association, add `supported: false` in check
details and require `passed: false`; the audit must never turn lack of evidence
into success.

- [ ] **Step 2: Run the audit test and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/audit/trading-system-checklist.spec.ts
```

Expected: tests fail against unconditional `passed: true`, partial arithmetic,
and swallowed query errors.

- [ ] **Step 3: Implement real audit checks**

Replace the unconditional shadow and blocker checks. Use the currently loaded
bounded rows to validate shadow fields expressible in the schema; when no
execution linkage exists in the schema, emit the explicit unsupported failure.
Change incomplete-plan detection to:

```ts
!plan.isComplete && plan.terminalReason !== 'INCOMPLETE_DATA'
```

Validate every complete plan has finite gross and net values and that net does
not exceed gross beyond the numeric tolerance when configured cost bps are
non-negative. Query final-WAIT runs and their steps, count missing blockers and
open terminal steps, and fail on either count. Remove `.catch(() => [])` from
production database queries.

- [ ] **Step 4: Run the audit test and verify GREEN**

Run the Step 2 command. Expected: all audit invariant tests PASS.

- [ ] **Step 5: Commit executable audit invariants**

```bash
git add apps/api/src/scripts/audit-recovery-rollout.ts apps/api/test/audit/trading-system-checklist.spec.ts
git commit -m "fix(audit): enforce proactive rollout invariants"
```

---

### Task 5: Make the production audit timeout configurable and safe

**Files:**
- Modify: `apps/api/src/scripts/audit-recovery-rollout.ts`
- Modify: `apps/api/test/audit/trading-system-checklist.spec.ts`
- Modify: `apps/api/src/config/environment.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces environment setting `RECOVERY_ROLLOUT_AUDIT_TIMEOUT_MS`.
- Default: `120000`; accepted range: `15000..600000` milliseconds.

- [ ] **Step 1: Write the failing timeout behavior test**

Capture the options passed to the Prisma transaction double:

```ts
it('AUDIT: defaults the read-only transaction timeout to 120 seconds', async () => {
  await runRecoveryRolloutAudit(mockPrisma as never);
  expect(transactionOptions).toEqual({ timeout: 120_000 });
});

it('AUDIT: accepts a bounded configured transaction timeout', async () => {
  vi.stubEnv('RECOVERY_ROLLOUT_AUDIT_TIMEOUT_MS', '180000');
  await runRecoveryRolloutAudit(mockPrisma as never);
  expect(transactionOptions).toEqual({ timeout: 180_000 });
});
```

- [ ] **Step 2: Run the audit test and verify RED**

Run the Task 4 test command. Expected: actual timeout remains 15,000 ms.

- [ ] **Step 3: Implement and validate the setting**

Add the Zod environment field with coercion, integer validation, bounds, and
default. Add the documented `.env.example` value. In the standalone audit
script, parse the environment value defensively because it runs without the
Nest configuration bootstrap; invalid values fall back to 120,000 ms.

- [ ] **Step 4: Run audit tests and configuration tests**

```bash
pnpm --filter @platform/api exec vitest run \
  test/audit/trading-system-checklist.spec.ts \
  test/environment.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit timeout remediation**

```bash
git add apps/api/src/scripts/audit-recovery-rollout.ts apps/api/test/audit/trading-system-checklist.spec.ts apps/api/src/config/environment.ts .env.example
git commit -m "fix(audit): allow production-safe rollout timeout"
```

---

### Task 6: Full verification and read-only production audit

**Files:**
- Modify only if verification exposes a regression in files already listed by Tasks 1–5.

**Interfaces:**
- Consumes all completed remediation tasks.
- Produces a verified build and a fresh read-only production audit report in command output; it does not mutate production data.

- [ ] **Step 1: Run focused remediation suites together**

```bash
pnpm --filter @platform/api exec vitest run \
  test/pipeline/proactive-lifecycle.repository.spec.ts \
  test/pipeline/proactive-thesis.integration.spec.ts \
  test/pipeline/proactive-joined-execution.spec.ts \
  test/pipeline/opportunity-watcher.spec.ts \
  test/pipeline/pipeline-runtime.spec.ts \
  test/audit/trading-system-checklist.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run full workspace verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all commands exit zero; only pre-existing explicitly marked
integration/E2E tests may remain skipped.

- [ ] **Step 3: Run the configured production audit read-only**

Load the approved environment without printing secrets and run:

```bash
set -a
source .env
set +a
pnpm --filter @platform/api audit:recovery-rollout
```

Confirm PostgreSQL executes `SET TRANSACTION READ ONLY` before all audit reads.
The audit is expected to complete without transaction expiry. Existing
historical orphaned transitions may make `allPassed` false; that is a valid
production finding, not a verification failure of the command itself. Record
the exact failing checks without changing production rows or feature flags.

- [ ] **Step 4: Review the final diff for scope and safety**

```bash
git status --short
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD -- apps/api/src/modules/pipeline apps/api/src/scripts/audit-recovery-rollout.ts apps/api/src/config/environment.ts .env.example
```

Verify no trading thresholds, LIVE flags, risk limits, exchange credentials, or
unrelated modules changed.

- [ ] **Step 5: Commit any verification-only correction**

Only when Step 2 exposed a regression within the approved files:

```bash
git add apps/api/src/modules/pipeline/infrastructure/proactive-lifecycle.repository.ts \
  apps/api/src/modules/pipeline/application/pipeline-runner.service.ts \
  apps/api/src/modules/pipeline/pipeline.module.ts \
  apps/api/prisma/schema.prisma \
  apps/api/prisma/migrations/20260928110000_add_thesis_review_identity/migration.sql \
  apps/api/src/scripts/audit-recovery-rollout.ts \
  apps/api/src/config/environment.ts \
  apps/api/test/pipeline/proactive-lifecycle.repository.spec.ts \
  apps/api/test/pipeline/proactive-thesis.integration.spec.ts \
  apps/api/test/audit/trading-system-checklist.spec.ts \
  .env.example
git commit -m "test: complete proactive lifecycle remediation verification"
```

If no correction was required, do not create an empty commit.
