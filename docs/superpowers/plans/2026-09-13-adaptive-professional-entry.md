# Adaptive Professional Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trade ranges and early transitions with location-aware entries while preventing late/chasing orders and preserving approved exchange parameters.

**Architecture:** Build one canonical `ExecutionContext` from closed primary candles plus explicitly labeled intrabar observations. Decision, Judge, Quant, Risk, and Execution consume it without reclassification; finalized lifecycle outcomes are the learning source for executable setups.

**Tech Stack:** TypeScript 5.9, NestJS 11, Zod 3, Prisma 6/PostgreSQL, Vitest 3, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-13-adaptive-professional-entry-design.md`

## Global Constraints

- Do not lower global confidence thresholds merely to increase trade frequency.
- Normal-size entries require a closed primary candle; intrabar entries are probe-only.
- AI and rules fallback satisfy the same structured thesis contract.
- Risk may reject or reduce a setup but may not change its regime or setup.
- `LIMIT` plans reach the exchange as `LIMIT`; expiration triggers reassessment, never automatic market chase.
- Existing exposure, leverage, drawdown, loss-streak, and mandatory protection controls remain deterministic.
- No future candle data is visible to live decisions or replay.
- Rollout stays replay/shadow/DEMO until predeclared promotion criteria pass.

## File Map

- Create `apps/api/src/modules/pipeline/domain/execution-context.ts` for regime, setup, location, candle-finality, and entry-timing rules.
- Create `apps/api/test/pipeline/execution-context.spec.ts` for focused domain tests.
- Modify `packages/shared/src/schemas/pipeline.ts` to persist the context.
- Modify `apps/api/src/modules/agents/application/services/decision.service.ts` and shared agent schemas to produce the structured thesis.
- Modify `pipeline-runner.service.ts` to build it once and propagate it.
- Modify Judge, Risk, trade-plan, Quant, live execution, ledger, and reflection services to consume the contract.
- Create `apps/api/test/pipeline/adaptive-professional-entry.integration.spec.ts` for ZRO and positive range/transition acceptance.

---

### Task 1: Canonical Context and Price Location

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/execution-context.ts`
- Create: `apps/api/test/pipeline/execution-context.spec.ts`
- Modify: `packages/shared/src/schemas/pipeline.ts`
- Test: `packages/shared/test/pipeline.spec.ts`

**Interfaces:**
- Consumes: price, support, resistance, ATR, trigger, source cutoff, candle finality, regime, setup, and action.
- Produces: `ExecutionContext`, `buildExecutionContext(input)`, and `validateSetupLocation(context, direction)`.

- [x] **Step 1: Write failing ZRO, valid-boundary, and intrabar tests**

```ts
it('rejects the ZRO normal short near range support', () => {
  const context = buildExecutionContext({
    regime: 'RANGING', setup: 'RANGE_REVERSION', action: 'ENTER',
    price: 1.0171, support: 1.0151, resistance: 1.0245,
    atr: 0.00467606,
    sourceDataCutoff: new Date('2026-09-12T22:59:59.999Z'),
    primaryCandleClosed: true,
  });
  expect(context.priceLocation.rangePercentile).toBeCloseTo(0.2128, 3);
  expect(validateSetupLocation(context, 'SHORT'))
    .toContain('RANGE_SHORT_NOT_AT_UPPER_BOUNDARY');
});

it('permits a short at the upper range boundary', () => {
  const context = buildExecutionContext({
    regime: 'RANGING', setup: 'RANGE_REVERSION', action: 'ENTER',
    price: 1.0235, support: 1.0151, resistance: 1.0245,
    atr: 0.00467606,
    sourceDataCutoff: new Date('2026-09-12T22:59:59.999Z'),
    primaryCandleClosed: true,
  });
  expect(validateSetupLocation(context, 'SHORT')).toEqual([]);
});

it('makes an intrabar transition probe-only', () => {
  const context = buildExecutionContext({
    regime: 'PRE_BREAKOUT', setup: 'TRANSITION_PROBE', action: 'PROBE',
    price: 100.4, support: 98, resistance: 100, triggerPrice: 100, atr: 1,
    sourceDataCutoff: new Date('2026-09-13T00:01:00Z'),
    primaryCandleClosed: false,
  });
  expect(context.riskTier).toBe('PROBE');
  expect(context.usesClosedPrimaryCandle).toBe(false);
});
```

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/execution-context.spec.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the contract and validators**

