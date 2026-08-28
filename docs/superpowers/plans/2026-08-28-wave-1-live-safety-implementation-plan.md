# Wave 1 LIVE Safety Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LIVE trading fail closed unless an exact deterministic strategy version passes strict out-of-sample evidence gates and receives one explicit owner approval, while preserving DEMO experimentation and preventing stale-price execution.

**Architecture:** Deterministic agents, Judge, Risk Engine, and exchange execution remain authoritative. Self-learning may produce a versioned candidate, but can only move it to `LIVE_ELIGIBLE`; a transactional review endpoint promotes the exact stored configuration hash to LIVE. Runtime guards independently verify that approval, quant evidence, collateral health, candle provenance, and entry-price freshness are valid.

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, Next.js/React Query, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-platform-stabilization-design.md`

## Global Constraints

- Preserve the hybrid control boundary: LLM output is advisory and cannot approve, size, submit, retry, or promote a LIVE order or strategy.
- Use test-driven development: add the smallest failing test, observe the intended failure, implement only that behavior, then rerun focused tests.
- Keep every commit green. A TDD red/green cycle is completed before committing; no commit intentionally contains a failing test.
- Preserve DEMO behavior unless the task explicitly distinguishes LIVE from DEMO.
- Never auto-promote a candidate to LIVE. Approval applies once to one exact configuration version and SHA-256 hash.
- Apply additive database changes only. Do not rewrite or delete existing execution, decision, performance, or audit records.
- Do not weaken the existing OKX bid/ask entry-drift rejection. Re-evaluate the complete deterministic assessment once at the pipeline boundary.
- Missing or weak evidence must reduce eligibility or block LIVE; it must not be synthesized or silently treated as neutral-good data.
- Update the canonical spec checkboxes and change ledger after each green commit.

---

## Task 1: Add collateral mismatch diagnostics without changing risk sizing

**Files:**

- Create: `apps/api/src/modules/risk/domain/collateral-health.ts`
- Test: `apps/api/test/risk/collateral-health.spec.ts`
- Modify: `apps/api/src/config/environment.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `apps/api/src/modules/live-trading/application/live-trading.service.ts`
- Test: `apps/api/test/live-trading/protection-and-risk-preflight.spec.ts`

- [ ] Add a failing domain test for a pure collateral-health evaluator:

```ts
import { describe, expect, it } from "vitest";
import { evaluateCollateralHealth } from "../../src/modules/risk/domain/collateral-health";

describe("evaluateCollateralHealth", () => {
  it("warns when available collateral is below ten percent of equity", () => {
    expect(evaluateCollateralHealth(100_000, 4_000, 0.1)).toEqual({
      healthy: false,
      ratio: 0.04,
      reason: "AVAILABLE_COLLATERAL_BELOW_WARNING_RATIO",
    });
  });

  it("does not warn for zero equity or a ratio at the boundary", () => {
    expect(evaluateCollateralHealth(0, 0, 0.1).healthy).toBe(true);
    expect(evaluateCollateralHealth(100_000, 10_000, 0.1).healthy).toBe(true);
  });
});
```

- [ ] Run `pnpm --filter @platform/api test -- collateral-health.spec.ts` and confirm it fails because the module is absent.
- [ ] Implement `evaluateCollateralHealth(totalEquity, availableBalance, warningRatio)` with finite/non-negative normalization and a stable numeric ratio rounded only for alert text, not for the comparison.
- [ ] Add `LIVE_AVAILABLE_COLLATERAL_WARNING_RATIO` to the environment schema with numeric coercion, range `0..1`, and default `0.1`; document the same default in `.env.example` and `docker-compose.yml`.
- [ ] Add an integration test proving `assessPipelineDecision` still sizes from available balance and creates at most one `PipelineAlert` with `kind: "ACCOUNT_COLLATERAL_MISMATCH"` when the ratio is below the configured threshold, including when reassessment is called twice for the same pipeline run.
- [ ] Run the focused preflight test and observe failure because the alert is not written:

```powershell
pnpm --filter @platform/api test -- protection-and-risk-preflight.spec.ts
```

