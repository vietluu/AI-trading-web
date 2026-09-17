# Production Entry Bottleneck Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified demo-entry bottlenecks without weakening any trading, risk, or promotion gate.

**Architecture:** Preserve the existing pipeline and proactive-thesis ownership boundaries. Add final protection validation at the exchange command boundary, reconcile terminal step state centrally, keep candidate direction distinct from executable intent, and let the scheduler enqueue the existing proactive pipeline exactly once when an opportunity first becomes watchable.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, BullMQ, Vitest, OKX Futures adapter

**Spec:** `docs/superpowers/specs/2026-09-17-production-entry-bottleneck-remediation-design.md`

## Global Constraints

- Do not lower confidence, calibration, geometry, cooldown, risk, or live-trading gates.
- Do not enable production exchange connectivity or live trading.
- Preserve closed-candle cutoff and evaluation idempotency.
- Write and run each regression test before its production change.

---

### Task 1: Validate Protection Against the Effective OKX Entry

**Files:**
- Modify: `apps/api/src/exchange/infrastructure/okx/okx-futures.adapter.ts`
- Modify: `apps/api/src/exchange/domain/order-protection-preflight.ts`
- Test: `apps/api/test/exchange/okx-futures.adapter.spec.ts`
- Test: `apps/api/test/exchange/order-protection-preflight.spec.ts`

**Interfaces:**
- Consumes: `preflightOrderProtection(PreflightOrderProtectionInput)`
- Produces: normalized protection checked against the exact `px` submitted to OKX

- [ ] **Step 1: Add a failing adapter regression test**

Create a BUY case where maker-first/final limit price is below the supplied stop and assert that `signedPost('/api/v5/trade/order', ...)` is not called and the result rejects with `ENTRY_PROTECTION_GEOMETRY_INVALID`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @platform/api test -- test/exchange/okx-futures.adapter.spec.ts`

Expected: FAIL because the adapter currently forwards protection after selecting the effective entry price.

- [ ] **Step 3: Add the final-boundary validation**

Immediately before building the OKX order body, call `preflightOrderProtection` with the final numeric primary price, side, SL, TP, and instrument tick size. Use returned normalized values in the body. Convert rejection to `ExchangeError.protectionPreflight` before `signedPost`.

- [ ] **Step 4: Cover SELL and rounding edge cases**

Add one failing-then-passing domain test proving tick rounding cannot collapse entry and stop into invalid geometry.

- [ ] **Step 5: Run focused exchange tests**

Run: `pnpm --filter @platform/api test -- test/exchange/order-protection-preflight.spec.ts test/exchange/okx-futures.adapter.spec.ts test/exchange/proactive-limit-order.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/exchange/infrastructure/okx/okx-futures.adapter.ts apps/api/src/exchange/domain/order-protection-preflight.ts apps/api/test/exchange/okx-futures.adapter.spec.ts apps/api/test/exchange/order-protection-preflight.spec.ts
git commit -m "fix(okx): validate protection against effective entry"
```

### Task 2: Reconcile Terminal Pipeline Steps

**Files:**
- Modify: `apps/api/src/modules/pipeline/infrastructure/pipeline.repository.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline.service.ts`
- Test: `apps/api/test/pipeline/pipeline-runtime.spec.ts`
- Test: `apps/api/test/pipeline/pipeline.service.spec.ts`

**Interfaces:**
- Produces: `PipelineRepository.skipOpenSteps(runId: string, reason: string, completedAt: Date): Promise<BatchPayload>`
- Produces: one runner helper that finalizes an early terminal run and calls `skipOpenSteps`

- [ ] **Step 1: Add failing repository/runtime tests**

Assert that completing or skipping a run early changes only `PENDING`/`RUNNING` steps to `SKIPPED`, sets `completedAt`, records the canonical reason, and does not overwrite `COMPLETED`/`FAILED` steps.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/pipeline-runtime.spec.ts test/pipeline/pipeline.service.spec.ts`

Expected: FAIL because no bulk terminal reconciliation exists.

- [ ] **Step 3: Implement `skipOpenSteps` minimally**

Use `pipelineStepRun.updateMany` with `{ runId, status: { in: ['PENDING', 'RUNNING'] } }` and update status, completion time, and canonical reason without touching terminal rows.

- [ ] **Step 4: Route early terminal paths through reconciliation**

Update proactive validation exits, invalid mode, no active strategy, cooldown/quota skips, cancellation, and handled early decisions so every terminal run reconciles open steps.

- [ ] **Step 5: Run focused pipeline tests**

Run: `pnpm --filter @platform/api test -- test/pipeline/pipeline-runtime.spec.ts test/pipeline/pipeline.service.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pipeline/infrastructure/pipeline.repository.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/src/modules/pipeline/application/pipeline.service.ts apps/api/test/pipeline/pipeline-runtime.spec.ts apps/api/test/pipeline/pipeline.service.spec.ts
git commit -m "fix(pipeline): reconcile steps on terminal exits"
```

