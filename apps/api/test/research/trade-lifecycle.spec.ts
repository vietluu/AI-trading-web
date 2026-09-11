import { describe, expect, it, vi } from 'vitest';
import type {
  TradeLifecycleEvent,
  TradeLifecycleOutcome,
} from '../../src/modules/research/domain/trade-lifecycle';
import {
  aggregateLifecycle,
  aggregateLifecyclesByThesis,
  TradeLifecycleRepository,
  TradeLifecycleFinalizedError,
} from '../../src/modules/research/domain/trade-lifecycle';

describe('Trade Lifecycle Evaluation - Domain & Persistence', () => {
  const thesisId = '7f8b9c1d-2e3f-4a5b-6c7d-8e9f0a1b2c3d';

  it('aggregates probe, add, partial, stop tightening, and final close into one lifecycle outcome with signed fees and funding', () => {
    const events: TradeLifecycleEvent[] = [
      {
        thesisId,
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'PROBE',
        price: 100,
        quantity: 1.0,
        signedFee: -0.1,
        stopLoss: 95,
        timestamp: new Date('2026-09-09T12:00:00.000Z'),
      },
      {
        thesisId,
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'ADD',
        price: 105,
        quantity: 1.0,
        signedFee: -0.1,
        timestamp: new Date('2026-09-09T12:15:00.000Z'),
      },
      {
        thesisId,
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'FUNDING',
        signedFunding: -0.05,
        timestamp: new Date('2026-09-09T12:30:00.000Z'),
      },
      {
        thesisId,
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'STOP_TIGHTEN',
        stopLoss: 102.5,
        timestamp: new Date('2026-09-09T12:45:00.000Z'),
      },
      {
        thesisId,
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'PARTIAL',
        price: 110,
        quantity: 1.0,
        signedFee: -0.1,
        timestamp: new Date('2026-09-09T13:00:00.000Z'),
      },
      {
        thesisId,
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'FINAL_CLOSE',
        price: 115,
        quantity: 1.0,
        signedFee: -0.1,
        timestamp: new Date('2026-09-09T13:30:00.000Z'),
      },
    ];

    const outcome = aggregateLifecycle(events);

    expect(outcome.thesisId).toBe(thesisId);
    expect(outcome.symbol).toBe('BTC-USDT');
    expect(outcome.direction).toBe('LONG');
    expect(outcome.status).toBe('FINALIZED');
    expect(outcome.totalEnteredQuantity).toBe(2.0);
    expect(outcome.totalExitedQuantity).toBe(2.0);
    expect(outcome.averageEntryPrice).toBe(102.5);
    expect(outcome.averageExitPrice).toBe(112.5);
    expect(outcome.realizedGrossPnl).toBe(20.0);
    expect(outcome.signedFees).toBe(-0.4);
    expect(outcome.signedFunding).toBe(-0.05);
    expect(outcome.realizedNetPnl).toBe(19.55);
    expect(outcome.initialRisk).toBe(5.0);
    expect(outcome.netR).toBeCloseTo(3.91, 2);
    expect(outcome.finalStopLoss).toBe(102.5);
    expect(outcome.openedAt).toEqual(new Date('2026-09-09T12:00:00.000Z'));
    expect(outcome.closedAt).toEqual(new Date('2026-09-09T13:30:00.000Z'));
  });

  it('aggregates short lifecycle with positive funding rebate', () => {
    const shortThesisId = '8f8b9c1d-2e3f-4a5b-6c7d-8e9f0a1b2c3e';
    const events: TradeLifecycleEvent[] = [
      {
        thesisId: shortThesisId,
        symbol: 'ETH-USDT',
        direction: 'SHORT',
        type: 'PROBE',
        price: 2000,
        quantity: 2.0,
        signedFee: -2.0,
        stopLoss: 2050,
        timestamp: new Date('2026-09-09T14:00:00.000Z'),
      },
      {
        thesisId: shortThesisId,
        symbol: 'ETH-USDT',
        direction: 'SHORT',
        type: 'FUNDING',
        signedFunding: 1.5,
        timestamp: new Date('2026-09-09T14:30:00.000Z'),
      },
      {
        thesisId: shortThesisId,
        symbol: 'ETH-USDT',
        direction: 'SHORT',
        type: 'FINAL_CLOSE',
        price: 1900,
        quantity: 2.0,
        signedFee: -2.0,
        timestamp: new Date('2026-09-09T15:00:00.000Z'),
      },
    ];

    const outcome = aggregateLifecycle(events);

    expect(outcome.thesisId).toBe(shortThesisId);
    expect(outcome.direction).toBe('SHORT');
    expect(outcome.realizedGrossPnl).toBe(200);
    expect(outcome.signedFees).toBe(-4.0);
    expect(outcome.signedFunding).toBe(1.5);
    expect(outcome.realizedNetPnl).toBe(197.5);
    expect(outcome.initialRisk).toBe(100);
    expect(outcome.netR).toBeCloseTo(1.975, 3);
  });

  it('aggregates events by thesis rather than order', () => {
    const thesisA = 'aaaa1111-2e3f-4a5b-6c7d-8e9f0a1b2c3d';
    const thesisB = 'bbbb2222-2e3f-4a5b-6c7d-8e9f0a1b2c3d';

    const events: TradeLifecycleEvent[] = [
      {
        thesisId: thesisA,
        orderId: 'order-1',
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'PROBE',
        price: 100,
        quantity: 1.0,
        signedFee: -0.1,
        timestamp: new Date('2026-09-09T12:00:00.000Z'),
      },
      {
        thesisId: thesisB,
        orderId: 'order-2',
        symbol: 'SOL-USDT',
        direction: 'SHORT',
        type: 'PROBE',
        price: 150,
        quantity: 10.0,
        signedFee: -0.5,
        timestamp: new Date('2026-09-09T12:05:00.000Z'),
      },
      {
        thesisId: thesisA,
        orderId: 'order-3',
        symbol: 'BTC-USDT',
        direction: 'LONG',
        type: 'FINAL_CLOSE',
        price: 110,
        quantity: 1.0,
        signedFee: -0.1,
        timestamp: new Date('2026-09-09T12:30:00.000Z'),
      },
      {
        thesisId: thesisB,
        orderId: 'order-4',
        symbol: 'SOL-USDT',
        direction: 'SHORT',
        type: 'FINAL_CLOSE',
        price: 140,
        quantity: 10.0,
        signedFee: -0.5,
        timestamp: new Date('2026-09-09T12:40:00.000Z'),
      },
    ];

    const outcomes = aggregateLifecyclesByThesis(events);
    expect(outcomes).toHaveLength(2);

    const outcomeA = outcomes.find((o) => o.thesisId === thesisA);
    const outcomeB = outcomes.find((o) => o.thesisId === thesisB);

    expect(outcomeA?.realizedGrossPnl).toBe(10);
    expect(outcomeA?.signedFees).toBe(-0.2);
    expect(outcomeB?.realizedGrossPnl).toBe(100);
    expect(outcomeB?.signedFees).toBe(-1.0);
  });

  describe('TradeLifecycleRepository immutability', () => {
    it('prevents mutation of finalized outcomes', async () => {
      const existingFinalizedOutcome: TradeLifecycleOutcome = {
        id: 'out-1',
        thesisId,
        symbol: 'BTC-USDT',
        provider: 'BINANCE_FUTURES',
        timeframe: '15m',
        direction: 'LONG',
        status: 'FINALIZED',
        sourceDataCutoff: new Date('2026-09-09T12:00:00.000Z'),
        openedAt: new Date('2026-09-09T12:00:00.000Z'),
        closedAt: new Date('2026-09-09T13:30:00.000Z'),
        totalEnteredQuantity: 2.0,
        totalExitedQuantity: 2.0,
        averageEntryPrice: 102.5,
        averageExitPrice: 112.5,
        realizedGrossPnl: 20.0,
        signedFees: -0.4,
        signedFunding: -0.05,
        realizedNetPnl: 19.55,
        initialRisk: 5.0,
        netR: 3.91,
        configurationHash: 'conf-hash-1',
        schemaVersion: 1,
        calculationVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPrisma = {
        tradeLifecycleOutcome: {
          findUnique: vi.fn().mockResolvedValue(existingFinalizedOutcome),
          create: vi.fn(),
          update: vi.fn(),
        },
      };

      const repo = new TradeLifecycleRepository(mockPrisma as never);

      await expect(
        repo.recordOutcome({
          ...existingFinalizedOutcome,
          realizedNetPnl: 999.0,
        }),
      ).rejects.toThrow(TradeLifecycleFinalizedError);

      expect(mockPrisma.tradeLifecycleOutcome.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeLifecycleOutcome.create).not.toHaveBeenCalled();
    });

    it('allows recording an open outcome and later finalizing it once', async () => {
      const openOutcome: TradeLifecycleOutcome = {
        id: 'out-2',
        thesisId: 'open-thesis-1',
        symbol: 'BTC-USDT',
        provider: 'BINANCE_FUTURES',
        timeframe: '15m',
        direction: 'LONG',
        status: 'OPEN',
        sourceDataCutoff: new Date('2026-09-09T12:00:00.000Z'),
        openedAt: new Date('2026-09-09T12:00:00.000Z'),
        closedAt: null,
        totalEnteredQuantity: 1.0,
        totalExitedQuantity: 0,
        averageEntryPrice: 100.0,
        averageExitPrice: null,
        realizedGrossPnl: 0,
        signedFees: -0.1,
        signedFunding: 0,
        realizedNetPnl: -0.1,
        initialRisk: 5.0,
        netR: null,
        configurationHash: 'conf-hash-1',
        schemaVersion: 1,
        calculationVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPrisma = {
        tradeLifecycleOutcome: {
          findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(openOutcome),
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'out-2', ...data })),
          update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...openOutcome, ...data })),
        },
      };

      const repo = new TradeLifecycleRepository(mockPrisma as never);

      await repo.recordOutcome(openOutcome);
      expect(mockPrisma.tradeLifecycleOutcome.create).toHaveBeenCalledTimes(1);

      const finalized = {
        ...openOutcome,
        status: 'FINALIZED' as const,
        closedAt: new Date('2026-09-09T13:30:00.000Z'),
        totalExitedQuantity: 1.0,
        averageExitPrice: 110.0,
        realizedGrossPnl: 10.0,
        realizedNetPnl: 9.9,
      };
      await repo.recordOutcome(finalized);
      expect(mockPrisma.tradeLifecycleOutcome.update).toHaveBeenCalledTimes(1);
    });
  });
});
