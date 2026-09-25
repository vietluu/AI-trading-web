# Profit-First Practical Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the proactive thesis lifecycle and authorize only economically justified DEMO exposure under an 8%/12%/15% drawdown policy.

**Architecture:** Preserve AI ownership of thesis direction and entry geometry, then apply deterministic lifecycle, profitability, and account-risk policies at explicit boundaries. Persist one lifecycle per thesis, use lightweight market observations to execute persisted theses, and treat fallback calibration as probe telemetry rather than full-size authority or a hidden blocker.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Zod, Vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-09-21-profit-first-practical-trading-design.md`

## Global Constraints

- DEMO and shadow only; this plan must not enable or promote LIVE execution.
- Maximum account drawdown is 15%; reduce risk at 8% and restrict to diagnostic probes at 12%.
- Probe exposure is at most 0.15 of normal per-trade risk, and at most 0.10 at drawdown of 12% or more.
- Exact cohort evidence is the only performance evidence allowed to authorize full size or hard-block a cohort.
- Every new production behavior must be introduced through a failing regression test.
- Profitability uses one terminal lifecycle per thesis and net results after fees, slippage, and funding.

---

### Task 1: Make WATCHING-to-thesis delivery explicit and retryable

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/pipeline-scheduler.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline.service.ts`
- Test: `apps/api/test/pipeline/opportunity-watcher.spec.ts`
- Test: `apps/api/test/pipeline/pipeline.service.spec.ts`

**Interfaces:**
- Consumes: `OpportunityWatcherService.observe()` and `PipelineService.trigger()`.
- Produces: `scheduleProactiveThesis(input): Promise<{ status: 'SCHEDULED' | 'DUPLICATE' | 'FAILED'; runId?: string; reason?: string }>` with a stable idempotency key derived from opportunity and snapshot identifiers.

- [ ] **Step 1: Write the failing lifecycle tests**

Add tests proving that a first `WATCHING` transition schedules exactly one
`proactive-thesis` run, a duplicate observation reuses the existing run, and a
trigger failure produces `OPPORTUNITY_PROACTIVE_SCHEDULE_FAILED` with
`opportunityId`, `snapshotId`, `sourceDataCutoff`, and a stable reason code.

```ts
expect(result).toMatchObject({ status: 'SCHEDULED', runId: expect.any(String) });
expect(await scheduleSameObservation()).toMatchObject({ status: 'DUPLICATE' });
expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ action: 'OPPORTUNITY_PROACTIVE_SCHEDULE_FAILED' }),
}));
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @platform/api exec vitest run test/pipeline/opportunity-watcher.spec.ts test/pipeline/pipeline.service.spec.ts
```

Expected: FAIL because proactive scheduling is inline, has no reusable result contract, and cannot report duplicate delivery explicitly.

- [ ] **Step 3: Extract the scheduling boundary and preserve idempotency**

