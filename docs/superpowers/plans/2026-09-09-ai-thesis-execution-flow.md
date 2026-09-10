# AI Thesis and Execution Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI create auditable trade theses and allow validated theses to reach deterministic Risk in shadow and DEMO modes.

**Architecture:** A Researcher produces structured competing theses from one anticipatory snapshot; a Critic returns a bounded review action. Pure validators check evidence references and trade geometry before the existing Risk Engine and exchange guards receive a decision.

**Tech Stack:** TypeScript, NestJS, existing AI orchestrator, Zod, Prisma, BullMQ, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-proactive-ai-trading-design.md`

## Global Constraints

- AI never calls the exchange, chooses unrestricted leverage, removes protection, or overrides account limits.
- AI output is executable only after strict schema, evidence, freshness, geometry and risk validation.
- A critic cannot reverse direction; a contrary direction requires a new Researcher thesis.
- Provider failure uses an explicitly labeled rules fallback.
- Initial influence is shadow; DEMO requires a feature flag. LIVE remains disabled.

---

### Task 1: Define and validate TradeThesis

**Files:**
- Modify: `packages/shared/src/schemas/agents.ts`
- Create: `apps/api/src/modules/agents/domain/trade-thesis-validator.ts`
- Test: `apps/api/test/agents/trade-thesis-validator.spec.ts`

**Interfaces:**
- Produces: `TradeThesisSchema`; `validateTradeThesis(thesis, snapshot): ThesisValidationResult`.

- [ ] Write failing cases for missing invalidation, inverted LONG/SHORT geometry, unsupported evidence refs, expired thesis, expected net R below policy and price beyond `maximumChaseDistanceAtr`.
- [ ] Run the targeted test and verify failure.
- [ ] Implement the strict schema from the spec and a pure validator returning stable reason codes: `THESIS_STALE`, `EVIDENCE_REF_INVALID`, `GEOMETRY_INVALID`, `NET_R_TOO_LOW`, `ENTRY_TOO_LATE`, `PROTECTION_REQUIRED`.
- [ ] Run shared/API tests and commit with `feat(ai): add executable trade thesis contract`.

### Task 2: AI Researcher with explicit rules fallback

**Files:**
- Create: `apps/api/src/modules/agents/application/services/trade-researcher.service.ts`
- Create: `apps/api/src/modules/agents/domain/prompts/trade-researcher.prompt.ts`
- Modify: `apps/api/src/modules/agents/agents.module.ts`
- Test: `apps/api/test/agents/trade-researcher.service.spec.ts`

**Interfaces:**
- Produces: `research(snapshot, context): Promise<{ preferred: TradeThesis; alternatives: TradeThesis[] }>`.

- [ ] Write tests for valid LONG/SHORT/WAIT alternatives, evidence-ref rejection, timeout fallback and `decisionSource` labeling.
- [ ] Run the test and verify failure.
- [ ] Build a prompt containing only the versioned snapshot and cohort summary. Require structured JSON and at most one thesis per direction.
- [ ] Parse through `TradeThesisSchema`; on provider/parse failure call the current rules Decision adapter and label it `AI_WITH_RULES_FALLBACK`.
- [ ] Persist model, provider, prompt version, config hash and parent snapshot ID; run tests/typecheck and commit with `feat(ai): generate proactive trade theses`.

### Task 3: Replace Reflection veto with bounded Critic review

**Files:**
- Modify: `apps/api/src/modules/agents/application/services/chain-of-thought-reflection.service.ts`
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Test: `apps/api/test/chain-of-thought-reflection.spec.ts`

**Interfaces:**
- Produces: `ThesisReview { action: APPROVE | REDUCE_SIZE | REQUIRE_TRIGGER | CANCEL; sizeFactor?; reasonCodes; evidenceRefs; rationale }`.

- [ ] Write failing tests proving `adjustedDecision` is absent, scenario/thesis geometry reaches the critic, and a contrary opinion cannot reverse direction.
- [ ] Run the test and verify failure.
- [ ] Replace trap-only branching with `ThesisReviewSchema`. Store concise rationale and references; do not require hidden chain-of-thought text.
- [ ] Apply `REDUCE_SIZE` as a bounded factor and `REQUIRE_TRIGGER` as WATCHING; only `CANCEL` produces WAIT.
- [ ] Run Decision/Reflection suites and commit with `refactor(ai): review complete trading theses`.

### Task 4: Severity-based evidence gates

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/decision-judge.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts`
- Create: `apps/api/src/modules/pipeline/domain/evidence-gate.ts`
- Test: `apps/api/test/pipeline/evidence-gate.spec.ts`
- Test: `apps/api/test/pipeline/quant-execution-policy.spec.ts`

**Interfaces:**
- Produces: `EvidenceGateResult { severity: BLOCK | REDUCE_SIZE | APPROVE; sizeFactor; reasons }`.

- [ ] Write a decision table covering stale core data, unsafe geometry, negative exact cohort, new cohort, assumption mismatch in SHADOW/DEMO/LIVE and valid exact evidence.
- [ ] Run tests and verify failure.
- [ ] Map safety/config violations to BLOCK, uncertain/new evidence to REDUCE_SIZE in shadow/DEMO, and proven compatible evidence to APPROVE. Keep assumption mismatch blocked for full-size LIVE.
- [ ] Compose all reduction factors once with a configured minimum/maximum; never bypass a BLOCK.
- [ ] Run gate suites and commit with `feat(pipeline): grade thesis evidence gates`.

### Task 5: Route snapshots and staged entries through Pipeline and Risk

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/risk/domain/trade-plan-engine.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.ts`
- Modify: `apps/api/src/modules/live-trading/application/live-trading.service.ts`
- Test: `apps/api/test/pipeline/proactive-thesis.integration.spec.ts`
- Test: `apps/api/test/risk/staged-entry-risk.spec.ts`

**Interfaces:**
- Consumes: snapshot, preferred thesis and review.
- Produces: WATCHING/no-order, PROBE order at 20–25% risk, CONFIRMED add bounded by combined 0.50% default risk, or deterministic rejection.

- [ ] Write integration tests for sideway boundary entry, squeeze probe, confirmation add, failed invalidation, chase rejection and combined-risk cap.
- [ ] Run tests and verify failure.
- [ ] Pass real current price, ATR, support/resistance, `squeezeState`, liquidity sweep and derivatives imbalance into Decision, scenarios and Trade Plan.
- [ ] Add staged-entry metadata to risk assessment and orders. Calculate worst-case loss across probe plus add; prohibit unplanned averaging down.
- [ ] Guard behavior with `PROACTIVE_AI_MODE=OBSERVE|SHADOW|DEMO`, default `OBSERVE`; reject `DEMO` without a verified demo connection.
- [ ] Run pipeline/risk/live-trading suites, typecheck and commit with `feat(trading): execute governed staged theses in demo`.

### Task 6: Flow verification

- [ ] Run `pnpm --filter @platform/api exec vitest run test/agents/trade-researcher.service.spec.ts test/chain-of-thought-reflection.spec.ts test/pipeline/evidence-gate.spec.ts test/pipeline/proactive-thesis.integration.spec.ts test/risk/staged-entry-risk.spec.ts`.
- [ ] Run `pnpm test`, `pnpm typecheck` and `pnpm lint`.
- [ ] Replay known squeeze, false-breakout and range-bound fixtures; assert OBSERVE leaves existing execution unchanged and DEMO never exceeds the combined risk budget.
- [ ] Commit verification fixtures with `test: verify proactive AI decision flow`.