- [ ] In `LiveTradingService.assessPipelineDecision`, evaluate collateral immediately after the exchange account snapshot is synchronized. Within the existing transaction, call `findFirst` for the same `pipelineRunId` and alert kind and create only when absent. Store only numeric equity, available balance, and ratio in `reasoningSummary`; do not store credentials or full exchange payloads.
- [ ] Keep the existing `availableBalance * safeLeverage` position cap and portfolio preflight unchanged.
- [ ] Run both focused suites and then commit:

```powershell
pnpm --filter @platform/api test -- collateral-health.spec.ts protection-and-risk-preflight.spec.ts
git add apps/api/src/modules/risk/domain/collateral-health.ts apps/api/test/risk/collateral-health.spec.ts apps/api/src/config/environment.ts .env.example docker-compose.yml apps/api/src/modules/live-trading/application/live-trading.service.ts apps/api/test/live-trading/protection-and-risk-preflight.spec.ts docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "fix(risk): flag exchange collateral mismatch"
```

## Task 2: Define strict LIVE eligibility as a deterministic domain policy

**Files:**

- Create: `apps/api/src/modules/reflection/domain/live-eligibility.ts`
- Test: `apps/api/test/reflection/live-eligibility.spec.ts`

- [ ] Write failing table-driven tests for every locked threshold and its boundary:

```ts
const passing = {
  outOfSampleAccuracy: 0.55,
  expectancy: 0.000_001,
  profitFactor: 1.3,
  sharpeRatio: 0.5,
  maxDrawdownPct: 10,
  shadowTrades: 100,
  canaryTrades: 100,
};

expect(evaluateLiveEligibility(passing)).toEqual({ eligible: true, failures: [] });
expect(evaluateLiveEligibility({ ...passing, outOfSampleAccuracy: 0.549 })).toMatchObject({
  eligible: false,
  failures: ["OOS_ACCURACY_BELOW_55_PERCENT"],
});
expect(evaluateLiveEligibility({ ...passing, expectancy: 0 })).toMatchObject({
  eligible: false,
  failures: ["EXPECTANCY_NOT_POSITIVE"],
});
```

- [ ] Cover PF `<1.3`, Sharpe `<0.5`, drawdown `>10`, shadow trades `<100`, canary trades `<100`, NaN/infinite values, and multiple failures in stable order.
- [ ] Add a failing test for a stable SHA-256 configuration hash that is independent of object key order and changes when version, weight, confidence threshold, policy version, or advisory policy hash changes.
- [ ] Run `pnpm --filter @platform/api test -- live-eligibility.spec.ts` and confirm the missing-module failure.
- [ ] Implement constants and types:

```ts
export const STRICT_LIVE_ELIGIBILITY_THRESHOLDS = Object.freeze({
  minOutOfSampleAccuracy: 0.55,
  minExpectancyExclusive: 0,
  minProfitFactor: 1.3,
  minSharpeRatio: 0.5,
  maxDrawdownPct: 10,
  minShadowTrades: 100,
  minCanaryTrades: 100,
});

export const LIVE_ELIGIBILITY_POLICY_VERSION = "live-eligibility-v1";
```

- [ ] Canonically serialize sorted weight keys plus `version`, `confidenceThreshold`, `policyVersion`, and `advisoryPolicyHash` (`"advisory-disabled"` for Wave 1), then compute a lowercase 64-character SHA-256 hash.
- [ ] Run the focused suite and commit:

```powershell
pnpm --filter @platform/api test -- live-eligibility.spec.ts
git add apps/api/src/modules/reflection/domain/live-eligibility.ts apps/api/test/reflection/live-eligibility.spec.ts docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "feat(reflection): define strict live eligibility policy"
```