Move proactive delivery into a focused method. Parse the request with
`PipelineRunRequestSchema`, reuse by opportunity/snapshot identity, and return
`FAILED` only after the failure audit has been persisted. Scheduler health must
count duplicates as successful delivery and failures as failed cycles.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass and no schema literal
error is emitted for `proactive-thesis`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pipeline/application/pipeline-scheduler.service.ts apps/api/src/modules/pipeline/application/pipeline.service.ts apps/api/test/pipeline/opportunity-watcher.spec.ts apps/api/test/pipeline/pipeline.service.spec.ts
git commit -m "fix: make proactive thesis delivery reliable"
```

### Task 2: Require corroboration before news-accelerated probes

**Files:**
- Create: `apps/api/src/modules/agents/domain/news-probe-authority.ts`
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Test: `apps/api/test/agents/news-probe-authority.spec.ts`
- Test: `apps/api/test/agents/decision-news-dominance.spec.ts`

**Interfaces:**
- Consumes: news importance, news confidence, unique source IDs, price/volume causality, OI/funding availability, and explicit missing evidence.
- Produces: `evaluateNewsProbeAuthority(input): { allowed: boolean; reason: string; corroborationCount: number }`.

- [ ] **Step 1: Write failing news-probe tests**

Cover a single-source shock with price expansion, a two-source shock, a
single-source shock corroborated by OI, stale news, and missing price/volume
confirmation.

```ts
expect(evaluateNewsProbeAuthority(singleSource)).toEqual({
  allowed: false,
  reason: 'NEWS_CORROBORATION_INSUFFICIENT',
  corroborationCount: 0,
});
expect(evaluateNewsProbeAuthority(twoSources)).toMatchObject({ allowed: true });
expect(evaluateNewsProbeAuthority(withOi)).toMatchObject({ allowed: true });
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/agents/news-probe-authority.spec.ts test/agents/decision-news-dominance.spec.ts
```

Expected: FAIL because there is no explicit authority boundary connecting news
quality to market causality.

- [ ] **Step 3: Implement deterministic corroboration**

Require fresh high-importance directional news plus price/volume expansion and
one of: a second independent source, usable OI evidence, usable funding
evidence, or real liquidation evidence. Never treat
`LIQUIDATION_DATA_UNAVAILABLE` as corroboration. Feed the result into thesis
action selection so failure remains `WAIT`, while success can become only a
bounded `PROBE` unless exact cohort authority permits normal entry.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass and existing macro/news
dominance behavior remains intact.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/agents/domain/news-probe-authority.ts apps/api/src/modules/agents/application/services/decision.service.ts apps/api/test/agents/news-probe-authority.spec.ts apps/api/test/agents/decision-news-dominance.spec.ts
git commit -m "feat: corroborate news accelerated probes"
```

### Task 3: Execute persisted thesis geometry without rerunning full AI

**Files:**
- Modify: `apps/api/src/modules/risk/domain/thesis-execution.ts`
- Modify: `apps/api/src/modules/pipeline/domain/opportunity-state-machine.ts`
- Modify: `apps/api/src/modules/live-trading/application/live-trading.service.ts`
- Test: `apps/api/test/pipeline/entry-drift-reassessment.spec.ts`
- Test: `apps/api/test/pipeline/proactive-joined-execution.spec.ts`
- Test: `apps/api/test/live-trading/proactive-execution-evidence.spec.ts`

**Interfaces:**
- Consumes: persisted `TradeThesis`, latest `AnticipatoryMarketSnapshot`, current price, and ATR.
- Produces: `evaluatePersistedThesisEntry(input)` returning `ENTER`, `WAIT_PULLBACK`, `TOO_LATE`, `EXPIRED`, or `INVALIDATED`, plus a stable reason code.

- [ ] **Step 1: Write failing entry-state tests**

Cover price inside the declared entry zone, price before the trigger, price
beyond `maximumChaseDistanceAtr`, expiry, and invalidation. Assert the execution
path consumes the persisted thesis and does not call the full analysis pipeline.

```ts
expect(evaluatePersistedThesisEntry(insideZone)).toMatchObject({ action: 'ENTER' });
expect(evaluatePersistedThesisEntry(extended)).toMatchObject({ action: 'TOO_LATE' });
expect(fullAnalysisTrigger).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/pipeline/entry-drift-reassessment.spec.ts test/pipeline/proactive-joined-execution.spec.ts test/live-trading/proactive-execution-evidence.spec.ts
```

Expected: FAIL because the entry states are not exposed as one deterministic
persisted-thesis decision.

- [ ] **Step 3: Implement the pure persisted-thesis evaluator**

