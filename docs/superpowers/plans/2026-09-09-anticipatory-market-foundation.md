# Anticipatory Market Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and persist look-ahead-safe anticipatory snapshots and opportunity states without changing current trading decisions.

**Architecture:** A pure builder combines versioned closed-candle indicators, confirmed liquidity structure, derivatives history and source provenance. A persistent watcher applies deterministic state transitions while the current pipeline continues to execute unchanged.

**Tech Stack:** TypeScript 5.8, NestJS 11, Prisma 6, PostgreSQL, Redis, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-proactive-ai-trading-design.md`

## Global Constraints

- Use only observations whose timestamp is at or before `sourceDataCutoff`.
- Missing optional evidence is `UNAVAILABLE`; never convert it to neutral evidence.
- Market and Technical evidence must be fresh for a snapshot to be eligible.
- This plan must not affect Decision, Risk, order submission, or LIVE configuration.
- Every persisted artifact includes calculation/schema version and source timestamps.

---

### Task 1: Shared anticipatory contracts

**Files:**
- Modify: `packages/shared/src/schemas/agents.ts`
- Test: `packages/shared/test/anticipatory-market-snapshot.spec.ts`

**Interfaces:**
- Produces: `AnticipatoryMarketSnapshotSchema`, `OpportunityStateSchema`, `EvidenceRefSchema` and their inferred types.

- [ ] Write a failing test that accepts a complete snapshot, rejects future-dated evidence, and preserves `UNAVAILABLE` coverage.
- [ ] Run `pnpm --filter @platform/shared test -- anticipatory-market-snapshot.spec.ts`; expect failure because the schemas do not exist.
- [ ] Add strict Zod schemas. Define `OpportunityState` as `OBSERVING | WATCHING | PROBE_READY | PROBE_OPEN | CONFIRMED | POSITION_OPEN | INVALIDATED | EXPIRED | TOO_LATE`; require `sourceDataCutoff`, `schemaVersion`, `calculationVersion`, structure, volatility, momentum, participation, derivatives, context and execution sections.
- [ ] Export types and run the targeted test; expect pass.
- [ ] Run `pnpm --filter @platform/shared typecheck` and commit with `feat(shared): add anticipatory market contracts`.

### Task 2: Build look-ahead-safe structure and indicator evidence

**Files:**
- Create: `apps/api/src/modules/agents/domain/analysis/anticipatory-snapshot-builder.ts`
- Modify: `apps/api/src/market-data/domain/indicators/indicator-calculator.ts`
- Modify: `apps/api/src/modules/agents/domain/analysis/liquidity-sweep-hunter.ts`
- Test: `apps/api/test/agents/anticipatory-snapshot-builder.spec.ts`
- Test: `apps/api/test/liquidity-sweep-hunter.spec.ts`

**Interfaces:**
- Consumes: `buildAnticipatoryMarketSnapshot(input: AnticipatorySnapshotInput): AnticipatoryMarketSnapshot`.
- Produces: confirmed pivots/range boundaries, `squeezeState`, ATR percentile, RSI/MACD values at matched pivots and chase distance.

- [ ] Write fixtures where a future right-hand candle would change a pivot; assert the builder cannot see it at the earlier cutoff.
- [ ] Run the two tests; expect the new builder test to fail.
- [ ] Implement `buildAnticipatoryMarketSnapshot` as a pure function. Slice every input series at the cutoff; confirm a pivot only after `pivotStrength` right-side bars; calculate divergence from stored oscillator series at the two confirmed pivots.
- [ ] Remove wick-only sweep classification: require a known zone, penetration and close reclaim. Return explicit no-signal evidence when requirements fail.
- [ ] Run targeted tests and `pnpm --filter @platform/api typecheck`; commit with `feat(analysis): build anticipatory market snapshots`.

### Task 3: Connect derivatives and provenance

**Files:**
- Modify: `apps/api/src/modules/agents/domain/analysis/derivatives-imbalance-predictor.ts`
- Create: `apps/api/src/modules/agents/application/services/anticipatory-snapshot.service.ts`
- Modify: `apps/api/src/modules/agents/agents.module.ts`
- Test: `apps/api/test/agents/anticipatory-snapshot.service.spec.ts`

**Interfaces:**
- Produces: `AnticipatorySnapshotService.build({ userId, provider, symbol, timeframe, sourceDataCutoff })`.

- [ ] Write a failing service test with funding/OI history, stale optional data and a frozen cutoff; assert no query requests rows after the cutoff.
- [ ] Run the test and verify failure.
- [ ] Load closed candles, indicator snapshot, funding history, OI history and available context concurrently. Pass actual histories into `predictDerivativesImbalance`; return `UNAVAILABLE` when minimum samples are absent.
- [ ] Register the service and persist the serialized snapshot through a repository method keyed by provider, symbol, timeframe and cutoff.
- [ ] Run targeted tests, API typecheck and commit with `feat(analysis): connect anticipatory evidence sources`.

### Task 4: Persist opportunity state in observe mode

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260909000001_add_opportunity_watcher/migration.sql`
- Create: `apps/api/src/modules/pipeline/domain/opportunity-state-machine.ts`
- Create: `apps/api/src/modules/pipeline/application/opportunity-watcher.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-scheduler.service.ts`
- Test: `apps/api/test/pipeline/opportunity-state-machine.spec.ts`
- Test: `apps/api/test/pipeline/opportunity-watcher.spec.ts`

**Interfaces:**
- Produces: `transitionOpportunity(current, snapshot, now): OpportunityTransition` and `OpportunityWatcherService.observe(...)`.

- [ ] Write state-table tests for `OBSERVING -> WATCHING`, `WATCHING -> PROBE_READY`, expiry, invalidation and `TOO_LATE`; include duplicate-candle idempotency.
- [ ] Run tests and verify failure.
- [ ] Add append-only `anticipatory_market_snapshots`, `opportunities` and `opportunity_transitions` models. Add unique idempotency on opportunity, transition and candle cutoff.
- [ ] Implement deterministic transitions. The scheduler calls `observe` after a closed primary candle; no state in this plan may call Decision or execution.
- [ ] Run `pnpm db:generate`, targeted tests, API typecheck and migration validation; commit with `feat(pipeline): observe anticipatory opportunities`.

### Task 5: Foundation verification

- [ ] Run `pnpm --filter @platform/shared test` and `pnpm --filter @platform/api exec vitest run test/agents/anticipatory-snapshot-builder.spec.ts test/agents/anticipatory-snapshot.service.spec.ts test/pipeline/opportunity-state-machine.spec.ts test/pipeline/opportunity-watcher.spec.ts`.
- [ ] Run `pnpm typecheck` and `pnpm lint`.
- [ ] Run a read-only historical replay and assert snapshot evidence never exceeds its cutoff, every state transition is idempotent, and current pipeline decision counts are unchanged.
- [ ] Commit any verification fixture updates with `test: verify anticipatory observe mode`.
