# Execution Invariant and OKX Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent contradictory candidates from reaching execution, derive entry readiness from pinned closed-candle evidence, and reject invalid OKX protection locally while selecting an entry style appropriate to the setup.

**Architecture:** Introduce pure domain policies at the pipeline and live-execution boundaries. The pipeline derives a deterministic execution context from pinned evidence and owns readiness as a distinct gate; the live-trading boundary normalizes and validates order geometry against a fresh ticker before any adapter call. Strategy forecasting remains separate from permission to execute.

**Tech Stack:** TypeScript, NestJS, Prisma, Vitest, OKX futures adapter

**Spec:** `docs/superpowers/specs/2026-09-16-execution-invariant-and-okx-preflight-design.md`

## Global Constraints

- Do not guarantee a trade or profitable outcome.
- Do not remove drawdown, exposure, leverage, or exchange safety limits.
- Do not use forming or future candles to confirm an entry.
- IOC limit orders never fall back to MARKET.
- Missing/global quant evidence may only authorize a reduced DEMO probe after execution readiness passes.
- Exact reliable negative expectancy remains a hard block.
- Do not mutate production configuration or deploy code.

---

### Task 1: Enforce one execution-readiness invariant

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/execution-readiness.ts`
- Modify: `apps/api/src/modules/pipeline/domain/gate-decision.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Test: `apps/api/test/pipeline/execution-readiness.spec.ts`
- Test: `apps/api/test/pipeline/pipeline-runtime.spec.ts`

**Interfaces:**
- Consumes: `DecisionOutput`, `ExecutionContext`, and `validateSetupLocation(context, direction)`.
- Produces: `evaluateExecutionReadiness(decision): { allowed: boolean; reasonCodes: ExecutionReadinessReason[] }` and the `EXECUTION_READINESS` gate stage.

- [ ] **Step 1: Write the failing domain tests**

```ts
it.each([
  ['WAIT', true, true, 'ENTRY_ACTION_NOT_EXECUTABLE'],
  ['ENTER', false, true, 'ENTRY_TRIGGER_NOT_CONFIRMED'],
  ['ENTER', true, false, 'PRIMARY_CANDLE_NOT_CLOSED'],
] as const)('blocks contradictory execution context', (action, triggerConfirmed, closed, reason) => {
  const result = evaluateExecutionReadiness(decisionFixture({ action, triggerConfirmed, closed }));
  expect(result).toEqual({ allowed: false, reasonCodes: [reason] });
});

it('allows a directional decision only when its deterministic context is executable', () => {
  expect(evaluateExecutionReadiness(validRangeShortFixture())).toEqual({ allowed: true, reasonCodes: [] });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/pipeline/execution-readiness.spec.ts`

Expected: FAIL because `execution-readiness.ts` and `EXECUTION_READINESS` do not exist.

- [ ] **Step 3: Implement the pure invariant**

```ts
export function evaluateExecutionReadiness(decision: DecisionOutput): ExecutionReadinessResult {
  if (decision.decision === 'WAIT') return block('DECISION_IS_WAIT');
  const context = decision.executionContext;
  if (!context || !['ENTER', 'PROBE'].includes(context.action)) return block('ENTRY_ACTION_NOT_EXECUTABLE');
  if (!context.triggerConfirmed) return block('ENTRY_TRIGGER_NOT_CONFIRMED');
  if (!context.usesClosedPrimaryCandle) return block('PRIMARY_CANDLE_NOT_CLOSED');
  const reasons = validateSetupLocation(context, decision.decision);
  return reasons.length ? { allowed: false, reasonCodes: reasons } : { allowed: true, reasonCodes: [] };
}
```

Add the readiness gate before Judge/Quant and require it in `standardActionable` and dislocation-canary eligibility. Preserve directional forecasts in stored context, but set `candidateDecision.actionable` only from the complete gate result.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `pnpm --filter @platform/api exec vitest run test/pipeline/execution-readiness.spec.ts test/pipeline/gate-decision.spec.ts test/pipeline/pipeline-runtime.spec.ts`