```ts
export type CanonicalRegime = 'RANGING' | 'PRE_BREAKOUT' | 'BREAKOUT' | 'TRENDING' | 'UNCERTAIN';
export type CanonicalSetup = 'RANGE_REVERSION' | 'TRANSITION_PROBE' | 'BREAKOUT_RETEST' | 'TREND_PULLBACK';
export type EntryAction = 'WAIT' | 'PROBE' | 'ENTER';
export type RiskTier = 'NONE' | 'PROBE' | 'NORMAL';

export interface ExecutionContext {
  regime: CanonicalRegime;
  regimeDetail?: string;
  setup: CanonicalSetup;
  action: EntryAction;
  riskTier: RiskTier;
  sourceDataCutoff: string;
  usesClosedPrimaryCandle: boolean;
  triggerConfirmed: boolean;
  priceLocation: {
    rangePercentile?: number;
    distanceFromSupportAtr?: number;
    distanceFromResistanceAtr?: number;
    distanceFromTriggerAtr?: number;
    moveConsumedPct?: number;
  };
}
```

Clamp range percentile to `[0,1]`. Reject range LONG above `0.30`, range SHORT below `0.70`, normal `ENTER` on an open primary candle, unconfirmed triggers, chase distance beyond the configured ATR limit, and consumed move above 50%.

- [x] **Step 4: Add the equivalent Zod schema**

Add `ExecutionContextSchema` and its inferred type to `packages/shared/src/schemas/pipeline.ts`; make `storedContext.executionContext` optional for historical compatibility.

- [x] **Step 5: Verify GREEN**

Run: `pnpm --filter @platform/api test -- test/pipeline/execution-context.spec.ts && pnpm --filter @platform/shared test -- test/pipeline.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/modules/pipeline/domain/execution-context.ts apps/api/test/pipeline/execution-context.spec.ts packages/shared/src/schemas/pipeline.ts packages/shared/test/pipeline.spec.ts
git commit -m "feat(pipeline): add canonical execution context"
```

---

### Task 2: Regime Playbooks and Executable Thesis

**Files:**
- Modify: `packages/shared/src/schemas/agents.ts`
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Modify: `apps/api/src/modules/agents/domain/trade-thesis-validator.ts`
- Test: `apps/api/test/agents/decision.service.spec.ts`
- Test: `apps/api/test/agents/decision-data-quality.spec.ts`
- Test: `packages/shared/test/trade-thesis.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ExecutionContext`, analyst evidence, and existing `DecisionOutput` inputs.
- Produces: one structured executable thesis with action, entry zone, trigger, invalidation, targets, chase limit, evidence for/against, and a late-entry assessment.

- [x] **Step 1: Write failing playbook tests**