## Task 3: Persist eligible and approved strategy versions additively

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260828120000_live_eligibility_and_performance_provenance/migration.sql`
- Modify: `packages/shared/src/schemas/reflection.ts`
- Test: `apps/api/test/reflection/reflection-contract.spec.ts`

- [ ] Add a failing contract test that parses a lifecycle response containing stage `LIVE_ELIGIBLE`, exact candidate metrics, configuration hash, and approval metadata; reject malformed hashes and missing metrics.
- [ ] Run `pnpm --filter @platform/api test -- reflection-contract.spec.ts` and confirm `LIVE_ELIGIBLE` is rejected by the current schema.
- [ ] Add these fields to `SelfLearningConfiguration`:

```prisma
candidateShadowTrades       Int       @default(0)
eligibleVersion             Int?
eligibleWeightsJson         Json?
eligibleThreshold           Float?
eligibleMetricsJson         Json?
eligibleConfigurationHash   String?
eligibleAt                  DateTime?
approvedVersion             Int?
approvedConfigurationHash   String?
approvedAt                  DateTime?
```

- [ ] Add `provenanceEligible Boolean @default(false)` to `PerformanceRecord`. Existing records intentionally remain false; Task 7 marks only newly validated records true.
- [ ] Write additive SQL using `ALTER TABLE ... ADD COLUMN` only. Set non-null defaults for `candidateShadowTrades` and `provenanceEligible`; do not backfill historical performance rows as eligible.
- [ ] Define shared schemas for `LiveEligibilityMetrics`, `LiveEligibilityCandidate`, and lifecycle stages `LIVE | SHADOW | CANARY | LIVE_ELIGIBLE`. Define this strict review input:

```ts
export const LiveEligibilityReviewInputSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  version: z.number().int().positive(),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
```

- [ ] Generate Prisma, run the migration through the repository command, run contract tests, and commit:

```powershell
pnpm db:generate
pnpm db:migrate
pnpm --filter @platform/api test -- reflection-contract.spec.ts
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260828120000_live_eligibility_and_performance_provenance/migration.sql packages/shared/src/schemas/reflection.ts apps/api/test/reflection/reflection-contract.spec.ts docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "feat(db): persist live eligibility approvals"
```

## Task 4: Replace automatic LIVE promotion with exact-version manual review

**Files:**

- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Modify: `apps/api/src/modules/reflection/presentation/reflection.controller.ts`
- Test: `apps/api/test/reflection/shadow-promotion.spec.ts`
- Create: `apps/api/test/reflection/live-eligibility-review.spec.ts`

- [ ] Extend the shadow-promotion tests first: when shadow passes, copy its observed trade count to `candidateShadowTrades` before resetting shadow performance for canary.
- [ ] Add failing canary tests proving that exactly 100 shadow observations and 100 canary observations can become `LIVE_ELIGIBLE`, while each strict metric failure remains canary/rejected and never changes `liveVersion`, `weightsJson`, or `confidenceThreshold`.
- [ ] Calculate canary expectancy as `totalReturn / tradesCount`; use canary records as OOS evidence. Require every queried performance record to be provenance-eligible once Task 7 is integrated.
- [ ] Replace the successful canary branch with one transaction that:

  - copies version, weights, threshold, metrics, hash, and timestamp into `eligible*` fields;
  - disables and clears active canary fields only after the candidate copy is complete;
  - leaves all current LIVE fields untouched;
  - writes `CANARY_PASSED_LIVE_ELIGIBLE` to the experiment event log;
  - moves the matching research recommendation to `PENDING_APPROVAL`, never `DEPLOYED`.

- [ ] Run `pnpm --filter @platform/api test -- shadow-promotion.spec.ts` and confirm the transition assertions pass after the minimum implementation.
- [ ] Add failing service/controller tests for `POST /api/ai/self-learning/live-eligibility/review` covering owner scoping, explicit confirmation, exact version/hash match, approval, rejection, replay, and concurrent approval attempts.
- [ ] Implement review in one Prisma transaction. For `APPROVE`, lock by conditional `updateMany` predicates on `userId`, `eligibleVersion`, and `eligibleConfigurationHash`; require `count === 1`. Recompute the hash from stored fields before promotion. Copy current LIVE values into `previous*`, apply the eligible candidate, set `approvedVersion`, `approvedConfigurationHash`, `approvedAt`, and `lastPromotionAt`, then clear all `eligible*` fields. Emit `LIVE_ELIGIBILITY_APPROVED` and set the matching recommendation to `DEPLOYED`.
- [ ] For `REJECT`, require the same exact version/hash and confirmation, clear candidate fields, emit `LIVE_ELIGIBILITY_REJECTED` with the bounded reason, and set the matching recommendation to `REJECTED`. A replay or stale hash must return conflict and make no changes.
- [ ] Expose the review endpoint through the authenticated reflection controller and return the updated lifecycle DTO.
- [ ] Run both suites and commit:

```powershell
pnpm --filter @platform/api test -- shadow-promotion.spec.ts live-eligibility-review.spec.ts
git add apps/api/src/modules/reflection/application/self-learning.service.ts apps/api/src/modules/reflection/presentation/reflection.controller.ts apps/api/test/reflection/shadow-promotion.spec.ts apps/api/test/reflection/live-eligibility-review.spec.ts docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "feat(reflection): require manual live version approval"
```

## Task 5: Add the owner-facing LIVE eligibility review UI

**Files:**

- Modify: `apps/web/src/services/ai-feature.service.ts`
- Modify: `apps/web/src/constants/api-endpoints.ts`
- Modify: `apps/web/src/hooks/ai/useAiFeature.ts`
- Modify: `apps/web/src/app/ai/reflection/page.tsx`
- Test: `apps/web/src/app/ai/reflection/page.test.tsx`

- [ ] Add a failing component test that renders all seven eligibility metrics, version and shortened hash, keeps approval disabled until an explicit confirmation checkbox is selected, and posts the full exact hash/version.
- [ ] Add a failing test for rejection and for stale-version conflict display; neither path should optimistically label the current version LIVE.
- [ ] Run the web focused test using the package's existing Vitest command and confirm failure:

```powershell
pnpm --filter @platform/web test -- src/app/ai/reflection/page.test.tsx
```

- [ ] Extend the lifecycle interface with `LIVE_ELIGIBLE`, candidate metrics, hash, and approval metadata. Add `selfLearningLiveEligibilityReview` endpoint and a React Query mutation that invalidates lifecycle and recommendation queries only after success.
- [ ] Render a compact gate table with pass/fail state for accuracy, expectancy, PF, Sharpe, drawdown, shadow trades, and canary trades. Require checkbox text that names the exact version. Send `confirmed: true`; never derive confirmation from opening the page.
- [ ] Show API conflict/rejection text and refresh the lifecycle so a stale browser cannot approve a replaced candidate.
- [ ] Run the focused web test, typecheck, and commit:

```powershell
pnpm --filter @platform/web test -- src/app/ai/reflection/page.test.tsx
pnpm typecheck
git add apps/web/src/services/ai-feature.service.ts apps/web/src/constants/api-endpoints.ts apps/web/src/hooks/ai/useAiFeature.ts apps/web/src/app/ai/reflection/page.tsx apps/web/src/app/ai/reflection/page.test.tsx docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "feat(web): review live eligible strategy versions"
```

## Task 6: Fail closed in LIVE for quant evidence and strategy approval

**Files:**

- Modify: `apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts`
- Test: `apps/api/test/pipeline/quant-execution-policy.spec.ts`
- Modify: `apps/api/src/modules/live-trading/application/live-trading.service.ts`
- Test: `apps/api/test/live-trading/live-version-approval.spec.ts`

- [ ] Change the quant-policy tests first so stale, missing, or assumption-mismatched evidence is blocked in LIVE but retains the current bounded canary multiplier in DEMO.
- [ ] Inject `LiveTradingConfigService` into `QuantExecutionPolicyService` and branch only on its normalized `mode`. Return `{ allowed: false, evaluated: false, reason }` for every insufficient-evidence condition in LIVE. Preserve the existing DEMO multipliers and event-risk cap.
- [ ] Add failing live-trading tests proving LIVE execution is blocked when approval is absent, version differs, hash is absent, or the stored approved hash does not recompute from the active configuration. DEMO must remain unaffected.
- [ ] Implement `assertApprovedLiveStrategyVersion(userId)` immediately before LIVE order reservation/submission. Load the user's active self-learning configuration, recompute its hash, and require:

```ts
approvedVersion === liveVersion &&
approvedConfigurationHash === recomputedHash
```

- [ ] Emit a stable non-retryable reason `LIVE_STRATEGY_VERSION_NOT_APPROVED` and an audit event with version/hash metadata only. Do not auto-approve legacy version 1.
- [ ] Run focused suites and commit:

```powershell
pnpm --filter @platform/api test -- quant-execution-policy.spec.ts live-version-approval.spec.ts
git add apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts apps/api/test/pipeline/quant-execution-policy.spec.ts apps/api/src/modules/live-trading/application/live-trading.service.ts apps/api/test/live-trading/live-version-approval.spec.ts docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "fix(live): fail closed without evidence and approval"
```

## Task 7: Exclude candle-drifted outcomes from calibration and learning

**Files:**

- Create: `apps/api/src/modules/reflection/domain/performance-provenance.ts`
- Test: `apps/api/test/reflection/performance-provenance.spec.ts`
- Modify: `apps/api/src/modules/reflection/application/performance.service.ts`
- Modify: `apps/api/src/modules/reflection/infrastructure/reflection.repository.ts`
- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Modify: `apps/api/src/modules/reflection/application/reflection-scheduler.service.ts`
- Test: `apps/api/test/reflection/reflection-flow.spec.ts`

- [ ] Add failing pure tests for drift tolerances: M15/M30 `60_000ms`, MID/H2/H4 `120_000ms`, LONG `300_000ms`, and SHORT clamped to `15_000..60_000ms` from ten percent of configured duration.
- [ ] Add failing flow tests that require a real start candle, anchor the target to `start.closeTime`, skip a target outside tolerance, and create a record with `provenanceEligible: true` only inside tolerance.
- [ ] Implement `performanceDriftToleranceMs` and make `PerformanceService.evaluateDue` return diagnostic counters `skippedForMissingStartCandle` and `skippedForDrift` in addition to evaluated count.
- [ ] Remove the stored entry-price fallback for calibration records. Search broadly enough to observe the nearest target candle, but reject when `abs(targetCandle.closeTime - targetTime) > tolerance`.
- [ ] Set `provenanceEligible: true` only at the accepted create call. Leave historical rows false.
- [ ] Add `provenanceEligible: true` to all self-learning performance queries used for shadow, canary, rollback, and calibration metrics. An empty eligible set must defer/block, not promote.
- [ ] Update scheduler result typing/logging for the new counters and keep the job successful when records are skipped.
- [ ] Run focused suites and commit:

```powershell
pnpm --filter @platform/api test -- performance-provenance.spec.ts reflection-flow.spec.ts shadow-promotion.spec.ts
git add apps/api/src/modules/reflection/domain/performance-provenance.ts apps/api/test/reflection/performance-provenance.spec.ts apps/api/src/modules/reflection/application/performance.service.ts apps/api/src/modules/reflection/infrastructure/reflection.repository.ts apps/api/src/modules/reflection/application/self-learning.service.ts apps/api/src/modules/reflection/application/reflection-scheduler.service.ts apps/api/test/reflection/reflection-flow.spec.ts apps/api/test/reflection/shadow-promotion.spec.ts docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "fix(reflection): require candle provenance for learning"
```

## Task 8: Reassess deterministic execution exactly once after entry drift

**Files:**

- Create: `apps/api/src/modules/pipeline/application/entry-drift-reassessment.ts`
- Create: `apps/api/test/pipeline/entry-drift-reassessment.spec.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Test: `apps/api/test/pipeline/pipeline-runtime.spec.ts`