Expected: PASS, including a runtime regression proving a `LONG/SHORT` candidate with `action: WAIT` creates no risk assessment or order.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pipeline/domain/execution-readiness.ts apps/api/src/modules/pipeline/domain/gate-decision.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/test/pipeline/execution-readiness.spec.ts apps/api/test/pipeline/pipeline-runtime.spec.ts
git commit -m "fix(pipeline): enforce execution readiness before actionable selection"
```

### Task 2: Derive execution context from pinned closed-candle evidence

**Files:**
- Create: `apps/api/src/modules/pipeline/domain/closed-candle-execution-context.ts`
- Modify: `apps/api/src/modules/pipeline/domain/pinned-core-analysis.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/agents/application/services/decision.service.ts`
- Test: `apps/api/test/pipeline/closed-candle-execution-context.spec.ts`
- Test: `apps/api/test/pipeline/pinned-core-analysis.spec.ts`
- Test: `apps/api/test/agents/decision.service.spec.ts`

**Interfaces:**
- Consumes: pinned snapshot, chronological closed candles, multi-timeframe confirmation, strategy key, and direction.
- Produces: `deriveClosedCandleExecutionContext(input): ExecutionContext` with a cutoff identical to the snapshot candle.

- [ ] **Step 1: Write failing closed-candle tests**

```ts
it('confirms a range short only from a closed upper-bound rejection', () => {
  const context = deriveClosedCandleExecutionContext(rangeShortFixture());
  expect(context).toMatchObject({ action: 'ENTER', triggerConfirmed: true, usesClosedPrimaryCandle: true });
  expect(context.priceLocation.rangePercentile).toBeGreaterThanOrEqual(0.7);
  expect(context.sourceDataCutoff).toBe('2026-09-15T18:44:59.999Z');
});

