import { describe, expect, it } from 'vitest';
import {
  replayExecution,
  type ExecutionReplayInput,
  type ReplayCandle,
  type ReplayCandidateThesis,
} from '../../src/modules/research/domain/execution-replay-engine';

describe('Portfolio-aware Execution Replay Engine', () => {
  const defaultProvenance = {
    source: 'HISTORICAL_EXCHANGE_DATA',
    symbols: ['BTC-USDT'],
    startTime: new Date('2026-09-09T10:00:00.000Z'),
    endTime: new Date('2026-09-09T12:00:00.000Z'),
    totalCandles: 8,
  };

  it('1. Next-observation entry: executes no earlier than the next candle after cutoff', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    const candleAtCutoff: ReplayCandle = {
      symbol: 'BTC-USDT',
      openTime: new Date('2026-09-09T10:00:00.000Z'),
      closeTime: new Date('2026-09-09T10:15:00.000Z'),
      open: 100,
      high: 105,
      low: 95,
      close: 102,
    };
    const nextCandle: ReplayCandle = {
      symbol: 'BTC-USDT',
      openTime: new Date('2026-09-09T10:15:00.000Z'),
      closeTime: new Date('2026-09-09T10:30:00.000Z'),
      open: 102,
      high: 108,
      low: 101,
      close: 107,
    };
    const exitCandle: ReplayCandle = {
      symbol: 'BTC-USDT',
      openTime: new Date('2026-09-09T10:30:00.000Z'),
      closeTime: new Date('2026-09-09T10:45:00.000Z'),
      open: 107,
      high: 112,
      low: 106,
      close: 111,
    };

    const thesis: ReplayCandidateThesis = {
      thesisId: 'thesis-next-obs-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      takeProfit: 110,
      stopLoss: 95,
    };

    const input: ExecutionReplayInput = {
      initialBalance: 10000,
      theses: [thesis],
      candles: [candleAtCutoff, nextCandle, exitCandle],
      provenance: defaultProvenance,
    };

    const report = replayExecution(input);

    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0]!;
    // Entry MUST NOT have filled on the cutoff candle (10:00:00)
    expect(outcome.openedAt.getTime()).toBeGreaterThan(cutoffTime.getTime());
    expect(outcome.openedAt).toEqual(nextCandle.openTime);
    expect(outcome.averageEntryPrice).toBeCloseTo(102, 1);
  });

  it('2. Unfilled limit TTL: cancels order if limit price is not reached within limitTtlCandles', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    // Limit price is 95, but market stays above 98 for TTL of 2 candles
    const candles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 101,
        high: 103,
        low: 98,
        close: 102,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:30:00.000Z'),
        closeTime: new Date('2026-09-09T10:45:00.000Z'),
        open: 102,
        high: 104,
        low: 99,
        close: 103,
      },
      // Candle 3: price now drops to 94, but TTL of 2 candles has already expired!
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:45:00.000Z'),
        closeTime: new Date('2026-09-09T11:00:00.000Z'),
        open: 103,
        high: 103,
        low: 94,
        close: 95,
      },
    ];

    const thesis: ReplayCandidateThesis = {
      thesisId: 'thesis-ttl-expired',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'LIMIT',
      limitPrice: 95,
      limitTtlCandles: 2,
      takeProfit: 110,
      stopLoss: 90,
    };

    const report = replayExecution({
      initialBalance: 10000,
      theses: [thesis],
      candles,
      provenance: defaultProvenance,
    });

    expect(report.outcomes).toHaveLength(0);
    expect(report.metrics.unfilledThesesCount).toBe(1);
    expect(report.metrics.executedThesesCount).toBe(0);
  });

  it('3a. Ambiguous same-candle SL/TP order: defaults to stop-first conservatively without finer data', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    const candles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        // Entry fills here at 100
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      },
      {
        // Ambiguous candle: Low 90 hits SL (95), High 115 hits TP (110)
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:30:00.000Z'),
        closeTime: new Date('2026-09-09T10:45:00.000Z'),
        open: 101,
        high: 115,
        low: 90,
        close: 105,
      },
    ];

    const thesis: ReplayCandidateThesis = {
      thesisId: 'thesis-ambiguous-stop-first',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      stopLoss: 95,
      takeProfit: 110,
    };

    const report = replayExecution({
      initialBalance: 10000,
      theses: [thesis],
      candles,
      assumptions: { stopFirstAmbiguity: true, slippageRate: 0 },
      provenance: defaultProvenance,
    });

    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0]!;
    // Must be stopped out first, not taking profit
    expect(outcome.exitReason).toBe('STOP_LOSS');
    expect(outcome.averageExitPrice).toBeCloseTo(95, 2);
    expect(outcome.realizedGrossPnl).toBeLessThan(0);
    expect(outcome.netR).toBeLessThan(0);
  });

  it('3b. Ambiguous same-candle SL/TP order: resolves to TP if finer data shows TP occurred before SL', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    const candles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:30:00.000Z'),
        closeTime: new Date('2026-09-09T10:45:00.000Z'),
        open: 101,
        high: 115,
        low: 90,
        close: 92,
        // Chronological finer quotes: reaches 112 (TP triggered) before dumping to 90 (SL)
        finerQuotes: [
          { timestamp: new Date('2026-09-09T10:32:00.000Z'), price: 104 },
          { timestamp: new Date('2026-09-09T10:35:00.000Z'), price: 112 },
          { timestamp: new Date('2026-09-09T10:40:00.000Z'), price: 90 },
        ],
      },
    ];

    const thesis: ReplayCandidateThesis = {
      thesisId: 'thesis-finer-tp-first',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      stopLoss: 95,
      takeProfit: 110,
    };

    const report = replayExecution({
      initialBalance: 10000,
      theses: [thesis],
      candles,
      assumptions: { stopFirstAmbiguity: true, slippageRate: 0 },
      provenance: defaultProvenance,
    });

    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0]!;
    expect(outcome.exitReason).toBe('TAKE_PROFIT');
    expect(outcome.averageExitPrice).toBeCloseTo(110, 2);
    expect(outcome.realizedGrossPnl).toBeGreaterThan(0);
  });

  it('4. Funding rate payment / rebate calculations: debit for long on positive rate, rebate for short', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    const candles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:30:00.000Z'),
        closeTime: new Date('2026-09-09T10:45:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:45:00.000Z'),
        closeTime: new Date('2026-09-09T11:00:00.000Z'),
        open: 100,
        high: 110,
        low: 99,
        close: 110,
      },
    ];

    // Funding event occurs at 10:30:00 with rate = +0.001 (+0.1%)
    const fundingRates = [
      {
        symbol: 'BTC-USDT',
        timestamp: new Date('2026-09-09T10:30:00.000Z'),
        rate: 0.001,
      },
    ];

    const longThesis: ReplayCandidateThesis = {
      thesisId: 'thesis-long-funding',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      stopLoss: 90,
      takeProfit: 110,
    };

    const reportLong = replayExecution({
      initialBalance: 10000,
      theses: [longThesis],
      candles,
      fundingRates,
      assumptions: { feeRate: 0, slippageRate: 0 },
      provenance: defaultProvenance,
    });

    const longOutcome = reportLong.outcomes[0]!;
    // For LONG: positive funding rate means payment (negative signed funding)
    expect(longOutcome.signedFunding).toBeLessThan(0);

    const shortThesis: ReplayCandidateThesis = {
      thesisId: 'thesis-short-funding',
      symbol: 'BTC-USDT',
      direction: 'SHORT',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      stopLoss: 110,
      takeProfit: 90,
    };

    const candlesForShort: ReplayCandle[] = [
      ...candles.slice(0, 3),
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:45:00.000Z'),
        closeTime: new Date('2026-09-09T11:00:00.000Z'),
        open: 100,
        high: 101,
        low: 90,
        close: 90,
      },
    ];

    const reportShort = replayExecution({
      initialBalance: 10000,
      theses: [shortThesis],
      candles: candlesForShort,
      fundingRates,
      assumptions: { feeRate: 0, slippageRate: 0 },
      provenance: defaultProvenance,
    });

    const shortOutcome = reportShort.outcomes[0]!;
    // For SHORT: positive funding rate means receipt/rebate (positive signed funding)
    expect(shortOutcome.signedFunding).toBeGreaterThan(0);
  });

  it('5. Entry drift & slippage: applies directional slippage and rejects if drift exceeds tolerance', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    const slippageRate = 0.002; // 0.2%

    const normalCandles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 100,
        high: 105,
        low: 99,
        close: 102,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:30:00.000Z'),
        closeTime: new Date('2026-09-09T10:45:00.000Z'),
        open: 102,
        high: 112,
        low: 101,
        close: 110,
      },
    ];

    const thesis: ReplayCandidateThesis = {
      thesisId: 'thesis-slippage',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      stopLoss: 90,
      takeProfit: 110,
    };

    const report = replayExecution({
      initialBalance: 10000,
      theses: [thesis],
      candles: normalCandles,
      assumptions: { slippageRate, feeRate: 0 },
      provenance: defaultProvenance,
    });

    const outcome = report.outcomes[0]!;
    // LONG entry at 100 with 0.2% slippage -> 100.2
    expect(outcome.averageEntryPrice).toBeCloseTo(100 * (1 + slippageRate), 2);
    // LONG exit at 110 with 0.2% slippage -> 109.78
    expect(outcome.averageExitPrice).toBeCloseTo(110 * (1 - slippageRate), 2);

    // Now test entry price drift rejection:
    // Expected price around 100, but next candle opens with huge gap to 110 (+10%)
    const gapCandles: ReplayCandle[] = [
      normalCandles[0]!,
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 110, // 10% drift
        high: 112,
        low: 109,
        close: 111,
      },
    ];

    const driftThesis: ReplayCandidateThesis = {
      thesisId: 'thesis-drift-rejected',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      entryZone: { lower: 99, upper: 101 },
      stopLoss: 90,
      takeProfit: 120,
    };

    const driftReport = replayExecution({
      initialBalance: 10000,
      theses: [driftThesis],
      candles: gapCandles,
      assumptions: { entryDriftTolerancePct: 0.01 }, // 1% max drift
      provenance: defaultProvenance,
    });

    expect(driftReport.outcomes).toHaveLength(0);
    expect(driftReport.metrics.rejections).toContainEqual(
      expect.objectContaining({
        thesisId: 'thesis-drift-rejected',
        reason: 'ENTRY_PRICE_DRIFT',
      }),
    );
  });

  it('6. Concurrent-symbol exposure & portfolio concurrency limits: enforces maxPositions and same-direction limits', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    const btcCandles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      },
    ];
    const ethCandles: ReplayCandle[] = [
      {
        symbol: 'ETH-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 200,
        high: 202,
        low: 198,
        close: 200,
      },
      {
        symbol: 'ETH-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 200,
        high: 204,
        low: 199,
        close: 202,
      },
    ];
    const solCandles: ReplayCandle[] = [
      {
        symbol: 'SOL-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 50,
        high: 51,
        low: 49,
        close: 50,
      },
      {
        symbol: 'SOL-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 50,
        high: 52,
        low: 49,
        close: 51,
      },
    ];

    const theses: ReplayCandidateThesis[] = [
      {
        thesisId: 'thesis-btc-long',
        symbol: 'BTC-USDT',
        direction: 'LONG',
        sourceDataCutoff: cutoffTime,
        orderType: 'MARKET',
        stopLoss: 90,
        takeProfit: 120,
      },
      {
        // Second LONG candidate: should be rejected if maxSameDirectionPositions is 1
        thesisId: 'thesis-eth-long',
        symbol: 'ETH-USDT',
        direction: 'LONG',
        sourceDataCutoff: cutoffTime,
        orderType: 'MARKET',
        stopLoss: 180,
        takeProfit: 240,
      },
      {
        // SHORT candidate: allowed because direction is SHORT and total positions <= 2
        thesisId: 'thesis-sol-short',
        symbol: 'SOL-USDT',
        direction: 'SHORT',
        sourceDataCutoff: cutoffTime,
        orderType: 'MARKET',
        stopLoss: 55,
        takeProfit: 40,
      },
    ];

    const report = replayExecution({
      initialBalance: 10000,
      theses,
      candles: [...btcCandles, ...ethCandles, ...solCandles],
      riskLimits: {
        maxPositions: 2,
        maxSameDirectionPositions: 1,
        maxExposure: 0.5,
      },
      provenance: defaultProvenance,
    });

    // BTC-LONG is executed
    // ETH-LONG is rejected due to MAX_SAME_DIRECTION_POSITIONS_EXCEEDED
    // SOL-SHORT is executed
    expect(report.metrics.rejections).toContainEqual(
      expect.objectContaining({
        thesisId: 'thesis-eth-long',
        reason: 'MAX_SAME_DIRECTION_POSITIONS_EXCEEDED',
      }),
    );
    expect(report.metrics.executedThesesCount).toBe(2);
  });

  it('7. Position Manager integration: executes partial exit and stop tightening before final close', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    // Long position at 100, stop at 95 (risk = 5)
    // Candle 1: opens at 100 (entry)
    // Candle 2: rallies to 110 (2R gain, peakProfit > 2%), position manager triggers partial exit + stop tighten
    // Candle 3: price falls back to 102, hitting tightened stop loss
    const candles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 100,
        high: 103,
        low: 99,
        close: 101,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:30:00.000Z'),
        closeTime: new Date('2026-09-09T10:45:00.000Z'),
        open: 102,
        high: 110,
        low: 101,
        close: 109,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:45:00.000Z'),
        closeTime: new Date('2026-09-09T11:00:00.000Z'),
        open: 109,
        high: 109,
        low: 101,
        close: 101.5,
      },
    ];

    const thesis: ReplayCandidateThesis = {
      thesisId: 'thesis-position-manager',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      stopLoss: 95,
      takeProfit: 125,
      tradePlan: {
        approved: true,
        regime: 'TREND_UP',
        strategy: 'TREND_PULLBACK',
        stopLoss: 95,
        takeProfit: 125,
        maxHoldingCandles: 8,
        breakEvenAtR: 0.8,
        trailingAtrMultiple: 1.5,
        atr: 2.0,
      },
    };

    const report = replayExecution({
      initialBalance: 10000,
      theses: [thesis],
      candles,
      assumptions: { slippageRate: 0, feeRate: 0 },
      provenance: defaultProvenance,
    });

    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0]!;

    // Check that lifecycle events recorded PROBE, PARTIAL, STOP_TIGHTEN, and FINAL_CLOSE
    const thesisEvents = report.events.filter((e) => e.thesisId === thesis.thesisId);
    const eventTypes = thesisEvents.map((e) => e.type);

    expect(eventTypes).toContain('PROBE');
    expect(eventTypes).toContain('PARTIAL');
    expect(eventTypes).toContain('STOP_TIGHTEN');
    expect(eventTypes).toContain('FINAL_CLOSE');

    expect(outcome.status).toBe('FINALIZED');
    expect(outcome.finalStopLoss).toBeGreaterThan(95); // tightened above initial stop
    expect(outcome.realizedNetPnl).toBeGreaterThan(0);
  });

  it('8. Continuous Account Equity Curve & Mark-to-Market Drawdown: emits equity at every candle', () => {
    const cutoffTime = new Date('2026-09-09T10:00:00.000Z');
    const candles: ReplayCandle[] = [
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:00:00.000Z'),
        closeTime: new Date('2026-09-09T10:15:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      },
      {
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:15:00.000Z'),
        closeTime: new Date('2026-09-09T10:30:00.000Z'),
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      },
      {
        // Price rises: unrealized equity peaks
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:30:00.000Z'),
        closeTime: new Date('2026-09-09T10:45:00.000Z'),
        open: 102,
        high: 120,
        low: 101,
        close: 118,
      },
      {
        // Price drops: unrealized equity pulls back causing continuous mark-to-market drawdown
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T10:45:00.000Z'),
        closeTime: new Date('2026-09-09T11:00:00.000Z'),
        open: 118,
        high: 118,
        low: 104,
        close: 105,
      },
      {
        // Trade closes
        symbol: 'BTC-USDT',
        openTime: new Date('2026-09-09T11:00:00.000Z'),
        closeTime: new Date('2026-09-09T11:15:00.000Z'),
        open: 105,
        high: 106,
        low: 95,
        close: 95,
      },
    ];

    const thesis: ReplayCandidateThesis = {
      thesisId: 'thesis-curve-m2m',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoffTime,
      orderType: 'MARKET',
      stopLoss: 95,
      takeProfit: 150,
    };

    const report = replayExecution({
      initialBalance: 10000,
      theses: [thesis],
      candles,
      provenance: defaultProvenance,
    });

    expect(report.equityCurve.length).toBeGreaterThanOrEqual(candles.length);
    // Continuous equity curve records points with unrealized PnL, equity, and continuous drawdown
    const peakPoint = report.equityCurve.find((p) => p.equity > 10000);
    expect(peakPoint).toBeDefined();

    // Max drawdown calculated from continuous account curve reflects intra-trade drop from peak
    expect(report.metrics.maxDrawdownPct).toBeGreaterThan(0);
    expect(report.datasetProvenance.totalCandles).toBe(candles.length);
    expect(report.executionAssumptions.configurationHash).toBeDefined();
  });

  it('9. Integrates with ResearchService application layer', async () => {
    const { ResearchService } = await import('../../src/modules/research/application/research.service');
    const service = new ResearchService(null as never);

    const report = service.replayExecution({
      initialBalance: 10000,
      theses: [],
      candles: [],
      provenance: defaultProvenance,
    });

    expect(report.metrics.initialBalance).toBe(10000);
    expect(report.outcomes).toHaveLength(0);
    expect(report.executionAssumptions).toBeDefined();
  });
});