- [ ] Write failing orchestration tests for four cases: first execution succeeds; first execution drifts then reassessment succeeds; reassessment rejects risk; second execution drifts again and stops.
- [ ] Assert exact call limits: `assess <= 2`, `execute <= 2`, and no recursive retry. Assert only `ENTRY_PRICE_DRIFT` triggers reassessment; exchange/auth/balance errors remain unchanged.
- [ ] Implement a small `executeWithSingleDriftReassessment` helper that accepts typed `assess` and `execute` callbacks. It must discard the stale assessment, invoke the complete existing assessment path, and execute only when the new status is `RISK_APPROVED`.
- [ ] Integrate the helper at the pipeline-runner boundary. Keep `OkxFuturesAdapter.assertEntryPriceDrift` unchanged so the exchange adapter remains the hard last-line rejection.
- [ ] Reuse the same `pipelineRunId` so risk assessment and client-order idempotency remain intact. Confirm a first failed reservation is updated/reused by existing live-order logic rather than creating a second logical order.
- [ ] Add a runtime test asserting one terminal pipeline result and no retry-loop scheduling after the second drift.
- [ ] Run focused suites and commit:

```powershell
pnpm --filter @platform/api test -- entry-drift-reassessment.spec.ts pipeline-runtime.spec.ts
git add apps/api/src/modules/pipeline/application/entry-drift-reassessment.ts apps/api/test/pipeline/entry-drift-reassessment.spec.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/test/pipeline/pipeline-runtime.spec.ts docs/superpowers/specs/2026-08-28-platform-stabilization-design.md
git commit -m "fix(pipeline): reassess once after entry drift"
```

