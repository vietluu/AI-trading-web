import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma, type RiskAssessment } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionOutput, ThesisReview, TradeThesis } from '@platform/shared';
import { RiskManagementService, type AssessRiskInput } from '../../src/modules/risk/application/risk-management.service';
import type { RiskLimits } from '../../src/modules/risk/domain/risk-engine.types';
import { LiveTradingService } from '../../src/modules/live-trading/application/live-trading.service';
import { TradeResearcherService } from '../../src/modules/agents/application/services/trade-researcher.service';
import { ChainOfThoughtReflectionService } from '../../src/modules/agents/application/services/chain-of-thought-reflection.service';
import { AnticipatorySnapshotService } from '../../src/modules/agents/application/services/anticipatory-snapshot.service';
import { DecisionService } from '../../src/modules/agents/application/services/decision.service';
import { PipelineRunnerService } from '../../src/modules/pipeline/application/pipeline-runner.service';
import { applyThesisReview, validateTradeThesis } from '../../src/modules/agents/domain/trade-thesis-validator';
import { createBaseSnapshot, createValidLongThesis, cutoff } from '../helpers/thesis-fixture';

const connectionId = '00000000-0000-4000-8000-000000000001';
const limits: RiskLimits = { riskPerTrade: 0.005, maxPositions: 3, maxLeverage: 10, maxDrawdown: 0.1, maxExposure: 0.5, cooldownMs: 0,
  minimumConfidence: 60, stopLossPct: 0.02, riskRewardRatio: 2, highVolatility: 5, abnormalVolatility: 10, highVolatilitySizeFactor: 0.5,
  estimatedRoundTripCostPct: 0.001, maxStopLossRoe: 0.5, rangeScalpRoeMultiplier: 1.5, minLiquidationBufferPct: 0.01 };
const approve: ThesisReview = { action: 'APPROVE', reasonCodes: [], evidenceRefs: [], rationale: 'Fixture provider review' };