```ts
it('selects range reversal at a validated lower boundary', async () => {
  const decision = await decide(rangeLowerBoundaryFixture({ direction: 'LONG' }));
  expect(decision.executionContext).toMatchObject({
    regime: 'RANGING', setup: 'RANGE_REVERSION', action: 'ENTER',
  });
  expect(decision.thesis.entryZone).toBeDefined();
  expect(decision.thesis.targets[0].role).toBe('RANGE_MIDPOINT');
});

it('creates a small transition probe before full confirmation', async () => {
  const decision = await decide(compressionSweepVolumeFixture());
  expect(decision.executionContext).toMatchObject({
    regime: 'PRE_BREAKOUT', setup: 'TRANSITION_PROBE',
    action: 'PROBE', riskTier: 'PROBE',
  });
});

it('returns an actionable wait condition instead of chasing', async () => {
  const decision = await decide(consumedMoveFixture({ moveConsumedPct: 0.65 }));
  expect(decision.executionContext.action).toBe('WAIT');
  expect(decision.thesis.nextActionCondition).toMatch(/pullback|retest/i);
});
```

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/agents/decision.service.spec.ts test/agents/decision-data-quality.spec.ts && pnpm --filter @platform/shared test -- test/trade-thesis.spec.ts`

Expected: FAIL because DecisionOutput does not yet require an executable thesis or canonical playbook action.

- [x] **Step 3: Extend the structured thesis schema**

Require this shape for actionable decisions and rules fallback:

```ts
interface ExecutableThesis {
  action: 'WAIT' | 'PROBE' | 'ENTER';
  setup: CanonicalSetup;
  entryZone?: { lower: number; upper: number };
  trigger: { kind: string; confirmed: boolean; observedAt: string };
  invalidation?: { price: number; reason: string };
  targets: Array<{ price: number; fraction: number; role: string }>;
  maximumChaseDistanceAtr: number;
  expectedNetR?: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  whyEntryIsNotLate?: string;
  nextActionCondition?: string;
}
```

Validator rules require entry, invalidation, target, chase, and not-late justification for `PROBE/ENTER`; `WAIT` requires `nextActionCondition`. Narrative text cannot compensate for missing fields.

- [x] **Step 4: Select one playbook from regime and location**

In Decision, evaluate `RANGE_REVERSION`, `TRANSITION_PROBE`, `BREAKOUT_RETEST`, and `TREND_PULLBACK` candidates. Ranging selects matching boundaries; pre-breakout requires compression plus structural pressure and at least one confirming sweep/volume/derivatives observation; breakout requires trigger and acceptable chase; trending requires a pullback zone. Return `WAIT` when no candidate has both valid location and trigger.

- [x] **Step 5: Verify GREEN and commit**

Run: `pnpm --filter @platform/api test -- test/agents/decision.service.spec.ts test/agents/decision-data-quality.spec.ts && pnpm --filter @platform/shared test -- test/trade-thesis.spec.ts`

```bash
git add packages/shared/src/schemas/agents.ts apps/api/src/modules/agents/application/services/decision.service.ts apps/api/src/modules/agents/domain/trade-thesis-validator.ts apps/api/test/agents/decision.service.spec.ts apps/api/test/agents/decision-data-quality.spec.ts packages/shared/test/trade-thesis.spec.ts
git commit -m "feat(agents): produce executable regime playbooks"
```

---

### Task 3: Closed-candle Context Propagation

**Files:**
- Modify: `apps/api/src/modules/pipeline/domain/multi-timeframe-analysis.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Test: `apps/api/test/pipeline/multi-timeframe-analysis.spec.ts`
- Test: `apps/api/test/pipeline/pipeline.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 context builder and current candles/indicators.
- Produces: identical `executionContext` in decision result, stored context, confluence payload, and Risk request.

- [ ] **Step 1: Write failing finality test**

```ts
it('does not confirm normal entry from an open primary candle', () => {
  const result = evaluateMultiTimeframeConfirmation({
    direction: 'SHORT', primaryTimeframe: '15m',
    frames: [
      { timeframe: '15m', trend: 'BEARISH', weight: 1, isClosed: false },
      { timeframe: '1h', trend: 'BEARISH', weight: 2, isClosed: true },
    ],
  });
  expect(result.normalEntryConfirmed).toBe(false);
  expect(result.probeEligible).toBe(true);
});
```

Add a pipeline test asserting deep equality between persisted context and `assessPipelineDecision({ executionContext })`.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/multi-timeframe-analysis.spec.ts test/pipeline/pipeline.service.spec.ts`

