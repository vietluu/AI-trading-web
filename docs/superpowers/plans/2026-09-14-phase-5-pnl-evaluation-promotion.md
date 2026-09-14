# Phase 5 PnL Evaluation and Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Compare control and recovery candidates using deduplicated post-cost outcomes and fail closed on insufficient promotion evidence.

**Architecture:** A pure evaluator consumes finalized shadow outcomes and produces cohort metrics plus eligibility reasons. Reflection exposes read-only reports; it cannot enable DEMO or LIVE flags.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Vitest, Next.js

**Spec:** `docs/superpowers/specs/2026-09-14-evidence-aligned-entry-optimization-design.md`

## Global Constraints

- Endpoint returns are not account PnL.
- Superseded, duplicate, or incomplete outcomes are excluded.
- Promotion thresholds are fixed before holdout evaluation.
- Reports cannot mutate feature flags or exchange connections.
- Real-capital LIVE promotion is outside scope.

---

### Task 1: Post-cost cohort evaluator

**Files:**
- Create: `apps/api/src/modules/reflection/domain/recovery-cohort-evaluation.ts`
- Test: `apps/api/test/reflection/recovery-cohort-evaluation.spec.ts`

**Interfaces:**
- Produces: `evaluateRecoveryCohort(outcomes, policy): RecoveryCohortReport`.

- [x] **Step 1: Write failing metric and exclusion tests**

Assert reconciliation `grossPnl + fees + funding + slippage = netPnl`, deduplication by evaluation key, exclusion of incomplete/superseded rows, profit factor, mean net R, lower confidence bound, max drawdown, MFE/MAE, stop-before-target rate, and doubled-cost sensitivity.

- [x] **Step 2: Run the focused test**

Run: `pnpm --filter @platform/api test -- recovery-cohort-evaluation.spec.ts`
Expected: FAIL resolving the evaluator.

- [x] **Step 3: Implement deterministic metrics with zero-denominator handling**

Return sample counts and explicit exclusion counts. Never substitute endpoint return or confidence when a PnL component is missing.

- [x] **Step 4: Run tests and commit**

Run: `pnpm --filter @platform/api test -- recovery-cohort-evaluation.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/reflection/domain/recovery-cohort-evaluation.ts apps/api/test/reflection/recovery-cohort-evaluation.spec.ts
git commit -m "feat(reflection): evaluate post-cost recovery cohorts"
```

### Task 2: Predeclared promotion policy

**Files:**
- Create: `apps/api/src/modules/reflection/domain/recovery-promotion-policy.ts`
- Modify: `apps/api/src/modules/reflection/domain/live-eligibility.ts`
- Test: `apps/api/test/reflection/recovery-promotion-policy.spec.ts`
- Test: `apps/api/test/reflection/live-eligibility.spec.ts`

**Interfaces:**
- Produces: `evaluateRecoveryPromotion(report, policy): { eligible; reasons }`.

- [x] **Step 1: Write failing tests for every promotion condition**

Require ≥100 finalized exact-cohort samples, positive lower confidence bound for mean net R, PF ≥1.20, three stable sequential walk-forward folds, reliable calibration, acceptable drawdown, doubled-cost resilience, and zero unresolved protection/provenance incidents.

- [x] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- recovery-promotion-policy.spec.ts live-eligibility.spec.ts`
Expected: FAIL because the recovery policy is absent.

- [x] **Step 3: Implement a pure fail-closed policy**

Return all failed reason codes in deterministic order; do not mutate configuration or call repositories.

- [x] **Step 4: Run tests and commit**

Run: `pnpm --filter @platform/api test -- recovery-promotion-policy.spec.ts live-eligibility.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/reflection/domain apps/api/test/reflection
git commit -m "feat(reflection): gate recovery policy promotion"
```

### Task 3: Read-only control/candidate report and UI

**Files:**
- Modify: `apps/api/src/modules/reflection/infrastructure/reflection.repository.ts`
- Modify: `apps/api/src/modules/reflection/application/performance.service.ts`
- Modify: `apps/api/src/modules/reflection/presentation/reflection.controller.ts`
- Modify: `packages/shared/src/schemas/reflection.ts`
- Modify: `apps/web/src/services/ai-feature.service.ts`
- Modify: `apps/web/src/app/ai/performance/page.tsx`
- Test: `apps/api/test/reflection/reflection-contract.spec.ts`
- Test: `apps/api/test/reflection/reflection-flow.spec.ts`
- Test: `apps/web/test/market-analysis.spec.tsx`

**Interfaces:**
- Consumes: cohort evaluator and promotion policy from Tasks 1–2.
- Produces: authenticated read-only `GET /reflection/recovery-cohorts` response.

- [x] **Step 1: Write failing contract and UI tests**

Assert the response separates control/candidate, realized/shadow, included/excluded samples, costs, drawdown, sensitivity, fold stability, calibration, and eligibility reasons. Assert no mutation control is rendered.

- [x] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- reflection-contract.spec.ts reflection-flow.spec.ts && pnpm --filter @platform/web test -- market-analysis.spec.tsx`
Expected: FAIL because the endpoint and view are absent.

- [x] **Step 3: Add repository aggregation and authenticated read-only endpoint**

Filter by exact cohort key and finalized status, return exclusion counts, and cap raw row retrieval while aggregating all eligible rows in SQL/service logic.

- [x] **Step 4: Render evidence and eligibility without enable buttons**

Show sample count, net R, PF, drawdown, costs, sensitivity, calibration, folds, and explicit failed gates. Label shadow results as simulated.

- [x] **Step 5: Run API/web tests and commit**

Run: `pnpm --filter @platform/api test -- reflection-contract.spec.ts reflection-flow.spec.ts && pnpm --filter @platform/web test -- market-analysis.spec.tsx && pnpm --filter @platform/web typecheck`
Expected: PASS.

```bash
git add apps/api/src/modules/reflection packages/shared/src/schemas/reflection.ts apps/web/src apps/api/test/reflection apps/web/test
git commit -m "feat(analytics): report recovery control and candidate pnl"
```

### Task 4: Full verification and production read-only audit

**Files:**
- Create: `apps/api/src/scripts/audit-recovery-rollout.ts`
- Modify: `apps/api/package.json`
- Modify: `docs/operations/proactive-ai-trading.md`

**Interfaces:**
- Produces: `pnpm --filter @platform/api audit:recovery-rollout` with JSON output and non-zero exit for reconciliation failures.

- [x] **Step 1: Add an audit script that opens a read-only transaction**

Verify canonical blocker reconciliation, unique evaluation keys, exact cohort identity, shadow/executed separation, PnL arithmetic, incomplete exclusions, zero production recovery orders, and the current disabled DEMO probe flag.

- [x] **Step 2: Run the audit against the test database**

Run: `pnpm --filter @platform/api audit:recovery-rollout`
Expected: exit 0 with every check labeled `PASS` on fixtures.

- [x] **Step 3: Run the full project verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all commands exit 0.

- [x] **Step 4: Run the production audit only with explicit read-only credentials/transaction**

Run: `pnpm --filter @platform/api audit:recovery-rollout`
Expected: JSON report; no writes, pipeline triggers, configuration mutations, or exchange calls.

- [x] **Step 5: Document rollout evidence and commit**

```bash
git add apps/api/src/scripts/audit-recovery-rollout.ts apps/api/package.json docs/operations/proactive-ai-trading.md
git commit -m "docs(ops): add recovery rollout audit procedure"
```