function fixture() {
  let assessment: RiskAssessment | null = null;
  let latestSnapshot: unknown = null;
  let positions: Array<Record<string, unknown>> = [];
  const opportunity = {
    id: 'opportunity-1', userId: 'user-1', provider: 'BINANCE_FUTURES', symbol: 'BTC-USDT', timeframe: '15m',
    setup: 'TREND_PULLBACK', direction: 'LONG', state: 'PROBE_READY', invalidationPrice: 107_500,
    expiresAt: new Date('2026-09-09T12:30:00.000Z'), lastObservedCutoff: new Date('2026-09-09T11:45:00.000Z'), thesisVersion: 1,
  };
  const transitions: Array<Record<string, unknown>> = [];
  const orders: Array<Record<string, unknown>> = [];
  const contexts = new Set<string>();
  const audits: Array<Prisma.AgentRunUncheckedCreateInput> = [];
  const db = {
    agentContextSnapshot: { create: () => { contexts.add('context-1'); return Promise.resolve({ id: 'context-1' }); } },
    agentRun: { create: ({ data }: { data: Prisma.AgentRunUncheckedCreateInput }) => {
      if (!contexts.has(data.contextSnapshotId!)) throw new Error('Invalid context FK');
      audits.push(data); return Promise.resolve({ id: `audit-${audits.length}` });
    } },
    riskAssessment: {
      findUnique: () => Promise.resolve(assessment), findFirst: () => Promise.resolve(assessment),
      upsert: ({ create }: { create: Prisma.RiskAssessmentUncheckedCreateInput }) => {
        assessment = { ...create, id: 'assessment-1', createdAt: new Date() } as RiskAssessment;
        return Promise.resolve(assessment);
      },
    },
    anticipatoryMarketSnapshot: { findFirst: () => Promise.resolve(latestSnapshot) },
    opportunity: {
      findFirst: () => Promise.resolve(opportunity),
      update: ({ data }: { data: Record<string, unknown> }) => { Object.assign(opportunity, data); return Promise.resolve(opportunity); },
    },
    opportunityTransition: {
      upsert: ({ create }: { create: Record<string, unknown> }) => {
        if (!transitions.some((entry) => entry.idempotencyKey === create.idempotencyKey)) transitions.push(create);
        return Promise.resolve(create);
      },
    },
    livePosition: { findFirst: () => Promise.resolve(positions[0] ?? null), findMany: () => Promise.resolve(positions) },
    liveAccountSnapshot: { findFirst: () => Promise.resolve({ totalEquity: 10000, availableBalance: 10000 }), aggregate: () => Promise.resolve({ _max: { totalEquity: 10000 } }) },
    liveOrder: {
      findUnique: () => Promise.resolve(null), findFirst: () => Promise.resolve(null), findMany: () => Promise.resolve([]),
      create: ({ data }: { data: Record<string, unknown> }) => { const row = { ...data, id: 'order-1', createdAt: new Date(), updatedAt: new Date() }; orders.push(row); return Promise.resolve(row); },
      update: ({ data }: { data: Record<string, unknown> }) => { Object.assign(orders[0]!, data); return Promise.resolve(orders[0]); },
    },
    $transaction: (callback: (tx: unknown) => unknown) => callback(db),
  };
  const config = { getUserLimits: () => Promise.resolve(limits) };
  const risk = new RiskManagementService(db as never, config as never);
  const submitted: Array<Record<string, unknown>> = [];
  const connection = { id: connectionId, environment: 'DEMO', provider: 'OKX_FUTURES', isEnabled: true, isVerified: true };
  const exchange = {
    get: () => Promise.resolve(connection), list: () => Promise.resolve([connection]), configuration: () => Promise.resolve({ positionMode: 'ONE_WAY' }),
    placeOrder: (_user: string, _connection: string, command: Record<string, unknown>) => {
      submitted.push(command); return Promise.resolve({ exchangeOrderId: 'exchange-order-1', clientOrderId: command.clientOrderId, status: 'NEW', originalQuantity: command.quantity });
    },
    account: () => Promise.reject(new Error('Fixture exchange unavailable after submission')),
    positions: () => Promise.resolve([]), openOrders: () => Promise.resolve([]),
  };
  let currentPrice = 108_300;
  const liveQuote = vi.fn(() => Promise.resolve({
    provider: 'OKX_FUTURES', symbol: 'BTC-USDT', markPrice: String(currentPrice), lastPrice: String(currentPrice),
  }));
  const live = new LiveTradingService(db as never, exchange as never,
    { values: { mode: 'DEMO', runtimeEnabled: true, approvalTtlMs: 60000, cooldownMs: 0, maxEntryDriftBps: 10 }, assertExecutionAllowed: () => undefined } as never,
    { record: () => Promise.resolve() } as never, config as never, risk, {} as never, { ticker: liveQuote } as never);
  const thesis = createValidLongThesis(); thesis.targets = [{ price: 112000, fraction: 1 }]; thesis.setup = 'TREND_PULLBACK';
  const snapshot = createBaseSnapshot();
  const fullAnalysisTrigger = vi.fn(() => Promise.resolve({ json: { preferred: thesis, alternatives: [] }, provider: 'OPENAI', model: 'fixture', usage: { promptTokens: 1, completionTokens: 1 } }));
  const provider = { execute: fullAnalysisTrigger };
  const researcher = new TradeResearcherService(provider as never, new DecisionService({} as never), db as never);
  const critic = new ChainOfThoughtReflectionService({ execute: () => Promise.resolve({ json: approve }) } as never);
  const context = { userId: 'user-1', parentSnapshotId: 'pipeline-1', configHash: 'fixture-config-hash', promptVersion: 1 };
  const assess = async (applied: TradeThesis, mode: 'OBSERVE' | 'SHADOW' | 'DEMO' = 'DEMO', positions: AssessRiskInput['positions'] = []) => risk.assess(db as never, {
    userId: 'user-1', connectionId, pipelineRunId: 'pipeline-1', symbol: snapshot.symbol,
    decision: { decision: applied.direction, confidence: applied.confidence, regime: { type: 'TRENDING' }, conflictLevel: 'LOW' } as DecisionOutput,
    account: { balance: new Prisma.Decimal(10000), equity: new Prisma.Decimal(10000), peakEquity: new Prisma.Decimal(10000) }, positions, price: 108200, volatility: 0.01,
    tradePlanContext: { timeframeMs: 900000, proactive: { thesisId: 'audit-1', thesis: applied, snapshot, mode, sizeFactor: 1 } },
  });
  return { db, live, submitted, orders, audits, researcher, critic, context, thesis, snapshot, assess, fullAnalysisTrigger, liveQuote, transitions, opportunity, setPositions: (value: Array<Record<string, unknown>>) => { positions = value; }, setCurrentPrice: (price: number) => { currentPrice = price; }, setLatestSnapshot: (value: unknown) => { latestSnapshot = value; }, assessment: () => assessment };
}