Expected: FAIL because finality and context propagation are absent.

- [ ] **Step 3: Implement finality and single-build propagation**

Extend frame input with `isClosed`. Return `normalEntryConfirmed` using closed frames only and `probeEligible` using explicitly labeled live observations. Build the context once after regime/indicator selection and pass the same object through `candidateDecision`, `storedContext`, confluence, and `assessPipelineDecision`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @platform/api test -- test/pipeline/multi-timeframe-analysis.spec.ts test/pipeline/pipeline.service.spec.ts test/pipeline/pipeline-confluence.integration.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pipeline/domain/multi-timeframe-analysis.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/test/pipeline/multi-timeframe-analysis.spec.ts apps/api/test/pipeline/pipeline.service.spec.ts
git commit -m "feat(pipeline): propagate closed-candle execution context"
```

---

### Task 4: Judge and Risk Enforce the Approved Setup

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/decision-judge.service.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.types.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.ts`
- Modify: `apps/api/src/modules/risk/domain/trade-plan-engine.ts`
- Test: `apps/api/test/pipeline/decision-judge.spec.ts`
- Test: `apps/api/test/risk/risk-engine.spec.ts`
- Test: `apps/api/test/risk/trade-plan-engine.spec.ts`

**Interfaces:**
- Consumes: `ExecutionContext` and `validateSetupLocation`.
- Produces: deterministic reject codes and a plan whose regime/setup equal the approved context.

- [ ] **Step 1: Write failing Judge and plan immutability tests**

```ts
it('rejects bearish indicators when a range short is near support', () => {
  const review = judge.evaluate(decisionFixture({
    decision: 'SHORT', executionContext: zroExecutionContext,
  }), analysesFixture());
  expect(review.approved).toBe(false);
  expect(review.reasons).toContain('RANGE_SHORT_NOT_AT_UPPER_BOUNDARY');
});

it('does not convert range reversal into trend pullback', () => {
  const plan = buildAdaptiveTradePlan(rangeShortAtResistance);
  expect(plan.regime).toBe('RANGING');
  expect(plan.strategy).toBe('RANGE_REVERSAL');
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/decision-judge.spec.ts test/risk/risk-engine.spec.ts test/risk/trade-plan-engine.spec.ts`

Expected: FAIL because Judge lacks location validation and Risk re-infers setup.

- [ ] **Step 3: Enforce context**

Judge blocks `REGIME_SETUP_MISMATCH`, boundary violations, `PRIMARY_CANDLE_NOT_CLOSED`, `ENTRY_TRIGGER_NOT_CONFIRMED`, `ENTRY_CHASE_DISTANCE_EXCEEDED`, and `EXPECTED_MOVE_ALREADY_CONSUMED`. Add `executionContext` to `RiskInput`; select the trade-plan branch from `context.setup` and reject instead of reclassifying.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @platform/api test -- test/pipeline/decision-judge.spec.ts test/risk/risk-engine.spec.ts test/risk/trade-plan-engine.spec.ts`

Expected: PASS, including a positive upper-boundary short.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pipeline/application/decision-judge.service.ts apps/api/src/modules/risk/domain/risk-engine.types.ts apps/api/src/modules/risk/domain/risk-engine.ts apps/api/src/modules/risk/domain/trade-plan-engine.ts apps/api/test/pipeline/decision-judge.spec.ts apps/api/test/risk/risk-engine.spec.ts apps/api/test/risk/trade-plan-engine.spec.ts
git commit -m "fix(trading): enforce canonical setup and entry location"
```

---

### Task 5: Preserve LIMIT Plans and Partial Fills

**Files:**
- Modify: `apps/api/src/modules/live-trading/application/live-trading.service.ts`
- Modify: `apps/api/src/modules/live-trading/application/exchange-trade-ledger.service.ts`
- Modify: `apps/api/src/modules/live-trading/domain/closed-trade-cycle.ts`
- Test: `apps/api/test/live-trading/proactive-execution-evidence.spec.ts`
- Test: `apps/api/test/exchange/proactive-limit-order.spec.ts`
- Test: `apps/api/test/live-trading/exchange-trade-ledger.spec.ts`