it('does not confirm from the forming candle after the pinned cutoff', () => {
  const context = deriveClosedCandleExecutionContext(fixtureWithOnlyFormingBreakout());
  expect(context).toMatchObject({ action: 'WAIT', triggerConfirmed: false, usesClosedPrimaryCandle: true });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/pipeline/closed-candle-execution-context.spec.ts`

Expected: FAIL because the derivation function is absent.

- [ ] **Step 3: Implement deterministic context derivation**

Use only candles at or before `snapshot.candleCloseTime`. Derive range boundaries from closed lookback highs/lows, trigger price from the setup boundary or breakout level, ATR distances from the pinned snapshot, and action/confirmation from explicit rejection, retest, pullback, or momentum conditions. Return a closed but waiting context when evidence is insufficient.

Pass this context to `DecisionService.decideForUser` and preserve it through `calibrateForExecution`; remove the runner path that constructs a directional decision from `waitingExecutionContext` when pinned evidence exists.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `pnpm --filter @platform/api exec vitest run test/pipeline/closed-candle-execution-context.spec.ts test/pipeline/pinned-core-analysis.spec.ts test/agents/decision.service.spec.ts`

Expected: PASS and exact cutoff equality assertions hold.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pipeline/domain/closed-candle-execution-context.ts apps/api/src/modules/pipeline/domain/pinned-core-analysis.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/src/modules/agents/application/services/decision.service.ts apps/api/test/pipeline/closed-candle-execution-context.spec.ts apps/api/test/pipeline/pinned-core-analysis.spec.ts apps/api/test/agents/decision.service.spec.ts
git commit -m "fix(pipeline): derive entry context from pinned closed candles"
```

### Task 3: Make entry order style setup-aware

**Files:**
- Create: `apps/api/src/modules/risk/domain/entry-order-policy.ts`
- Modify: `apps/api/src/modules/risk/domain/risk-engine.types.ts`
- Modify: `apps/api/src/modules/risk/domain/trade-plan-engine.ts`
- Modify: `apps/api/src/modules/live-trading/application/live-trading.service.ts`
- Test: `apps/api/test/risk/entry-order-policy.spec.ts`
- Test: `apps/api/test/risk/trade-plan-engine.spec.ts`
- Test: `apps/api/test/exchange/proactive-limit-order.spec.ts`

**Interfaces:**
- Produces: `selectEntryOrderPolicy({ setup, side, bid, ask, tickSize, maxSlippagePct }): { orderType: 'LIMIT'; timeInForce: 'IOC' | 'GTC'; limitPrice: number; expiryCandles: number }`.
- GTC is used for `RANGE_REVERSION` and ordinary `TREND_PULLBACK`; IOC is used for confirmed `BREAKOUT_RETEST` and execution-ready `momentum-scalp` candidates.

- [ ] **Step 1: Write failing table tests**

```ts
it.each([
  ['RANGE_REVERSION', 'mean-reversion', 'GTC', 2],
  ['TREND_PULLBACK', 'trend', 'GTC', 2],
  ['BREAKOUT_RETEST', 'breakout', 'IOC', 1],
  ['TREND_PULLBACK', 'momentum-scalp', 'IOC', 1],
] as const)('selects bounded entry policy for %s/%s', (setup, strategyKey, tif, ttl) => {
  const result = selectEntryOrderPolicy({ setup, strategyKey, side: 'SELL', bid: 96.72, ask: 96.73, tickSize: 0.01, maxSlippagePct: 0.001 });
  expect(result).toMatchObject({ orderType: 'LIMIT', timeInForce: tif, expiryCandles: ttl });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/risk/entry-order-policy.spec.ts`

Expected: FAIL because the policy does not exist.

- [ ] **Step 3: Implement minimal setup-aware policy**

Normalize the marketable IOC price to tick size and cap it at `ask * (1 + maxSlippagePct)` for BUY or `bid * (1 - maxSlippagePct)` for SELL. Keep GTC at the structural entry price already produced by the trade-plan engine. Extend `ExecutionPlanInput.timeInForce` to `'IOC' | 'GTC'` and prohibit adapter MARKET fallback.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `pnpm --filter @platform/api exec vitest run test/risk/entry-order-policy.spec.ts test/risk/trade-plan-engine.spec.ts test/exchange/proactive-limit-order.spec.ts test/live-trading/resting-limit-expiry.spec.ts`

Expected: PASS; the existing ZRO-style range short remains GTC and momentum entries are IOC.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/risk/domain/entry-order-policy.ts apps/api/src/modules/risk/domain/risk-engine.types.ts apps/api/src/modules/risk/domain/trade-plan-engine.ts apps/api/src/modules/live-trading/application/live-trading.service.ts apps/api/test/risk/entry-order-policy.spec.ts apps/api/test/risk/trade-plan-engine.spec.ts apps/api/test/exchange/proactive-limit-order.spec.ts
git commit -m "fix(execution): choose limit behavior by trading setup"
```

### Task 4: Reject invalid protection before OKX submission

**Files:**
- Create: `apps/api/src/exchange/domain/order-protection-preflight.ts`
- Modify: `apps/api/src/modules/live-trading/application/live-trading.service.ts`
- Modify: `apps/api/src/exchange/domain/exchange.error.ts`
- Test: `apps/api/test/exchange/order-protection-preflight.spec.ts`
- Test: `apps/api/test/live-trading/protection-and-risk-preflight.spec.ts`
- Test: `apps/api/test/exchange/proactive-limit-order.spec.ts`

**Interfaces:**
- Produces: `preflightOrderProtection(input): NormalizedOrderProtection | OrderProtectionRejection`.
- Stable rejection reasons: `ENTRY_PROTECTION_GEOMETRY_INVALID`, `STOP_ALREADY_BREACHED`, `TAKE_PROFIT_ALREADY_CROSSED`, and `MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED`.

- [ ] **Step 1: Write failing ZRO regression tests**

```ts
it('rejects a long locally when the fresh market has already crossed its stop', () => {
  expect(preflightOrderProtection({ side: 'BUY', entry: 0.9847369, stopLoss: 0.96017669,
    takeProfit: 1.03945441, currentPrice: 0.9515, tickSize: 0.0001 })).toEqual({
      approved: false, reason: 'STOP_ALREADY_BREACHED',
    });
});

it('normalizes valid short protection without changing its ordering', () => {
  expect(preflightOrderProtection({ side: 'SELL', entry: 0.9665911, stopLoss: 0.9934153,
    takeProfit: 0.91932612, currentPrice: 0.9637, tickSize: 0.0001 })).toMatchObject({
      approved: true, entry: 0.9666, stopLoss: 0.9934, takeProfit: 0.9193,
    });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/exchange/order-protection-preflight.spec.ts`

Expected: FAIL because preflight is absent.

- [ ] **Step 3: Implement and integrate preflight**

Round to the instrument tick first, then validate directional ordering and current-price state. Fetch a fresh ticker immediately before submission and reject locally before `connections.placeOrder`. Persist the stable local error code and normalized values; do not replace it with a generic exchange error.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `pnpm --filter @platform/api exec vitest run test/exchange/order-protection-preflight.spec.ts test/live-trading/protection-and-risk-preflight.spec.ts test/exchange/proactive-limit-order.spec.ts`

Expected: PASS, and the external adapter spy receives no call for the invalid ZRO long fixture.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/exchange/domain/order-protection-preflight.ts apps/api/src/exchange/domain/exchange.error.ts apps/api/src/modules/live-trading/application/live-trading.service.ts apps/api/test/exchange/order-protection-preflight.spec.ts apps/api/test/live-trading/protection-and-risk-preflight.spec.ts apps/api/test/exchange/proactive-limit-order.spec.ts
git commit -m "fix(okx): validate protection against fresh market before submit"
```

### Task 5: Correct quant fallback ownership and add symbol-neutral replay coverage

**Files:**
- Modify: `apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts`
- Modify: `apps/api/src/modules/pipeline/application/pipeline-runner.service.ts`
- Modify: `apps/api/src/modules/pipeline/domain/gate-decision.ts`
- Test: `apps/api/test/pipeline/quant-execution-policy.spec.ts`
- Create: `apps/api/test/pipeline/registered-symbol-execution-replay.spec.ts`

**Interfaces:**
- Quant result distinguishes `BLOCK`, `PROBE`, and `ADVISORY` authorization.
- Replay fixtures contain literal closed-candle/indicator inputs for SOL, BNB, ARB, ZEC, and ZRO and assert gate attribution rather than guaranteed entry.

- [ ] **Step 1: Write failing quant and replay tests**

```ts
it('permits only a reduced DEMO probe for a new cohort after readiness passes', async () => {
  const result = await evaluate(newCohortFixture({ mode: 'DEMO', executionReady: true }));
  expect(result).toMatchObject({ allowed: true, severity: 'REDUCE_SIZE', executionPolicy: 'PROBE' });
});

it('keeps reliable exact negative expectancy as a hard block', async () => {
  const result = await evaluate(exactNegativeFixture());
  expect(result).toMatchObject({ allowed: false, severity: 'BLOCK' });
});
```

The five-symbol table verifies that no directional candidate is actionable with a waiting/unconfirmed context and that each rejection has exactly one selected owning gate.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --filter @platform/api exec vitest run test/pipeline/quant-execution-policy.spec.ts test/pipeline/registered-symbol-execution-replay.spec.ts`

Expected: FAIL because missing cohorts are currently represented only as blocked/advisory without the execution-ready reduced probe contract.

- [ ] **Step 3: Implement the quant authorization contract**

Allow the reduced probe only in DEMO, only after execution readiness passes, and propagate the size factor into risk. Keep LIVE behavior blocked until governed promotion. Deduplicate gate reasons by owner and preserve all non-owning reasons as diagnostics rather than selected blockers.

- [ ] **Step 4: Run all targeted regression tests**

Run: `pnpm --filter @platform/api exec vitest run test/pipeline/execution-readiness.spec.ts test/pipeline/closed-candle-execution-context.spec.ts test/pipeline/quant-execution-policy.spec.ts test/pipeline/registered-symbol-execution-replay.spec.ts test/exchange/order-protection-preflight.spec.ts test/live-trading/protection-and-risk-preflight.spec.ts test/risk/entry-order-policy.spec.ts`

Expected: PASS with no provider- or symbol-specific production branches.

- [ ] **Step 5: Run full verification**

Run: `pnpm test`

Run: `pnpm --filter @platform/api lint`

Run: `pnpm --filter @platform/api typecheck`

Run: `pnpm --filter @platform/api build`

Run: `git diff --check`

Expected: every command exits 0; report exact test counts from fresh output.

- [ ] **Step 6: Commit and push**

```bash
git add apps/api/src/modules/pipeline/application/quant-execution-policy.service.ts apps/api/src/modules/pipeline/application/pipeline-runner.service.ts apps/api/src/modules/pipeline/domain/gate-decision.ts apps/api/test/pipeline/quant-execution-policy.spec.ts apps/api/test/pipeline/registered-symbol-execution-replay.spec.ts
git commit -m "fix(trading): govern fallback probes and replay registered symbols"
git push -u origin fix/execution-invariant-okx-preflight
```
