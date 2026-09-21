# Proactive Trading Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the broken proactive AI lifecycle and complete the bounded calibration/probe and market-causality work needed for safe SHADOW/DEMO participation.

**Architecture:** Make the shared pipeline ID contract authoritative for both standard and proactive pipelines, then test the real scheduler-to-trigger validation boundary. Treat fallback calibration as telemetry rather than exact execution evidence while preserving exact negative cohort blocks, and express reduced authority through the existing execution-context `PROBE` path capped at 0.15R. Expose deterministic volume/OI/funding causality without fabricating unavailable liquidation or news evidence.

**Tech Stack:** TypeScript, NestJS, Zod, Prisma, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-20-latency-aware-breakout-participation-design.md`

## Global Constraints

- Do not enable LIVE trading or weaken protection, account-risk, stale-core-data, liquidity, macro-blackout, or exchange-preflight gates.
- AI output remains advisory; final sizing and authorization remain deterministic.
- PROBE is allowed only in SHADOW/DEMO and is capped at 0.15 of normal risk.
- Missing liquidation, news, social, or on-chain evidence must remain explicit and must not be synthesized.
- No production replay, migration, exchange call, push, or deployment is part of this plan.

---

### Task 1: Restore the proactive pipeline contract end to end

**Files:**
- Modify: `packages/shared/src/schemas/pipeline.ts`
- Modify: `packages/shared/test/pipeline.spec.ts`
- Modify: `apps/api/test/pipeline/opportunity-watcher.spec.ts`

**Interfaces:**
- Produces: `PipelineIdSchema = z.enum(["FULL_ANALYSIS_DECISION", "proactive-thesis"])`.
- Proves: scheduler output parses through `PipelineRunRequestSchema`, preventing mocks from hiding an invalid request.

- [ ] Add a shared-schema test that parses `proactive-thesis` and still rejects unknown pipeline IDs.
- [ ] Add a scheduler regression whose trigger fake runs every request through `PipelineRunRequestSchema` before accepting it.
- [ ] Run both tests and verify RED with the current literal-only schema.
- [ ] Replace the literal pipeline schema with the two-value enum; preserve the existing default.
- [ ] Run shared pipeline and opportunity-watcher tests and verify GREEN.

### Task 2: Make fallback calibration non-authoritative and route strong setups to bounded PROBE

**Files:**
- Create: `apps/api/src/modules/agents/domain/calibration-authority.ts`
- Create: `apps/api/test/agents/calibration-authority.spec.ts`
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.ts`
- Modify: `apps/api/test/agents/decision.service.spec.ts`
- Modify: `apps/api/test/risk/risk-engine.spec.ts`

**Interfaces:**
- Produces: `resolveCalibrationAuthority(calibration, decisionFacts)` returning `EXACT_BLOCK`, `PROBE_TELEMETRY`, or `NEUTRAL` plus governed EV/PF behavior.
- Consumes: confidence, directional agreement, opportunity score, execution context, and exact/fallback calibration metadata.

- [ ] Write domain tests proving exact mature negative evidence blocks, global/strategy fallback never becomes exact EV/PF, and a strong directional fallback candidate receives only `PROBE_TELEMETRY`.
- [ ] Run the domain test and verify RED because the authority resolver does not exist.
- [ ] Implement the pure resolver with explicit exact/fallback semantics.
- [ ] Integrate it in both `decideWithLearning` and `calibrateForExecution`, removing duplicated fallback-negative logic.
- [ ] Add decision regression coverage for fallback probability `0.3125`: direction is preserved, no calibrated blocker is emitted, and execution context is reduced to PROBE only when strong-conviction requirements are met.
- [ ] Change deterministic risk sizing so PROBE caps `sizeFactor` at `0.15`; add the boundary test and verify it does not affect normal entries.
- [ ] Run focused Decision/Judge/Risk tests and verify GREEN.

### Task 3: Add deterministic causality metrics without invented evidence

**Files:**
- Create: `apps/api/src/modules/ai-tools/domain/market-causality.ts`
- Create: `apps/api/test/ai-tools/market-causality.spec.ts`
- Modify: `apps/api/src/modules/ai-tools/infrastructure/tools/market-tools.ts`
- Modify: `apps/api/test/ai-tools-market-news.spec.ts`

**Interfaces:**
- Produces: `calculateMarketCausality({ candles, openInterest, funding })` with `volumeRatio`, `priceChangePercent`, `deltaOi`, `deltaOiPercent`, `squeezeIndicator`, `causality`, and `missingEvidence`.
- `squeezeIndicator`: `SHORT_SQUEEZE`, `LONG_BUILDUP`, `DISTRIBUTION`, `DELEVERAGING`, or `NONE`.
- `causality`: deterministic explanation; liquidation remains listed in `missingEvidence` until a real provider exists.

- [ ] Write table-driven tests for high-volume price/OI expansion with negative funding, price/OI expansion with positive funding, price up/OI down, insufficient candle/OI history, and zero average volume.
- [ ] Run the domain test and verify RED because the calculator does not exist.
- [ ] Implement finite-value normalization and deterministic classifications.
- [ ] Add `volumeRatio` to the indicator/candle-facing output and add a read-only `market.causality.get` tool that loads candles, OI, and funding concurrently.
- [ ] Add tool tests proving missing OI/funding is reported and never replaced with bullish evidence.
- [ ] Run focused AI-tool tests and verify GREEN.

### Task 4: Close the vacuous-pass testing gap and verify the branch

**Files:**
- Modify: `apps/api/test/audit/trading-system-checklist.spec.ts`
- Modify: `docs/superpowers/plans/2026-09-20-proactive-trading-completion.md`

**Interfaces:**
- Proves: watchable transitions plus zero proactive runs cannot be reported as a successful rollout.

- [ ] Add a regression fixture with a watchable transition and invalid proactive request; assert the audit fails with explicit scheduling evidence.
- [ ] Run the audit test and verify RED if the current fixture can pass vacuously.
- [ ] Make the minimal test/audit-contract correction required for non-empty lifecycle evidence.
- [ ] Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`.
- [ ] Review the diff for LIVE enablement, weakened hard gates, fabricated external evidence, secrets, and unrelated edits.
- [ ] Mark only evidenced steps complete; leave deployment and production replay outside this plan.