**Interfaces:**
- Consumes: approved plan order type/price/TTL and exchange fills.
- Produces: identical submitted terms and `PARTIALLY_FILLED_CANCELED` audit state.

- [ ] **Step 1: Write failing execution-integrity test**

```ts
it('submits an approved pullback as LIMIT without market fallback', async () => {
  await service.executePipeline(approvedRiskFixture({
    orderType: 'LIMIT', limitEntryPrice: 1.01826901,
    limitTtlCandles: 2, timeframeMs: 900_000,
  }));
  expect(adapter.placeOrder).toHaveBeenCalledWith(expect.objectContaining({
    orderType: 'LIMIT', limitPrice: '1.01826901', timeInForce: 'IOC',
  }));
});
```

Add a test where requested quantity 2,776, filled quantity 746, and terminal canceled status produces `PARTIALLY_FILLED_CANCELED` while retaining the 746-unit lifecycle.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/live-trading/proactive-execution-evidence.spec.ts test/exchange/proactive-limit-order.spec.ts test/live-trading/exchange-trade-ledger.spec.ts`

Expected: LIMIT propagation or partial-fill assertion FAILS.

- [ ] **Step 3: Implement immutable terms and reconciliation**

```ts
const orderTerms = plan.orderType === 'LIMIT'
  ? {
      orderType: 'LIMIT' as const,
      limitPrice: String(plan.limitEntryPrice),
      timeInForce: 'IOC' as const,
      expiresAt: new Date(now.getTime() + plan.limitTtlCandles * plan.timeframeMs).toISOString(),
    }
  : { orderType: 'MARKET' as const };
```

Persist approved/submitted terms, reject mismatches with `EXECUTION_PLAN_DRIFT`, and normalize canceled orders with positive incomplete fills to `PARTIALLY_FILLED_CANCELED`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @platform/api test -- test/live-trading/proactive-execution-evidence.spec.ts test/exchange/proactive-limit-order.spec.ts test/live-trading/exchange-trade-ledger.spec.ts test/live-trading/closed-trade-cycle.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/live-trading/application/live-trading.service.ts apps/api/src/modules/live-trading/application/exchange-trade-ledger.service.ts apps/api/src/modules/live-trading/domain/closed-trade-cycle.ts apps/api/test/live-trading/proactive-execution-evidence.spec.ts apps/api/test/exchange/proactive-limit-order.spec.ts apps/api/test/live-trading/exchange-trade-ledger.spec.ts apps/api/test/live-trading/closed-trade-cycle.spec.ts
git commit -m "fix(execution): preserve limit plans and partial fills"
```

---

### Task 6: Thesis-aware Cooldown

**Files:**
- Modify: `apps/api/src/modules/risk/domain/risk-engine.types.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.ts`
- Test: `apps/api/test/risk/risk-engine.spec.ts`
- Test: `apps/api/test/risk/staged-entry-risk.spec.ts`

**Interfaces:**
- Consumes: prior trade direction/setup/regime/configuration and new context.
- Produces: full cooldown for repeated losing theses and capped reversal probes for confirmed transitions.

- [ ] **Step 1: Write failing cooldown tests**

```ts
expect(evaluateRisk(sameDirectionSameSetupAfterLoss).reason)
  .toBe('LOSS_REENTRY_COOLDOWN_ACTIVE');
expect(evaluateRisk(oppositeTransitionAfterLoss).tradePlan?.riskTier)
  .toBe('PROBE');
expect(evaluateRisk(oppositeWithoutNewTrigger).reason)
  .toBe('LOSS_REVERSAL_TRIGGER_REQUIRED');
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/risk/risk-engine.spec.ts test/risk/staged-entry-risk.spec.ts`