### Task 3: Preserve Candidate Direction Without Advertising Executability

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-analytics.service.ts`
- Test: `apps/api/test/pipeline/pipeline-runtime.spec.ts`
- Test: `apps/api/test/pipeline/execution-readiness.spec.ts`

**Interfaces:**
- Consumes: existing `candidateDecision` and execution-readiness gate records
- Produces: top-level `WAIT` for blocked execution while retaining candidate direction/confidence in nested evidence

- [ ] **Step 1: Add a failing high-confidence WAIT regression**

Build a candidate with direction `SHORT`, confidence `85`, and execution context `{ action: 'WAIT', triggerConfirmed: false, riskTier: 'NONE' }`. Assert the persisted run decision is `WAIT`, `result.actionable` is false, candidate evidence remains `SHORT/85`, and risk assessment is not called.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/pipeline-runtime.spec.ts test/pipeline/execution-readiness.spec.ts`

- [ ] **Step 3: Make executable intent authoritative**

Derive the persisted top-level decision and execution telemetry from the final blocking gate/actionability result. Keep directional data exclusively under `candidateDecision`; do not mutate its confidence.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @platform/api test -- test/pipeline/pipeline-runtime.spec.ts test/pipeline/execution-readiness.spec.ts test/pipeline/registered-symbol-execution-replay.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/src/modules/pipeline/application/pipeline-analytics.service.ts apps/api/test/pipeline/pipeline-runtime.spec.ts apps/api/test/pipeline/execution-readiness.spec.ts
git commit -m "fix(pipeline): separate candidate and executable decisions"
```

### Task 4: Schedule the Existing Proactive Lifecycle From Watchable Opportunities

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-scheduler.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/opportunity-watcher.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline.service.ts`
- Test: `apps/api/test/pipeline/opportunity-watcher.spec.ts`
- Test: `apps/api/test/pipeline/proactive-thesis.integration.spec.ts`

**Interfaces:**
- Consumes: `ObserveOpportunityResult` with `state`, `duplicate`, `snapshotId`, and `opportunityId`
- Produces: one `PipelineService.trigger(... pipelineId: 'proactive-thesis' ...)` per first transition into `WATCHING`, pinned by stored opportunity/snapshot/cutoff context

- [ ] **Step 1: Add a failing scheduler bridge test**

Mock `observe` returning `{ state: 'WATCHING', duplicate: false }`. Assert the scheduler triggers both the normal scheduled analysis and one `proactive-thesis` run with `bypassCooldown: true`, pinned stored context, and the same closed-candle cutoff. Assert duplicate and terminal observations do not trigger proactive work.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/opportunity-watcher.spec.ts`

- [ ] **Step 3: Implement the scheduler bridge**

Use the result already returned by `OpportunityWatcherService.observe`. Trigger the existing proactive pipeline only when `state === 'WATCHING' && duplicate === false`. Contain and log scheduling failure separately from the normal pipeline dispatch.

- [ ] **Step 4: Prove mode isolation**

Extend proactive integration tests so `OBSERVE` persists thesis/review evidence without exchange submission, `SHADOW` never submits an exchange order, and `DEMO` retains verified-connection and risk checks.

- [ ] **Step 5: Run focused proactive tests**

Run: `pnpm --filter @platform/api test -- test/pipeline/opportunity-watcher.spec.ts test/pipeline/proactive-thesis.integration.spec.ts test/pipeline/proactive-joined-execution.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pipeline/application/pipeline-scheduler.service.ts apps/api/src/modules/pipeline/application/opportunity-watcher.service.ts apps/api/src/modules/pipeline/application/pipeline.service.ts apps/api/test/pipeline/opportunity-watcher.spec.ts apps/api/test/pipeline/proactive-thesis.integration.spec.ts
git commit -m "fix(pipeline): schedule proactive lifecycle from opportunities"
```

### Task 5: Strengthen the Production Audit and Verify the Suite

**Files:**
- Modify: `apps/api/src/scripts/audit-recovery-rollout.ts`
- Test: `apps/api/test/audit/trading-system-checklist.spec.ts`

**Interfaces:**
- Produces: an audit failure when eligible recent watcher transitions have neither a proactive artifact/run nor an explicit scheduling failure

- [ ] **Step 1: Add a failing vacuous-pass audit test**

Assert that recent `WATCHING` transitions plus zero downstream lifecycle evidence cannot report a passing lifecycle check.

- [ ] **Step 2: Run the audit test and verify RED**

Run: `pnpm --filter @platform/api test -- test/audit/trading-system-checklist.spec.ts`

- [ ] **Step 3: Implement evidence-aware audit logic**

Report counts for watchable transitions, proactive runs, theses, reviews, plans, shadow plans, explicit scheduling failures, and unmatched watchable transitions. Pass only when every eligible transition has downstream evidence or an explicit failure.

- [ ] **Step 4: Run all verification**

Run:

```bash
pnpm --filter @platform/api typecheck
pnpm --filter @platform/api test
pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scripts/audit-recovery-rollout.ts apps/api/test/audit/trading-system-checklist.spec.ts
git commit -m "test(audit): reject empty proactive lifecycle evidence"
```