Validate thesis expiry and invalidation first, calculate chase distance in ATR,
then evaluate triggers and entry-zone membership. Integrate it immediately
before DEMO order construction. Preserve IOC limit execution and all existing
instrument, collateral, and protection checks.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass and the full analysis
trigger remains unused during entry evaluation.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/risk/domain/thesis-execution.ts apps/api/src/modules/pipeline/domain/opportunity-state-machine.ts apps/api/src/modules/live-trading/application/live-trading.service.ts apps/api/test/pipeline/entry-drift-reassessment.spec.ts apps/api/test/pipeline/proactive-joined-execution.spec.ts apps/api/test/live-trading/proactive-execution-evidence.spec.ts
git commit -m "feat: execute persisted thesis entries"
```

### Task 4: Enforce profit-first drawdown sizing at 8%, 12%, and 15%

**Files:**
- Modify: `apps/api/src/modules/risk/domain/risk-engine.types.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.ts`
- Test: `apps/api/test/risk/risk-engine.spec.ts`
- Test: `apps/api/test/risk/staged-entry-risk.spec.ts`

**Interfaces:**
- Consumes: `RiskAccount.equity`, `RiskAccount.peakEquity`, decision action, and normal planned risk.
- Produces: `resolveDrawdownRiskPolicy(drawdownPct, requestedAction)` returning `NORMAL`, `REDUCED`, `DIAGNOSTIC_PROBE`, or `HALTED` with a maximum size factor.

- [ ] **Step 1: Write failing boundary tests**

```ts
expect(resolveDrawdownRiskPolicy(0.079, 'ENTER')).toEqual({ tier: 'NORMAL', maxSizeFactor: 1 });
expect(resolveDrawdownRiskPolicy(0.08, 'ENTER')).toEqual({ tier: 'REDUCED', maxSizeFactor: 0.5 });
expect(resolveDrawdownRiskPolicy(0.12, 'ENTER')).toMatchObject({ tier: 'DIAGNOSTIC_PROBE', maxSizeFactor: 0.1 });
expect(resolveDrawdownRiskPolicy(0.15, 'PROBE')).toMatchObject({ tier: 'HALTED', maxSizeFactor: 0 });
```

Also assert that protective closing orders are not blocked by this entry policy.

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/risk/risk-engine.spec.ts test/risk/staged-entry-risk.spec.ts
```

Expected: FAIL because risk currently has only a single maximum-drawdown gate.

- [ ] **Step 3: Implement drawdown policy and compose size caps**

Add explicit thresholds to `RiskLimits`, defaulting to 0.08, 0.12, and 0.15.
The final size factor is the minimum of cohort, probe, volatility, and drawdown
caps. Reject new entries at 15%, but leave reduce-only protective actions
untouched.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all boundary and existing risk tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/risk/domain/risk-engine.types.ts apps/api/src/modules/risk/domain/risk-engine.ts apps/api/test/risk/risk-engine.spec.ts apps/api/test/risk/staged-entry-risk.spec.ts
git commit -m "feat: enforce profit-first drawdown tiers"
```

### Task 5: Make exact lifecycle profitability the sizing authority

**Files:**
- Modify: `apps/api/src/modules/reflection/domain/thesis-cohort.ts`
- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Test: `apps/api/test/reflection/thesis-cohort.spec.ts`
- Test: `apps/api/test/reflection/self-learning.service.spec.ts`

**Interfaces:**
- Consumes: deduplicated finalized `TradeLifecycleOutcome[]` and an exact thesis cohort key.
- Produces: exact-cohort authority `FULL_SIZE`, `PROBE_ONLY`, or `SUPPRESSED`, with sample size, net expectancy, Profit Factor, concentration, and sequential-window results.

- [ ] **Step 1: Write failing authority tests**

Cover fewer than 30 outcomes, positive exact results across two sequential
windows, negative expectancy after 20 outcomes, a single winner contributing
more than 35% of total profit, and duplicate outcomes sharing one `thesisId`.

```ts
expect(evaluateProfitAuthority(immature)).toMatchObject({ action: 'PROBE_ONLY' });
expect(evaluateProfitAuthority(stablePositive)).toMatchObject({ action: 'FULL_SIZE' });
expect(evaluateProfitAuthority(matureNegative)).toMatchObject({ action: 'SUPPRESSED' });
expect(evaluateProfitAuthority(concentrated)).toMatchObject({ action: 'PROBE_ONLY' });
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/reflection/thesis-cohort.spec.ts test/reflection/self-learning.service.spec.ts
```

Expected: FAIL because the current exact threshold is 20 and does not enforce
profit concentration or two sequential validation windows.

- [ ] **Step 3: Implement exact authority without broad-cohort blocking**

Deduplicate by `thesisId`, split ordered outcomes into two non-overlapping
validation windows, compute net-R expectancy and Profit Factor, and calculate
largest-winner concentration. Exact negative cohorts may be suppressed after 20
outcomes. Broader/fallback evidence may only return probe telemetry capped at
0.15; it cannot authorize full size or hard-block a symbol.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all cohort and self-learning tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reflection/domain/thesis-cohort.ts apps/api/src/modules/reflection/application/self-learning.service.ts apps/api/test/reflection/thesis-cohort.spec.ts apps/api/test/reflection/self-learning.service.spec.ts
git commit -m "feat: govern sizing by lifecycle profitability"
```