Expected: reversal cases FAIL because cooldown ignores thesis identity.

- [ ] **Step 3: Implement contextual cooldown**

Extend `RecentClosedTradeRecord` with symbol, direction, setup, regime, configuration hash, PnL, and close time. Keep existing cooldown for the same thesis. Permit the opposite direction only for a new `TRANSITION_PROBE` with a different cutoff and confirmed trigger, capped at `0.2` normal size; otherwise return `LOSS_REVERSAL_TRIGGER_REQUIRED`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @platform/api test -- test/risk/risk-engine.spec.ts test/risk/staged-entry-risk.spec.ts`

```bash
git add apps/api/src/modules/risk/domain/risk-engine.types.ts apps/api/src/modules/risk/domain/risk-engine.ts apps/api/test/risk/risk-engine.spec.ts apps/api/test/risk/staged-entry-risk.spec.ts
git commit -m "feat(risk): make loss cooldown thesis aware"
```

---

### Task 7: Cohort-matched Quant Risk Tier

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts`
- Modify: `apps/api/src/modules/pipeline/domain/evidence-gate.ts`
- Test: `apps/api/test/pipeline/quant-execution-policy.spec.ts`
- Test: `apps/api/test/pipeline/evidence-gate.spec.ts`

**Interfaces:**
- Consumes: symbol, setup, regime, direction, execution policy/version, and validation.
- Produces: `riskTier: 'NORMAL' | 'PROBE' | 'BLOCKED'`, matched cohort, size, and reason.

- [ ] **Step 1: Write failing tier tests**

```ts
expect((await policy.evaluate(exactNegativeFixture({
  sampleSize: 80, outOfSampleSharpe: -1.36, probabilityOfRuin: 100,
}))).riskTier).toBe('BLOCKED');
expect((await policy.evaluate(immatureFixture({ sampleSize: 12 }))).riskTier)
  .toBe('PROBE');
expect((await policy.evaluate(positiveExactFixture())).riskTier)
  .toBe('NORMAL');
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/quant-execution-policy.spec.ts test/pipeline/evidence-gate.spec.ts`

Expected: FAIL because the result lacks matched setup and risk tier.

- [ ] **Step 3: Implement cohort matching and tier composition**

