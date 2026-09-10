# Trade Lifecycle Evaluation and Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure proactive AI using executable trade lifecycles and promote only frozen versions that outperform the rules baseline after costs.

**Architecture:** A portfolio-aware replay consumes persisted snapshots, theses, reviews and candles, then runs the same Risk, Trade Plan and Position Manager rules as DEMO. Lifecycle outcomes feed cohort calibration and an explicit promotion state machine.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, existing research/reflection modules, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-proactive-ai-trading-design.md`

## Global Constraints

- No future data may cross a replay cutoff.
- Entry occurs no earlier than the next executable observation.
- Fees, slippage, funding, entry TTL, gaps, partial exits, trailing and portfolio concurrency are included.
- Ambiguous same-candle SL/TP uses stop-first unless finer data resolves ordering.
- Promotion freezes model, prompt, config and code/calculation versions; LIVE activation remains manual.

---

### Task 1: Persist immutable lifecycle records

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260909000002_add_trade_thesis_lifecycle/migration.sql`
- Create: `apps/api/src/modules/research/domain/trade-lifecycle.ts`
- Test: `apps/api/test/research/trade-lifecycle.spec.ts`

**Interfaces:**
- Produces append-only `TradeThesis`, `ThesisReview`, `ExecutionPlanVersion`, `OpportunityTransition`, `TradeLifecycleOutcome` records and `aggregateLifecycle(events)`.

- [ ] Write a failing lifecycle test with probe, add, partial, stop tightening and final close; assert one lifecycle outcome and correct signed fees/funding.
- [ ] Run the test and verify failure.
- [ ] Add Prisma models with parent/version IDs, source cutoff and configuration hash. Prevent mutation of finalized outcomes at repository level.
- [ ] Implement lifecycle aggregation by thesis rather than order; run migration/schema tests and commit with `feat(research): persist trade thesis lifecycles`.

### Task 2: Portfolio-aware execution replay

**Files:**
- Create: `apps/api/src/modules/research/domain/execution-replay-engine.ts`
- Modify: `apps/api/src/modules/research/application/research.service.ts`
- Test: `apps/api/test/research/execution-replay-engine.spec.ts`

**Interfaces:**
- Produces: `replayExecution(input: ExecutionReplayInput): ExecutionReplayReport`.

- [ ] Write failing tests for next-observation entry, unfilled limit TTL, stop-first ambiguity, funding, entry drift, concurrent-symbol exposure and Position Manager partial/trailing behavior.
- [ ] Run tests and verify failure.
- [ ] Implement an event-ordered account simulator that calls existing Risk, Trade Plan and Position Manager functions. Emit equity at every candle/mark event, not only trade close.
- [ ] Add deterministic execution assumptions and dataset provenance to the report; run tests and commit with `feat(research): replay complete execution lifecycles`.

### Task 3: Cohort calibration and AI lift

**Files:**
- Create: `apps/api/src/modules/reflection/domain/thesis-cohort.ts`
- Modify: `apps/api/src/modules/reflection/domain/confidence-calibration.ts`
- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Test: `apps/api/test/reflection/thesis-cohort.spec.ts`

**Interfaces:**
- Produces cohort key `symbol|timeframe|regime|direction|setup|executionPolicyVersion`; compares rules, AI Researcher and AI+Critic.

- [ ] Write failing tests proving BNB/SOL history cannot hard-block ZEC and overlapping updates from one thesis count once.
- [ ] Run tests and verify failure.
- [ ] Calibrate from finalized lifecycle outcomes in net R. Implement hierarchical fallback that returns REDUCE_SIZE, never full approval, when exact evidence is insufficient.
- [ ] Calculate critic avoided-loss, missed-win and net lift on paired candidates; run tests and commit with `feat(reflection): calibrate thesis lifecycle cohorts`.

### Task 4: Promotion state machine and reports

**Files:**
- Create: `apps/api/src/modules/reflection/domain/model-promotion-policy.ts`
- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Modify: `apps/api/src/modules/reflection/application/performance.service.ts`
- Test: `apps/api/test/reflection/model-promotion-policy.spec.ts`

**Interfaces:**
- Produces `OBSERVE -> SHADOW -> DEMO_CANARY -> ELIGIBLE -> APPROVED_LIVE_CANARY`; rollback returns to SHADOW.

- [ ] Write failing transition tests for insufficient sample, PF/expectancy failure, drawdown breach, protection failure, model drift, explicit approval and rollback.
- [ ] Run tests and verify failure.
- [ ] Require predefined thresholds and untouched forward sample IDs. Store eligible configuration hash; require a distinct explicit approval record before LIVE canary.
- [ ] Replace fixed-horizon shadow headline metrics with lifecycle expectancy, PF, mark-to-market drawdown, chase rate and cohort stability. Keep legacy metrics labeled separately during migration.
- [ ] Run tests and commit with `feat(reflection): govern proactive model promotion`.

### Task 5: End-to-end validation and operating guide

**Files:**
- Create: `apps/api/test/research/proactive-ai-forward-replay.integration.spec.ts`
- Create: `docs/operations/proactive-ai-trading.md`

- [ ] Build a frozen dataset containing sideway, accumulation, breakout, fakeout and trend exhaustion periods; record source cutoff and checksum.
- [ ] Write the integration test comparing rules-only, AI Researcher and AI+Critic under identical execution assumptions.
- [ ] Run it and require: no look-ahead, zero protection omissions, zero risk-limit breaches, reported paired lift and explicit uncertainty intervals. Do not encode a guaranteed-profit assertion.
- [ ] Document feature modes, monitoring, rollback, reconciliation and the separate manual steps for strategy approval and production connection.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`; commit with `test: validate proactive AI lifecycle and promotion`.