describe('joined proactive execution with external IO fixtures', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(cutoff)); vi.stubEnv('PROACTIVE_AI_MODE', 'DEMO'); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it('joins real Researcher, Critic, validator, Risk persistence, and public execution', async () => {
    const f = fixture();
    const research = await f.researcher.research(f.snapshot, f.context);
    const review = await f.critic.reflect({ thesis: research.preferred, snapshot: f.snapshot }, 'user-1');
    const applied = applyThesisReview(research.preferred, review);
    const validation = validateTradeThesis(applied, f.snapshot, { now: new Date() });
    await f.researcher.persistReview({ context: f.context, research, review, appliedThesis: applied, validation });
    expect(await f.assess(applied)).toMatchObject({ approved: true, stopLoss: 107400 });
    expect(f.audits[1]).toMatchObject({ parentRunId: 'audit-1', contextSnapshotId: 'context-1', output: { appliedThesis: { decisionSource: 'AI' } } });
    expect(f.assessment()?.executionAuthorization).toMatchObject({ mode: 'DEMO', connectionId });
    f.fullAnalysisTrigger.mockClear();
    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({ outcome: 'ORDER_SUBMITTED' });
    expect(f.fullAnalysisTrigger).not.toHaveBeenCalled();
    expect(f.submitted).toHaveLength(1);
    expect(f.submitted[0]).toMatchObject({ orderType: 'LIMIT', limitPrice: '108200', timeInForce: 'IOC', expiresAt: '2026-09-09T12:15:00.000Z', takeProfit: '112000' });
    expect(f.orders[0]).toMatchObject({ type: 'LIMIT', tradePlan: { targets: [{ price: 112000, fraction: 1 }] } });
  });
  it('does not submit a DEMO order after the persisted chase limit is exceeded', async () => {
    const f = fixture();
    expect(await f.assess(f.thesis)).toMatchObject({ approved: true });
    f.setCurrentPrice(108_621);

    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({
      outcome: 'EXECUTION_FAILED',
      errorMessage: 'PERSISTED_THESIS_ENTRY_CHASE_DISTANCE_EXCEEDED',
    });
    expect(f.submitted).toEqual([]);
  });
  it.each([
    { name: 'chase expiry', price: 108_621, expectedState: 'TOO_LATE', expectedReason: 'CHASE_DISTANCE_EXCEEDED' },
    { name: 'structural invalidation', price: 107_500, expectedState: 'INVALIDATED', expectedReason: 'THESIS_INVALIDATED' },
    { name: 'thesis expiry', price: 108_300, expectedState: 'EXPIRED', expectedReason: 'THESIS_EXPIRED' },
  ])('persists the canonical terminal transition for $name without an order', async ({ price, expectedState, expectedReason }) => {
    const f = fixture();
    expect(await f.assess(f.thesis)).toMatchObject({ approved: true });
    if (expectedState === 'EXPIRED') (f.assessment()!.executionAuthorization as Prisma.JsonObject).thesis = {
      ...(f.assessment()!.executionAuthorization as Prisma.JsonObject).thesis as Prisma.JsonObject,
      expiresAt: '2026-09-09T12:00:00.000Z',
    };
    f.setLatestSnapshot({ id: 'snapshot-2', snapshotJson: f.snapshot });
    f.setCurrentPrice(price);

    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({
      outcome: 'EXECUTION_FAILED',
      errorMessage: `PERSISTED_THESIS_ENTRY_${expectedReason}`,
    });
    expect(f.opportunity.state).toBe(expectedState);
    expect(f.transitions).toHaveLength(1);
    expect(f.transitions[0]).toMatchObject({
      opportunityId: 'opportunity-1', snapshotId: 'snapshot-2', toState: expectedState, reasonCode: expectedReason,
    });
    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({
      outcome: 'EXECUTION_FAILED',
      errorMessage: `PERSISTED_THESIS_ENTRY_${expectedReason}`,
    });
    expect(f.transitions).toHaveLength(1);
    expect(f.submitted).toEqual([]);
  });
  it('does not close an opposite position before rejecting an invalid persisted thesis', async () => {
    const f = fixture();
    expect(await f.assess(f.thesis)).toMatchObject({ approved: true });
    f.setPositions([{ symbol: 'BTC-USDT', side: 'SHORT', quantity: new Prisma.Decimal(0.01), entryPrice: new Prisma.Decimal(108_200), markPrice: new Prisma.Decimal(108_200), leverage: 1 }]);
    f.setLatestSnapshot({ id: 'snapshot-3', snapshotJson: f.snapshot });
    f.setCurrentPrice(107_500);

    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({
      outcome: 'EXECUTION_FAILED', errorMessage: 'PERSISTED_THESIS_ENTRY_THESIS_INVALIDATED',
    });
    expect(f.submitted).toEqual([]);
  });
  it('uses the latest persisted snapshot ATR without rerunning the researcher', async () => {
    const f = fixture();
    expect(await f.assess(f.thesis)).toMatchObject({ approved: true });
    const latest = structuredClone(f.snapshot);
    if (latest.volatility.coverage !== 'AVAILABLE') throw new Error('fixture volatility must be available');
    latest.volatility.atr = 250;
    f.setLatestSnapshot({ snapshotJson: latest });
    f.setCurrentPrice(108_621);
    f.fullAnalysisTrigger.mockClear();

    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({
      outcome: 'EXECUTION_FAILED',
      errorMessage: 'PERSISTED_THESIS_ENTRY_PULLBACK_PENDING',
    });
    expect(f.fullAnalysisTrigger).not.toHaveBeenCalled();
    expect(f.submitted).toEqual([]);
  });
  it('REQUIRE_TRIGGER remains no-order after real Risk persistence', async () => {
    const f = fixture(); const thesis = applyThesisReview(f.thesis, { ...approve, action: 'REQUIRE_TRIGGER' });
    expect(await f.assess(thesis)).toMatchObject({ approved: false, reason: 'THESIS_NOT_EXECUTABLE' });
    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({ outcome: 'RISK_REJECTED' });
    expect(f.submitted).toEqual([]);
  });
  it.each(['OBSERVE', 'SHADOW'] as const)('%s risk approval cannot be consumed by the public execution path', async (mode) => {
    const f = fixture(); expect((await f.assess(f.thesis, mode)).approved).toBe(true);
    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({ outcome: 'PROACTIVE_EXECUTION_NOT_AUTHORIZED' });
    expect(f.submitted).toEqual([]);
  });
  it('rejects the range midpoint through real Risk and stored assessment', async () => {
    const f = fixture(); f.thesis.setup = 'RANGE_REVERSAL';
    if (f.snapshot.structure.coverage === 'AVAILABLE') f.snapshot.structure.rangeBoundaries = { lower: 106200, upper: 110200 };
    expect(await f.assess(f.thesis)).toMatchObject({ approved: false, reason: 'RANGE_MIDPOINT_ENTRY_BLOCKED' });
    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({ outcome: 'RISK_REJECTED' });
  });
  it('requires available execution evidence at the real snapshot-to-risk boundary', async () => {
    const f = fixture();
    const snapshots = new AnticipatorySnapshotService({ getClosedCandles: () => Promise.resolve([]), getLatestIndicatorSnapshot: () => Promise.resolve(null), getFundingRates: () => Promise.resolve([]), getOpenInterestHistory: () => Promise.resolve([]) } as never,
      { findLatestAnticipatoryContext: () => Promise.resolve(undefined), saveAnticipatorySnapshot: () => Promise.resolve() } as never);
    const unavailable = await snapshots.build({ userId: 'user-1', provider: 'OKX_FUTURES' as never, symbol: f.snapshot.symbol, timeframe: '15m' as never, sourceDataCutoff: new Date() });
    f.snapshot.execution = unavailable.execution;
    expect(f.snapshot.execution.coverage).toBe('UNAVAILABLE');
    expect(await f.assess(f.thesis)).toMatchObject({ approved: false, reason: 'THESIS_STALE' });
    expect(f.submitted).toEqual([]);
  });
  it('preserves the combined exposure cap when a stored protected probe is confirmed', async () => {
    const f = fixture(); f.thesis.state = 'CONFIRMED';
    const position: AssessRiskInput['positions'][number] = { symbol: f.snapshot.symbol, side: 'LONG', size: new Prisma.Decimal(0.04), entryPrice: new Prisma.Decimal(108100), markPrice: new Prisma.Decimal(108200), stopLoss: new Prisma.Decimal(107400), protectionVerified: true,
      stagedEntry: { stage: 'PROBE', thesisId: 'audit-1', setup: 'TREND_PULLBACK', sourceDataCutoff: '2026-09-09T11:45:00Z', trigger: [{ type: 'PRICE_ABOVE', price: 108100, description: 'Declared before probe' }] } };
    const risk = await f.assess(f.thesis, 'DEMO', [position]);
    expect(risk.approved).toBe(true);
    expect((Number(position.size) + risk.positionSize!) * 108200 / 10000).toBeLessThanOrEqual(0.500001);
    expect(f.assessment()?.exposurePct).toBeLessThanOrEqual(0.5);
    expect(f.assessment()?.tradePlan).toMatchObject({ stagedEntry: { stage: 'CONFIRMED' } });
  });
  it('persists combined loss rejection using the actual protected probe stop', async () => {
    const f = fixture(); f.thesis.state = 'CONFIRMED';
    expect(await f.assess(f.thesis, 'DEMO', [{ symbol: f.snapshot.symbol, side: 'LONG', size: new Prisma.Decimal(-0.04), entryPrice: new Prisma.Decimal(108100), markPrice: new Prisma.Decimal(108200), stopLoss: new Prisma.Decimal(100000), protectionVerified: true,
      stagedEntry: { stage: 'PROBE', thesisId: 'audit-1', setup: 'TREND_PULLBACK', sourceDataCutoff: '2026-09-09T11:45:00Z', trigger: [{ type: 'PRICE_ABOVE', price: 108100, description: 'Declared before probe' }] } }])).toMatchObject({ approved: false, reason: 'COMBINED_THESIS_RISK_EXCEEDED' });
    expect(await f.live.executePipeline('user-1', 'pipeline-1')).toMatchObject({ outcome: 'RISK_REJECTED' });
    expect(f.submitted).toEqual([]);
  });
  it('public execution rejects a plan deadline that elapsed after assessment', async () => {
    const f = fixture(); await f.assess(f.thesis);
    const plan = f.assessment()!.tradePlan as Prisma.JsonObject;
    plan.expiresAt = '2026-09-09T12:00:01.000Z';
    vi.setSystemTime(new Date('2026-09-09T12:00:02Z'));
    await expect(f.live.execute('user-1', { connectionId, riskAssessmentId: 'assessment-1', clientOrderId: 'expired' }, {}, { skipPreExecutionSync: true })).rejects.toThrow('THESIS_ORDER_EXPIRED');
    expect(f.submitted).toEqual([]);
  });
  it('public execution cannot replace multiple declared targets with an aggregate TP', async () => {
    const f = fixture(); await f.assess(f.thesis);
    const auth = f.assessment()!.executionAuthorization as Prisma.JsonObject;
    (auth.thesis as Prisma.JsonObject).targets = createValidLongThesis().targets;
    await expect(f.live.execute('user-1', { connectionId, riskAssessmentId: 'assessment-1', clientOrderId: 'invalid-targets' }, {}, { skipPreExecutionSync: true })).rejects.toThrow('THESIS_EXECUTION_PLAN_MISMATCH');
    expect(f.submitted).toEqual([]);
  });
  it('resolves optional proactive dependencies through real Nest provider tokens', async () => {
    const f = fixture();
    const snapshots = new AnticipatorySnapshotService({} as never, {} as never);
    // Vitest's transform does not emit design:paramtypes. Exercise the production
    // explicit tokens through Nest without inventing tokens for unrelated runner dependencies.
    class ProactiveDependencies {
      constructor(readonly researcher: TradeResearcherService, readonly critic: ChainOfThoughtReflectionService, readonly snapshot: AnticipatorySnapshotService) {}
    }
    const tokens = Reflect.getMetadata('self:paramtypes', PipelineRunnerService) as Array<{ index: number; param: unknown }>;
    const proactiveTokens = tokens.filter((token) => token.index >= 16).map((token) => ({ ...token, index: token.index - 16 }));
    expect(proactiveTokens).toHaveLength(3);
    Reflect.defineMetadata('self:paramtypes', proactiveTokens, ProactiveDependencies);
    @Module({ providers: [ProactiveDependencies, { provide: TradeResearcherService, useValue: f.researcher }, { provide: ChainOfThoughtReflectionService, useValue: f.critic }, { provide: AnticipatorySnapshotService, useValue: snapshots }] })
    class FixtureModule {}
    const app = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
    try {
      const dependencies = app.get(ProactiveDependencies);
      expect(dependencies.researcher).toBe(f.researcher);
      expect(dependencies.critic).toBe(f.critic);
      expect(dependencies.snapshot).toBe(snapshots);
    } finally { await app.close(); }
  });
});
