# Phase 2 Exact Quant Cohorts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ensure Quant evidence authorizes only the exact execution cohort and stop presenting signal strength as calibrated probability.

**Architecture:** A pure cohort matcher classifies exact, partial, stale, missing, immature, positive, and negative evidence. Quant policy consumes that classification; Decision exposes separate signal, probability, net-R, and calibration-quality fields without removing legacy fields until consumers migrate.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-09-14-evidence-aligned-entry-optimization-design.md`

## Global Constraints

- A 1h validation cannot authorize a 15m decision.
- Partial, stale, missing, or unreliable evidence remains shadow-only.
- Mature negative exact evidence remains blocked.
- This phase does not enable new exchange execution.

---

### Task 1: Exact execution-cohort matcher

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/execution-cohort.ts`
- Test: `apps/api/test/pipeline/execution-cohort.spec.ts`

**Interfaces:**
- Produces: `ExecutionCohortKey`, `CohortEvidenceStatus`, and `classifyExecutionEvidence(request, validation, now)`.

- [x] **Step 1: Write table-driven failing tests**

Cover exact mature positive, exact immature, direction mismatch, regime mismatch, timeframe mismatch, execution-policy mismatch, stale, missing, and mature negative cases. Assert 1h/15m returns `PARTIAL_MATCH`.

- [x] **Step 2: Run the focused test**

Run: `pnpm --filter @platform/api test -- execution-cohort.spec.ts`
Expected: FAIL resolving the new module.

- [x] **Step 3: Implement deterministic field comparison and maturity thresholds**

```ts
type CohortEvidenceStatus = 'EXACT_MATURE_POSITIVE' | 'EXACT_IMMATURE' | 'PARTIAL_MATCH' | 'EXACT_MATURE_NEGATIVE' | 'STALE' | 'MISSING';
```

Read direction, regime, execution policy, configuration version, trade counts, and cost assumptions from `metricsJson`; missing identity fields cannot be exact.

- [x] **Step 4: Run tests and commit**

Run: `pnpm --filter @platform/api test -- execution-cohort.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/pipeline/domain/execution-cohort.ts apps/api/test/pipeline/execution-cohort.spec.ts
git commit -m "feat(quant): classify exact execution cohorts"
```

### Task 2: Enforce cohort status in Quant policy

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts`
- Test: `apps/api/test/pipeline/quant-execution-policy.spec.ts`
- Test: `apps/api/test/audit/trading-system-checklist.spec.ts`

**Interfaces:**
- Consumes: `classifyExecutionEvidence` from Task 1.
- Produces: `QuantExecutionPolicyResult.evidenceStatus` and `matchedCohort`.

- [x] **Step 1: Add failing policy tests for 1h/15m mismatch and negative exact evidence**

```ts
expect(result.evidenceStatus).toBe('PARTIAL_MATCH');
expect(result.allowed).toBe(false);
expect(result.reason).toBe('QUANT_ASSUMPTION_MISMATCH');
```

- [x] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- quant-execution-policy.spec.ts trading-system-checklist.spec.ts`
Expected: FAIL because status is not exposed and mismatch fallback remains ambiguous.

- [x] **Step 3: Replace implicit latest-row fallback with exact status handling**

Map `EXACT_MATURE_POSITIVE` to existing approve gates, `EXACT_IMMATURE` to shadow reduction, `PARTIAL_MATCH` to assumption mismatch, `STALE` to stale, `MISSING` to missing, and `EXACT_MATURE_NEGATIVE` to a deterministic block reason.

- [x] **Step 4: Run tests and commit**

Run: `pnpm --filter @platform/api test -- quant-execution-policy.spec.ts trading-system-checklist.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts apps/api/test/pipeline/quant-execution-policy.spec.ts apps/api/test/audit/trading-system-checklist.spec.ts
git commit -m "fix(quant): enforce exact execution evidence cohorts"
```

### Task 3: Separate signal, probability, expected net R, and calibration quality

**Files:**
- Modify: `packages/shared/src/schemas/agents.ts`
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Modify: `apps/api/src/modules/reflection/domain/confidence-calibration.ts`
- Modify: `apps/api/src/modules/risk/application/decision-risk-policy.service.ts`
- Test: `apps/api/test/agents/decision.service.spec.ts`
- Test: `apps/api/test/reflection/confidence-calibration.spec.ts`
- Test: `apps/api/test/risk/risk-engine.spec.ts`

**Interfaces:**
- Produces: `executionEvidence: { signalStrength; estimatedWinProbability?; expectedNetR?; calibrationQuality }` on Decision output.

- [x] **Step 1: Write failing schema and policy tests**

Assert that an 85 signal strength with unreliable calibration does not become 85% win probability, and that Risk reads `expectedNetR` for the EV gate when present.

- [x] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- decision.service.spec.ts confidence-calibration.spec.ts risk-engine.spec.ts`
Expected: FAIL because `executionEvidence` is absent.

- [x] **Step 3: Add the backward-compatible shared schema and populate it in calibration**

Calculate `expectedNetR` from structural reward/loss and cost inputs; omit probability when calibration is insufficient rather than copying confidence.

- [x] **Step 4: Make Risk fail closed on missing/unreliable execution probability where required**

Preserve the legacy path behind existing behavior until all callers provide `executionEvidence`; emit provenance showing which path was used.

- [x] **Step 5: Run shared and API tests, then commit**

Run: `pnpm --filter @platform/shared test && pnpm --filter @platform/api test -- decision.service.spec.ts confidence-calibration.spec.ts risk-engine.spec.ts`
Expected: PASS.

```bash
git add packages/shared/src/schemas/agents.ts apps/api/src/modules/agents apps/api/src/modules/reflection apps/api/src/modules/risk apps/api/test
git commit -m "feat(decision): separate execution evidence metrics"
```
