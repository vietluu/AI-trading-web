# Phase 3 Recovery Reclaim State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect liquidity-sweep recovery entries from closed candles without direction flipping or chasing resistance.

**Architecture:** Extend the existing Opportunity state machine and snapshot contracts rather than creating a parallel engine. A pure recovery classifier supplies evidence to OpportunityWatcher; pipeline Decision consumes only persisted transitions tied to a source-data cutoff.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-09-14-evidence-aligned-entry-optimization-design.md`

## Global Constraints

- Recovery confirmation requires a closed primary candle.
- One candle advances at most one executable state.
- Direction reversal requires invalidation and a newer candle cutoff.
- Recovery behavior is shadow-only.

---

### Task 1: Recovery evidence classifier

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/recovery-reclaim.ts`
- Test: `apps/api/test/pipeline/recovery-reclaim.spec.ts`

**Interfaces:**
- Produces: `RecoveryEvidence`, `RecoveryState`, and `evaluateRecoveryTransition(previous, input)`.

- [ ] **Step 1: Write failing fixtures for sweep, reclaim, confirmation, chase, invalidation, and same-candle flip**

Use explicit OHLC arrays where the final candle is marked closed/unfinished; assert unfinished candles never return `MOMENTUM_CONFIRMED`.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @platform/api test -- recovery-reclaim.spec.ts`
Expected: FAIL resolving the module.

- [ ] **Step 3: Implement the pure transition function**

```ts
type RecoveryState = 'RANGING' | 'LIQUIDITY_SWEEP' | 'RECLAIM_PENDING' | 'MOMENTUM_CONFIRMED' | 'BREAKOUT' | 'TRENDING' | 'INVALIDATED' | 'EXPIRED';
```

Inputs include persisted support/resistance, EMA reclaim level, ATR, closed-candle flag, opposite-break flag, maximum chase ATR, expected net R, event conflict, cutoff, and expiry.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @platform/api test -- recovery-reclaim.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/pipeline/domain/recovery-reclaim.ts apps/api/test/pipeline/recovery-reclaim.spec.ts
git commit -m "feat(pipeline): model recovery reclaim transitions"
```

### Task 2: Persist recovery transitions through OpportunityWatcher

**Files:**
- Modify: `packages/shared/src/schemas/research.ts`
- Modify: `apps/api/src/modules/pipeline/domain/opportunity-state-machine.ts`
- Modify: `apps/api/src/modules/pipeline/application/opportunity-watcher.service.ts`
- Modify: `apps/api/src/modules/agents/application/anticipatory-snapshot.service.ts`
- Test: `apps/api/test/pipeline/opportunity-state-machine.spec.ts`
- Test: `apps/api/test/pipeline/opportunity-watcher.spec.ts`
- Test: `apps/api/test/agents/anticipatory-snapshot.service.spec.ts`

**Interfaces:**
- Consumes: `evaluateRecoveryTransition` from Task 1.
- Produces: versioned `OpportunityTransition` reason codes and evidence in the existing transition record.

- [ ] **Step 1: Add failing tests for legal persistence and idempotent cutoff handling**

Assert two triggers with one cutoff create one transition and an opposite direction at the same cutoff is rejected as `CONDITIONS_UNCHANGED`.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- opportunity-state-machine.spec.ts opportunity-watcher.spec.ts anticipatory-snapshot.service.spec.ts`
Expected: FAIL because recovery states/reasons are absent.

- [ ] **Step 3: Extend shared snapshot evidence and map recovery states onto existing Opportunity states**

Use `WATCHING` for sweep/reclaim observation and `PROBE_READY` for confirmed shadow candidates; persist detailed recovery state and structural levels in transition/thesis JSON without changing the Prisma enum.

- [ ] **Step 4: Persist transition evidence and versions using existing idempotency keys**

Store cutoff, level, ATR distance, candle finality, invalidation, expiry, evidence for/against, and configuration hash.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @platform/shared test && pnpm --filter @platform/api test -- opportunity-state-machine.spec.ts opportunity-watcher.spec.ts anticipatory-snapshot.service.spec.ts`
Expected: PASS.

```bash
git add packages/shared/src/schemas/research.ts apps/api/src/modules/pipeline apps/api/src/modules/agents apps/api/test
git commit -m "feat(pipeline): persist recovery reclaim opportunities"
```

### Task 3: Feed confirmed recovery candidates into Decision in shadow

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Modify: `apps/api/src/modules/risk/domain/trade-plan-engine.ts`
- Test: `apps/api/test/pipeline/proactive-thesis.integration.spec.ts`
- Test: `apps/api/test/agents/decision.service.spec.ts`
- Test: `apps/api/test/risk/trade-plan-engine.spec.ts`

**Interfaces:**
- Consumes: persisted `PROBE_READY` recovery evidence.
- Produces: `setup='RECOVERY_RECLAIM'`, immutable trigger/invalidation/expiry, and shadow-only execution context.

- [ ] **Step 1: Add a failing end-to-end shadow test**

Build closed candles for sweep → reclaim → confirmation and assert Decision creates a recovery candidate; rerun with an unfinished confirmation candle and assert WAIT.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @platform/api test -- proactive-thesis.integration.spec.ts decision.service.spec.ts trade-plan-engine.spec.ts`
Expected: FAIL because recovery setup is unsupported.

- [ ] **Step 3: Add recovery setup selection without overriding canonical regime/location**

Decision must include `usesClosedPrimaryCandle=true`, trigger price, structural stop, targets, expiry, chase distance, and expected net R. Trade Plan validates these terms but cannot reclassify the setup.

- [ ] **Step 4: Force the new setup to SHADOW regardless of deployment trading mode**

Record `RECOVERY_SHADOW_ONLY` as an execution gate until Phase 4/5 evidence gates are separately approved.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @platform/api test -- proactive-thesis.integration.spec.ts decision.service.spec.ts trade-plan-engine.spec.ts`
Expected: PASS.

```bash
git add apps/api/src/modules/pipeline apps/api/src/modules/agents apps/api/src/modules/risk apps/api/test
git commit -m "feat(pipeline): evaluate recovery candidates in shadow"
```