Use `{symbol, setup, regime, direction, executionPolicy, configurationVersion}` as the key. Mature exact negative evidence is `BLOCKED`; immature, stale, or mismatched evidence in shadow/DEMO is `PROBE` capped at 0.2; mature positive exact evidence is `NORMAL`. Global fallback never overrides exact negative evidence. Map tiers to existing `BLOCK`, `REDUCE_SIZE`, and `APPROVE` composition.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @platform/api test -- test/pipeline/quant-execution-policy.spec.ts test/pipeline/evidence-gate.spec.ts test/pipeline/pipeline.service.spec.ts`

```bash
git add apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts apps/api/src/modules/pipeline/domain/evidence-gate.ts apps/api/test/pipeline/quant-execution-policy.spec.ts apps/api/test/pipeline/evidence-gate.spec.ts
git commit -m "feat(quant): size execution by matched cohort"
```

---

### Task 8: Lifecycle-based Executable Learning

**Files:**
- Modify: `apps/api/src/modules/reflection/application/performance.service.ts`
- Modify: `apps/api/src/modules/reflection/application/self-learning.service.ts`
- Modify: `apps/api/src/modules/reflection/domain/thesis-cohort.ts`
- Test: `apps/api/test/reflection/performance-provenance.spec.ts`
- Test: `apps/api/test/reflection/self-learning.service.spec.ts`
- Test: `apps/api/test/reflection/thesis-cohort.spec.ts`

**Interfaces:**
- Consumes: finalized `TradeLifecycleOutcome` joined to thesis cohort.
- Produces: lifecycle calibration for executable setups; horizon metrics remain diagnostic.

- [ ] **Step 1: Write failing SL-before-horizon test**

```ts
it('keeps a stopped trade wrong when the one-hour mark later agrees', async () => {
  const result = await service.executablePerformance({
    lifecycle: lifecycleFixture({ exitReason: 'STOP_LOSS', netR: -1 }),
    horizon: performanceFixture({ outcome: 'CORRECT', returnPct: 0.45 }),
  });
  expect(result).toMatchObject({
    source: 'TRADE_LIFECYCLE', outcome: 'WRONG', netR: -1,
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/reflection/performance-provenance.spec.ts test/reflection/self-learning.service.spec.ts test/reflection/thesis-cohort.spec.ts`

Expected: FAIL because horizon outcomes can feed executable calibration.

- [ ] **Step 3: Separate diagnostic and executable learning**

Select finalized lifecycle rows for promotion/calibration and return `{source:'TRADE_LIFECYCLE', outcome, netR, realizedNetPnl, exitReason}`. Key cohorts by configuration hash, symbol, setup, regime, direction, and execution policy. Retain horizon results in reports only.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @platform/api test -- test/reflection/performance-provenance.spec.ts test/reflection/self-learning.service.spec.ts test/reflection/thesis-cohort.spec.ts test/reflection/live-eligibility.spec.ts`

```bash
git add apps/api/src/modules/reflection/application/performance.service.ts apps/api/src/modules/reflection/application/self-learning.service.ts apps/api/src/modules/reflection/domain/thesis-cohort.ts apps/api/test/reflection/performance-provenance.spec.ts apps/api/test/reflection/self-learning.service.spec.ts apps/api/test/reflection/thesis-cohort.spec.ts
git commit -m "fix(learning): calibrate execution from lifecycle outcomes"
```

---

### Task 9: Market Anchors, Opportunity Deduplication, and Ranking

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/market-context.ts`
- Modify: `apps/api/src/modules/pipeline/infrastructure/confluence-collector.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Test: `apps/api/test/pipeline/confluence-collector.service.spec.ts`
- Test: `apps/api/test/pipeline/pipeline-confluence.integration.spec.ts`

**Interfaces:**
- Consumes: closed BTC/ETH anchor candles and canonical candidate contexts.
- Produces: shared `MarketContext`, one updated opportunity per structural trigger, and deterministic portfolio ranking.

- [ ] **Step 1: Write failing anchor and deduplication tests**

```ts
it('adds BTC and ETH context to an altcoin candidate', () => {
  expect(buildMarketContext(anchorCandles)).toMatchObject({
    anchors: { BTC: { available: true }, ETH: { available: true } },
  });
});

it('updates one opportunity for repeated observations of the same trigger', async () => {
  await collector.add(candidate({ symbol: 'ZRO-USDT', setup: 'RANGE_REVERSION', triggerId: 'range-low-1' }));
  await collector.add(candidate({ symbol: 'ZRO-USDT', setup: 'RANGE_REVERSION', triggerId: 'range-low-1' }));
  expect(await collector.pending()).toHaveLength(1);
});
```

Define the local test builders in this test file: `anchorCandles` contains closed 15-minute BTC and ETH rows; `candidate` returns a complete existing `ConfluenceSignal` with overrides for symbol, setup, and trigger ID.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/confluence-collector.service.spec.ts test/pipeline/pipeline-confluence.integration.spec.ts`

Expected: FAIL because anchor context and structural-trigger deduplication do not exist.

- [ ] **Step 3: Implement common context and ranking**

Build anchor trend/volatility/correlation only from closed candles. Key pending opportunities by `{symbol, direction, setup, triggerId}` and update their newest cutoff. Rank unique candidates by post-cost expected R, location score, trigger freshness, evidence quality, and portfolio correlation penalty; preserve deterministic tie-breaking by cutoff then symbol.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @platform/api test -- test/pipeline/confluence-collector.service.spec.ts test/pipeline/pipeline-confluence.integration.spec.ts`

```bash
git add apps/api/src/modules/pipeline/domain/market-context.ts apps/api/src/modules/pipeline/infrastructure/confluence-collector.service.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/test/pipeline/confluence-collector.service.spec.ts apps/api/test/pipeline/pipeline-confluence.integration.spec.ts
git commit -m "feat(pipeline): rank unique opportunities with market anchors"
```

---

### Task 10: End-to-End Acceptance and Rollout Telemetry

**Files:**
- Create: `apps/api/test/pipeline/adaptive-professional-entry.integration.spec.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-analytics.service.ts`
- Modify: `apps/api/test/pipeline/pipeline-analytics.spec.ts`
- Modify: `docs/operations/proactive-ai-trading.md`

**Interfaces:**
- Consumes: Tasks 1–9 outputs.
- Produces: replay/shadow evidence for range participation, probes, chase, plan drift, expectancy, and drawdown.

- [ ] **Step 1: Write failing acceptance matrix**

```ts
const cases = {
  zroLateShort: { outcome: 'WAIT', reason: 'RANGE_SHORT_NOT_AT_UPPER_BOUNDARY' },
  rangeUpperShort: { outcome: 'ORDER_SUBMITTED', orderType: 'LIMIT' },
  intrabarTransition: { outcome: 'ORDER_SUBMITTED', riskTier: 'PROBE', maxSizeFactor: 0.2 },
  chasedBreakout: { outcome: 'WAIT', reason: 'ENTRY_CHASE_DISTANCE_EXCEEDED' },
};
```

Assert submitted and approved plans are identical for actionable cases.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @platform/api test -- test/pipeline/adaptive-professional-entry.integration.spec.ts`

Expected: FAIL until all boundaries are connected.

- [ ] **Step 3: Add telemetry and operations guidance**

Record regime, setup, range percentile, trigger distance, consumed move, candle finality, action, risk tier, Judge verdict, Quant reason, approved/submitted order types, plan drift, and lifecycle net R. Aggregate range participation, probe count, chase rate, drift count, post-cost expectancy, profit factor, and drawdown. Document replay → shadow → DEMO rollout and stop on any plan drift, increased chase, negative holdout expectancy, or excess drawdown.

- [ ] **Step 4: Run focused integration tests**

Run: `pnpm --filter @platform/api test -- test/pipeline/adaptive-professional-entry.integration.spec.ts test/pipeline/pipeline-analytics.spec.ts test/pipeline/proactive-thesis.integration.spec.ts test/pipeline/proactive-joined-execution.spec.ts`

Expected: PASS.

- [ ] **Step 5: Run full verification**

```bash
pnpm --filter @platform/shared test
pnpm --filter @platform/api test
pnpm --filter @platform/api typecheck
pnpm --filter @platform/api lint
pnpm --filter @platform/api build
```

Expected: every command exits 0 with no failures.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/pipeline/adaptive-professional-entry.integration.spec.ts apps/api/src/modules/pipeline/application/pipeline-analytics.service.ts apps/api/test/pipeline/pipeline-analytics.spec.ts docs/operations/proactive-ai-trading.md
git commit -m "test(trading): verify adaptive professional entries"
```

## Rollout Review Checklist

- [ ] ZRO near-support normal short is rejected.
- [ ] Valid range-boundary trades remain actionable.
- [ ] Intrabar transition is capped at 20% normal size.
- [ ] Same-thesis cooldown remains; confirmed reversal may probe.
- [ ] Mature exact negative Quant evidence blocks normal execution.
- [ ] Approved LIMIT parameters equal submitted parameters.
- [ ] Partial fills remain visible in order, position, and trade history.
- [ ] Executable calibration uses lifecycle outcomes after fees and funding.
- [ ] Shadow reports frequency, chase rate, post-cost expectancy, profit factor, and drawdown.
- [ ] DEMO promotion is rejected when execution-plan drift is nonzero.