## Task 9: Verify Wave 1 and close its tracker state

**Files:**

- Modify: `docs/superpowers/specs/2026-08-28-platform-stabilization-design.md`
- Modify: `docs/superpowers/plans/2026-08-28-wave-1-live-safety-implementation-plan.md`

- [ ] Run database/client validation:

```powershell
pnpm db:generate
pnpm db:migrate
```

- [ ] Run the complete API and web quality gates with fresh output:

```powershell
pnpm --filter @platform/api test
pnpm --filter @platform/web test
pnpm lint
pnpm typecheck
```

- [ ] Run the production builds. Record the Windows standalone symlink result separately if it remains an environment permission limitation; do not describe it as an application pass:

```powershell
pnpm --filter @platform/api build
pnpm --filter @platform/web build
```

- [ ] Perform a DEMO smoke run with an insufficient-evidence candidate and verify bounded canary behavior remains available. Perform a LIVE-mode dry assessment and verify it returns `LIVE_STRATEGY_VERSION_NOT_APPROVED` without submitting an order.
- [ ] Query the migrated database and confirm historical `PerformanceRecord` rows remain `provenanceEligible = false`, while a newly accepted in-tolerance record is true.
- [ ] Review the diff for secrets, unrelated edits, destructive migration SQL, unbounded retry paths, and any LLM-controlled trading branch.
- [ ] Mark Wave 1 acceptance criteria and every completed checkbox in the canonical spec. Add commit hashes, verification commands, outputs, and rollback notes to its change ledger.
- [ ] Commit documentation only after all required checks are green:

```powershell
git add docs/superpowers/specs/2026-08-28-platform-stabilization-design.md docs/superpowers/plans/2026-08-28-wave-1-live-safety-implementation-plan.md
git commit -m "docs: close wave 1 live safety rollout"
```

## Wave 1 Acceptance Contract

Wave 1 is complete only when all statements below are evidenced in the canonical tracker:

- LIVE cannot execute with missing/stale/mismatched quant evidence.
- LIVE cannot execute an unapproved or hash-mismatched strategy version.
- A passing canary becomes `LIVE_ELIGIBLE`, not LIVE.
- Owner approval/rejection is explicit, exact-version, transactional, auditable, and non-replayable.
- Eligibility requires accuracy `>=55%`, expectancy `>0`, PF `>=1.3`, Sharpe `>=0.5`, max drawdown `<=10%`, shadow trades `>=100`, and canary trades `>=100`.
- Account sizing continues to use available collateral and low collateral is surfaced as a deduplicated alert.
- Performance records used by learning have start/target candle provenance and bounded timestamp drift.
- Entry drift causes at most one complete deterministic reassessment and at most one second submission attempt.
- DEMO bounded-canary behavior remains available.
- Full tests, lint, typecheck, database generation/migration, and API build pass; any web packaging permission issue is reported precisely.