### Task 6: Capture stop quality and fail rollout on uneconomic behavior

**Files:**
- Modify: `apps/api/src/modules/research/domain/trade-lifecycle.ts`
- Modify: `apps/api/src/modules/reflection/application/performance.service.ts`
- Modify: `apps/api/src/scripts/audit-recovery-rollout.ts`
- Test: `apps/api/test/reflection/performance-provenance.spec.ts`
- Test: `apps/api/test/audit/trading-system-checklist.spec.ts`
- Test: `apps/api/test/anticipatory-replay.spec.ts`

**Interfaces:**
- Consumes: terminal lifecycle fills, fees, funding, MFE, MAE, entry-zone distance, and close reason.
- Produces: one net lifecycle outcome per thesis plus audit checks for delivery integrity, realized economics, stop-out recovery, and drawdown.

- [ ] **Step 1: Write failing provenance and audit tests**

Assert that multiple horizon labels never increase lifecycle trade count, stop
outcomes retain MFE/MAE and recovery metadata, any scheduling failure fails the
audit, and rollout fails when completed DEMO lifecycles have non-positive net
expectancy or drawdown reaches 15%.

```ts
expect(report.checks.find((c) => c.name === 'PROACTIVE_LIFECYCLE_EVIDENCE')?.passed).toBe(false);
expect(report.checks.find((c) => c.name === 'DEMO_NET_ECONOMICS')?.passed).toBe(false);
expect(metrics.completedLifecycles).toBe(uniqueThesisIds.size);
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @platform/api exec vitest run test/reflection/performance-provenance.spec.ts test/audit/trading-system-checklist.spec.ts test/anticipatory-replay.spec.ts
```

Expected: FAIL because the audit does not yet enforce all profit-first rollout
gates and stop-quality provenance is incomplete.

- [ ] **Step 3: Persist stop-quality metadata and add rollout checks**

Use the thesis lifecycle as the sole independent sample. Add entry distance,
MFE, MAE, post-stop directional recovery, and net-cost fields to lifecycle
metadata without inventing unavailable values. Add audit checks for scheduling
failures, unmatched `WATCHING`, net expectancy, Profit Factor, and 15% drawdown.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all provenance, replay, and audit tests pass.

- [ ] **Step 5: Run full verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all commands exit zero; only explicitly marked integration/E2E tests
may remain skipped.

- [ ] **Step 6: Run the configured database audit read-only**

Run the audit with `DATABASE_URL` loaded from the approved environment. Confirm
that it performs only `SELECT` operations inside a read-only transaction. Do not
enable any feature flag or write to the database.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/research/domain/trade-lifecycle.ts apps/api/src/modules/reflection/application/performance.service.ts apps/api/src/scripts/audit-recovery-rollout.ts apps/api/test/reflection/performance-provenance.spec.ts apps/api/test/audit/trading-system-checklist.spec.ts apps/api/test/anticipatory-replay.spec.ts docs/superpowers/plans/2026-09-21-profit-first-practical-trading.md
git commit -m "feat: enforce profit-first rollout evidence"
```
