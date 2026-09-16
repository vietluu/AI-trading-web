import { describe, expect, it, vi } from 'vitest';
import type { DecisionOutput } from '@platform/shared';
import { buildExecutionContext } from '../../src/modules/pipeline/domain/execution-context';
import { evaluateExecutionReadiness } from '../../src/modules/pipeline/domain/execution-readiness';
import {
  type GateDecisionRecord,
  selectBlockingGate,
} from '../../src/modules/pipeline/domain/gate-decision';
import { QuantExecutionPolicyService } from '../../src/modules/pipeline/application/quant-execution-policy.service';

interface SymbolFixture {
  symbol: string;
  price: number;
  atr: number;
  support: number;
  resistance: number;
  direction: 'LONG' | 'SHORT';
  setup: 'TREND_PULLBACK' | 'RANGE_REVERSION';
}

const REGISTERED_SYMBOLS: SymbolFixture[] = [
  {
    symbol: 'SOL-USDT',
    price: 152.4,
    atr: 2.5,
    support: 148.0,
    resistance: 156.0,
    direction: 'LONG',
    setup: 'TREND_PULLBACK',
  },
  {
    symbol: 'BNB-USDT',
    price: 585.0,
    atr: 8.0,
    support: 570.0,
    resistance: 600.0,
    direction: 'LONG',
    setup: 'TREND_PULLBACK',
  },
  {
    symbol: 'ARB-USDT',
    price: 0.575,
    atr: 0.02,
    support: 0.50,
    resistance: 0.58,
    direction: 'SHORT',
    setup: 'RANGE_REVERSION',
  },
  {
    symbol: 'ZEC-USDT',
    price: 32.5,
    atr: 1.2,
    support: 30.0,
    resistance: 35.0,
    direction: 'LONG',
    setup: 'TREND_PULLBACK',
  },
  {
    symbol: 'ZRO-USDT',
    price: 0.9847,
    atr: 0.04,
    support: 0.95,
    resistance: 1.05,
    direction: 'LONG',
    setup: 'TREND_PULLBACK',
  },
];

const sourceCutoff = new Date('2026-09-16T12:00:00.000Z');

function createDecision(
  fixture: SymbolFixture,
  contextOptions: {
    action: 'WAIT' | 'ENTER' | 'PROBE';
    triggerConfirmed: boolean;
    primaryCandleClosed: boolean;
  },
): DecisionOutput {
  const executionContext = buildExecutionContext({
    regime: fixture.setup === 'TREND_PULLBACK' ? 'TRENDING' : 'RANGING',
    setup: fixture.setup,
    action: contextOptions.action,
    price: fixture.price,
    support: fixture.support,
    resistance: fixture.resistance,
    atr: fixture.atr,
    sourceDataCutoff: sourceCutoff,
    primaryCandleClosed: contextOptions.primaryCandleClosed,
    triggerConfirmed: contextOptions.triggerConfirmed,
  });

  return {
    decision: fixture.direction,
    confidence: 78,
    opportunityScore: 74,
    expectedValue: 0.85,
    riskScore: 50,
    regime: { type: fixture.setup === 'TREND_PULLBACK' ? 'TRENDING' : 'RANGING' },
    dataQuality: 'GOOD',
    coreDataQuality: 'GOOD',
    directionalAgreement: 100,
    evidenceCoverage: 100,
    conflictLevel: 'LOW',
    adaptiveThreshold: 65,
    volatilityAdjustment: 0,
    executionContext,
  } as unknown as DecisionOutput;
}

