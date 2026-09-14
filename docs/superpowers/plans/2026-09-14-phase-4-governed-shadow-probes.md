# Phase 4 Governed Shadow Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simulate recovery plans with execution-equivalent terms and prepare—but do not enable—a capped OKX DEMO probe path.

**Architecture:** Shadow plans use a dedicated executor that shares order-term and outcome semantics with live trading but has no exchange dependency. DEMO eligibility is a pure gate; its feature flag defaults false and this plan does not change that value.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Redis, Vitest

**Spec:** `docs/superpowers/specs/2026-09-14-evidence-aligned-entry-optimization-design.md`

## Global Constraints

- Shadow execution cannot call an exchange adapter or reserve capital.
- `RECOVERY_DEMO_PROBE_ENABLED` defaults to `false`.
- Probe risk is capped at 0.10 of normal risk.
- Production-environment connections are rejected.
- Enabling DEMO probes requires a separate user approval after Phase 5 evidence.

---

### Task 1: Persist immutable shadow execution plans

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260914100000_shadow_execution_plans/migration.sql`
- Create: `apps/api/src/modules/pipeline/application/shadow-plan.service.ts`
- Modify: `apps/api/src/modules/pipeline/infrastructure/pipeline.repository.ts`
- Test: `apps/api/test/pipeline/shadow-plan.spec.ts`

**Interfaces:**
- Produces: `ShadowExecutionPlan` rows and `createPlan(input)`/`finalizePlan(input)` methods.

- [ ] **Step 1: Write failing tests for immutable terms and no exchange dependency**

Assert plan creation requires entry, stop, targets, expiry, costs, cutoff, cohort key, and configuration hash; duplicate evaluation keys return the existing plan.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- shadow-plan.spec.ts`
Expected: FAIL because the model/service is absent.

- [ ] **Step 3: Add the additive Prisma model and migration**

Persist status, direction, prices, quantity/risk fraction, fee/slippage/funding assumptions, gross/net PnL, net R, MFE/MAE, terminal reason, completeness, evaluation key, and version provenance. Add a unique evaluation key; do not rewrite old paper signals.

- [ ] **Step 4: Implement create/finalize transactions without importing exchange clients**

Reject attempts to mutate entry/stop/targets after creation; finalization updates only outcome fields.

- [ ] **Step 5: Validate schema, run tests, and commit**

Run: `pnpm --filter @platform/api exec prisma validate && pnpm --filter @platform/api test -- shadow-plan.spec.ts`
Expected: PASS.

```bash
git add apps/api/prisma apps/api/src/modules/pipeline apps/api/test/pipeline/shadow-plan.spec.ts
git commit -m "feat(shadow): persist immutable recovery plans"
```

### Task 2: Evaluate shadow fills with production-equivalent terms

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/shadow-fill-engine.ts`
- Modify: `apps/api/src/modules/pipeline/application/shadow-plan.service.ts`
- Test: `apps/api/test/pipeline/shadow-fill-engine.spec.ts`

**Interfaces:**
- Produces: `evaluateShadowPlan(plan, candles): ShadowPlanOutcome`.

- [ ] **Step 1: Write failing path tests**

Cover never-filled limit expiry, fill then stop, fill then target, stop/target in the same candle using the conservative stop-first rule, fees/slippage/funding, and incomplete candle history.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- shadow-fill-engine.spec.ts`
Expected: FAIL resolving the engine.

- [ ] **Step 3: Implement deterministic fill/outcome calculation**

Reuse order-type, time-in-force, expiry, stop, target, and cost conventions from live trading. Return gross PnL, each cost component, net PnL, net R, MFE, MAE, duration, terminal reason, and completeness.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @platform/api test -- shadow-fill-engine.spec.ts shadow-plan.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/pipeline apps/api/test/pipeline
git commit -m "feat(shadow): evaluate execution-equivalent recovery outcomes"
```

### Task 3: Add a disabled, bounded DEMO eligibility gate

**Files:**
- Modify: `apps/api/src/config/environment.ts`
- Modify: `.env.example`
- Create: `apps/api/src/modules/risk/domain/recovery-probe-gate.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.ts`
- Test: `apps/api/test/risk/recovery-probe-gate.spec.ts`
- Test: `apps/api/test/live-trading/proactive-demo-connection.spec.ts`

**Interfaces:**
- Produces: `evaluateRecoveryProbe(input): { approved; reason; sizeFactor }`.

- [ ] **Step 1: Write failing gate tests**

Assert disabled flag, production connection, partial/stale/missing/negative evidence, unreliable calibration, open-symbol probe, account count ≥2, cooldown, chase, or failed Risk returns rejected. Assert eligible exact immature evidence returns size factor 0.10 only when explicitly enabled in the test configuration.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- recovery-probe-gate.spec.ts proactive-demo-connection.spec.ts`
Expected: FAIL because the gate/config is absent.

- [ ] **Step 3: Add validated defaults without enabling execution**

```text
RECOVERY_DEMO_PROBE_ENABLED=false
RECOVERY_DEMO_PROBE_MAX_SIZE_FACTOR=0.10
RECOVERY_DEMO_PROBE_MAX_ACCOUNT_POSITIONS=2
RECOVERY_DEMO_PROBE_COOLDOWN_MS=3600000
```

- [ ] **Step 4: Compose the gate into Risk while leaving exchange submission unreachable when disabled**

Use the minimum of all size factors and require an explicitly selected, verified `OKX_FUTURES/DEMO` connection.

- [ ] **Step 5: Run safety tests and commit**

Run: `pnpm --filter @platform/api test -- recovery-probe-gate.spec.ts proactive-demo-connection.spec.ts live-trading-safety.spec.ts`
Expected: PASS and production connections remain rejected.

```bash
git add .env.example apps/api/src/config apps/api/src/modules/risk apps/api/test
git commit -m "feat(risk): add disabled governed recovery probe gate"
```