function buildQuantService(validation: Record<string, unknown> | null) {
  return new QuantExecutionPolicyService(
    {
      researchValidationRun: { findFirst: vi.fn().mockResolvedValue(validation) },
      marketRegimeState: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never,
    { getUserLimits: () => Promise.resolve({ maxLeverage: 3, riskPerTrade: 0.02 }) } as never,
  );
}

describe('Registered Symbol Execution Replay (SOL, BNB, ARB, ZEC, ZRO)', () => {
  describe.each(REGISTERED_SYMBOLS)('$symbol execution invariants and gate attribution', (fixture) => {
    it('is never actionable when execution context action is WAIT or unconfirmed, attributing strictly to EXECUTION_READINESS', async () => {
      const decision = createDecision(fixture, {
        action: 'WAIT',
        triggerConfirmed: false,
        primaryCandleClosed: false,
      });

      const readiness = evaluateExecutionReadiness(decision);
      expect(readiness.allowed).toBe(false);

      const quantService = buildQuantService(null);
      const quant = await quantService.evaluate({
        userId: 'user-1',
        symbol: fixture.symbol,
        provider: 'OKX_FUTURES',
        timeframe: '15m',
        mode: 'DEMO',
        decision,
        executionReady: readiness.allowed,
      });

      const gates: GateDecisionRecord[] = [
        {
          stage: 'SIGNAL_FILTER',
          disposition: 'PASS',
          reasonCodes: [],
        },
        {
          stage: 'EXECUTION_READINESS',
          disposition: readiness.allowed ? 'PASS' : 'BLOCK',
          reasonCodes: readiness.reasonCodes,
        },
        {
          stage: 'JUDGE',
          disposition: 'PASS',
          reasonCodes: [],
        },
        {
          stage: 'QUANT',
          disposition: !quant.allowed
            ? quant.executionPolicy === 'ADVISORY' || quant.advisory
              ? 'ADVISORY'
              : 'BLOCK'
            : quant.severity === 'REDUCE_SIZE'
              ? 'REDUCE_SIZE'
              : 'PASS',
          reasonCodes: quant.reason ? [quant.reason] : [],
        },
      ];

      const actionable = gates.every((g) => g.disposition === 'PASS' || g.disposition === 'REDUCE_SIZE' || g.disposition === 'ADVISORY') &&
        readiness.allowed;
      expect(actionable).toBe(false);

      const blockingGate = selectBlockingGate(gates);
      expect(blockingGate).toBeDefined();
      expect(blockingGate).toEqual({
        stage: 'EXECUTION_READINESS',
        reason: 'ENTRY_ACTION_NOT_EXECUTABLE',
      });
    });

    it('becomes actionable with a reduced DEMO probe when closed candle trigger passes and quant is a new cohort', async () => {
      const decision = createDecision(fixture, {
        action: 'ENTER',
        triggerConfirmed: true,
        primaryCandleClosed: true,
      });

      const readiness = evaluateExecutionReadiness(decision);
      expect(readiness.allowed).toBe(true);

      const quantService = buildQuantService(null);
      const quant = await quantService.evaluate({
        userId: 'user-1',
        symbol: fixture.symbol,
        provider: 'OKX_FUTURES',
        timeframe: '15m',
        mode: 'DEMO',
        decision,
        executionReady: readiness.allowed,
      });

      expect(quant.allowed).toBe(true);
      expect(quant.severity).toBe('REDUCE_SIZE');
      expect(quant.executionPolicy).toBe('PROBE');

      const gates: GateDecisionRecord[] = [
        {
          stage: 'SIGNAL_FILTER',
          disposition: 'PASS',
          reasonCodes: [],
        },
        {
          stage: 'EXECUTION_READINESS',
          disposition: 'PASS',
          reasonCodes: [],
        },
        {
          stage: 'JUDGE',
          disposition: 'PASS',
          reasonCodes: [],
        },
        {
          stage: 'QUANT',
          disposition: 'REDUCE_SIZE',
          reasonCodes: quant.reason ? [quant.reason] : [],
        },
      ];

      const blockingGate = selectBlockingGate(gates);
      expect(blockingGate).toBeUndefined();

      const actionable = readiness.allowed && quant.allowed;
      expect(actionable).toBe(true);
    });

    it('attributes hard block to QUANT when exact mature negative evidence exists, even if execution readiness passed', async () => {
      const decision = createDecision(fixture, {
        action: 'ENTER',
        triggerConfirmed: true,
        primaryCandleClosed: true,
      });

      const readiness = evaluateExecutionReadiness(decision);
      expect(readiness.allowed).toBe(true);

      const negativeValidation = {
        interval: '15m',
        probabilityOfProfit: 30,
        probabilityOfRuin: 100,
        outOfSampleSharpe: -1.5,
        walkForwardStable: false,
        confidenceBrierScore: 0.18,
        createdAt: new Date(),
        metricsJson: {
          sampleEvidence: { totalTrades: 60, outOfSampleTrades: 15 },
          cohort: {
            symbol: fixture.symbol,
            setup: fixture.setup,
            direction: fixture.direction,
            regime: 'ANY',
            executionPolicy: 'DEFAULT',
            configurationVersion: 1,
          },
          executionAssumptions: { leverage: 3, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
        },
      };

      const quantService = buildQuantService(negativeValidation);
      const quant = await quantService.evaluate({
        userId: 'user-1',
        symbol: fixture.symbol,
        provider: 'OKX_FUTURES',
        timeframe: '15m',
        mode: 'DEMO',
        decision,
        executionReady: readiness.allowed,
      });

      expect(quant.allowed).toBe(false);
      expect(quant.severity).toBe('BLOCK');

      const gates: GateDecisionRecord[] = [
        {
          stage: 'SIGNAL_FILTER',
          disposition: 'PASS',
          reasonCodes: [],
        },
        {
          stage: 'EXECUTION_READINESS',
          disposition: 'PASS',
          reasonCodes: [],
        },
        {
          stage: 'QUANT',
          disposition: 'BLOCK',
          reasonCodes: [quant.reason ?? 'QUANT_WALK_FORWARD_UNSTABLE'],
        },
      ];

      const blockingGate = selectBlockingGate(gates);
      expect(blockingGate).toBeDefined();
      expect(blockingGate?.stage).toBe('QUANT');
    });
  });
});
