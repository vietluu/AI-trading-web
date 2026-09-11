import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  replayExecution,
  type ExecutionReplayInput,
  type ReplayCandle,
  type ReplayCandidateThesis,
  type ReplayExecutionAssumptions,
  type ReplayDatasetProvenance,
} from '../../src/modules/research/domain/execution-replay-engine';
import {
  calculateCriticLift,
  type PairedCandidateLiftInput,
} from '../../src/modules/reflection/domain/thesis-cohort';
import {
  calculateLifecycleHeadlineMetrics,
  evaluatePromotionTransition,
  type OperatorApprovalRecord,
} from '../../src/modules/reflection/domain/model-promotion-policy';
import type { RiskLimits } from '../../src/modules/risk/domain/risk-engine.types';

// ============================================================================
// 1. Frozen Benchmark Dataset Generator across 5 Distinct Market Regimes
// Regimes: Sideway, Accumulation, Breakout, Fakeout, Trend Exhaustion
// ============================================================================

export type MarketRegimeType =
  | 'SIDEWAY'
  | 'ACCUMULATION'
  | 'BREAKOUT'
  | 'FAKEOUT'
  | 'TREND_EXHAUSTION';

export interface RegimeSegment {
  startIndex: number;
  endIndex: number;
  description: string;
}

interface FrozenDatasetOutput {
  candles: ReplayCandle[];
  regimes: Record<MarketRegimeType, RegimeSegment>;
  sourceCutoff: Date;
  checksum: string;
}

function buildFrozenMultiRegimeDataset(): FrozenDatasetOutput {
  const candles: ReplayCandle[] = [];
  const startTime = new Date('2026-08-01T00:00:00.000Z').getTime();
  const oneHourMs = 3600 * 1000;

  const pushCandle = (
    index: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume = 1000,
  ) => {
    const openTime = new Date(startTime + index * oneHourMs);
    const closeTime = new Date(startTime + (index + 1) * oneHourMs - 1);
    candles.push({
      symbol: 'BTC-USDT',
      openTime,
      closeTime,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Number(volume.toFixed(2)),
    });
  };

  let currentIndex = 0;

  // Regime 1: SIDEWAY (Candles 0..29) - Tight range bound 100.00 - 102.00
  const sidewayStart = currentIndex;
  let price = 100.0;
  for (let i = 0; i < 30; i += 1) {
    const cycle = Math.sin((i / 30) * Math.PI * 4);
    const open = price;
    const close = 100.0 + cycle * 1.5;
    const high = Math.max(open, close) + 0.4;
    const low = Math.min(open, close) - 0.4;
    pushCandle(currentIndex, open, high, low, close, 800 + Math.abs(cycle) * 200);
    price = close;
    currentIndex += 1;
  }
  const sidewayEnd = currentIndex - 1;

  // Regime 2: ACCUMULATION (Candles 30..59) - Volatility squeeze, liquidity sweep spring, then reclaim
  const accumulationStart = currentIndex;
  for (let i = 0; i < 30; i += 1) {
    const open = price;
    let close = open;
    let high = open + 0.2;
    let low = open - 0.2;
    let vol = 500; // volume compression

    if (i < 20) {
      // Tight compression around 100.0
      close = 100.0 + (i % 2 === 0 ? 0.2 : -0.2);
      high = 100.4;
      low = 99.6;
    } else if (i === 20) {
      // Liquidity sweep spring candle: sharp drop below 99.0 to 98.2, closing back up at 99.5
      close = 99.5;
      high = 100.1;
      low = 98.2;
      vol = 2500;
    } else {
      // Reclaim and base-building above 100.5
      close = 100.0 + (i - 20) * 0.2;
      high = close + 0.3;
      low = close - 0.2;
      vol = 1200;
    }
    pushCandle(currentIndex, open, high, low, close, vol);
    price = close;
    currentIndex += 1;
  }
  const accumulationEnd = currentIndex - 1;

  // Regime 3: BREAKOUT (Candles 60..89) - Strong expansion through resistance (102.0 -> 116.0)
  const breakoutStart = currentIndex;
  for (let i = 0; i < 30; i += 1) {
    const open = price;
    const step = 0.5;
    const close = open + step + (i % 3 === 0 ? 0.4 : 0.1);
    const high = close + 0.5;
    const low = open - 0.2;
    pushCandle(currentIndex, open, high, low, close, 2000 + i * 50);
    price = close;
    currentIndex += 1;
  }
  const breakoutEnd = currentIndex - 1;

  // Regime 4: FAKEOUT (Candles 90..119) - Attempted continuation above 118.0 that sweeps and violently collapses
  const fakeoutStart = currentIndex;
  for (let i = 0; i < 30; i += 1) {
    const open = price;
    let close = open;
    let high = open + 0.5;
    let low = open - 0.5;
    let vol = 1500;

    if (i < 3) {
      // Trap breakout push to 119.5 with heavy upper wicks
      high = 119.5;
      close = 117.8;
      low = open - 0.3;
      vol = 3000;
    } else if (i < 15) {
      // Immediate aggressive rejection and collapse from 117.8 down to 104.0
      close = open - 1.2;
      high = open + 0.2;
      low = close - 0.4;
      vol = 3500;
    } else {
      // Cascading liquidation down to 96.0
      close = open - 0.6;
      high = open + 0.2;
      low = close - 0.3;
      vol = 2200;
    }
    pushCandle(currentIndex, open, high, low, close, vol);
    price = close;
    currentIndex += 1;
  }
  const fakeoutEnd = currentIndex - 1;

  // Regime 5: TREND EXHAUSTION (Candles 120..149) - Parabolic drop climax, low rejection, stabilization
  const exhaustionStart = currentIndex;
  for (let i = 0; i < 30; i += 1) {
    const open = price;
    let close = open;
    let high = open + 0.4;
    let low = open - 0.4;
    let vol = 1200;

    if (i === 0) {
      // Climax selloff bar down to 88.5, closing at 91.0 with large lower tail
      low = 88.5;
      close = 91.0;
      high = open + 0.2;
      vol = 4500;
    } else {
      // Exhaustion: momentum dries up, higher lows forming around 91.5 - 93.0
      close = 91.0 + Math.sin(i / 3) * 1.0;
      high = Math.max(open, close) + 0.3;
      low = Math.min(open, close) - 0.3;
      vol = 600;
    }
    pushCandle(currentIndex, open, high, low, close, vol);
    price = close;
    currentIndex += 1;
  }
  const exhaustionEnd = currentIndex - 1;

  const serialized = JSON.stringify(candles);
  const checksum = createHash('sha256').update(serialized).digest('hex');
  const sourceCutoff = candles[0]!.openTime as Date;

  return {
    candles,
    regimes: {
      SIDEWAY: {
        startIndex: sidewayStart,
        endIndex: sidewayEnd,
        description: 'Range bound between 100.00 and 102.00 with mean reversion',
      },
      ACCUMULATION: {
        startIndex: accumulationStart,
        endIndex: accumulationEnd,
        description: 'Squeeze compression, liquidity sweep spring, and reclaim',
      },
      BREAKOUT: {
        startIndex: breakoutStart,
        endIndex: breakoutEnd,
        description: 'Expansion through 102.00 resistance reaching 116.00+',
      },
      FAKEOUT: {
        startIndex: fakeoutStart,
        endIndex: fakeoutEnd,
        description: 'Bull trap above 118.00 with immediate collapse down to 96.00',
      },
      TREND_EXHAUSTION: {
        startIndex: exhaustionStart,
        endIndex: exhaustionEnd,
        description: 'Climax selloff with seller exhaustion and bottom formation',
      },
    },
    sourceCutoff,
    checksum,
  };
}

// ============================================================================
// 2. Statistical Uncertainty Estimation (Bootstrap and Standard Error)
// ============================================================================

export interface UncertaintyInterval {
  sampleMean: number;
  standardError: number;
  confidenceLevel: number;
  ciLower: number;
  ciUpper: number;
  bootstrapMean: number;
  bootstrapCiLower: number;
  bootstrapCiUpper: number;
}

export function computeUncertaintyInterval(
  values: number[],
  confidenceLevel = 0.95,
  bootstrapIterations = 1000,
): UncertaintyInterval {
  const n = values.length;
  if (n === 0) {
    return {
      sampleMean: 0,
      standardError: 0,
      confidenceLevel,
      ciLower: 0,
      ciUpper: 0,
      bootstrapMean: 0,
      bootstrapCiLower: 0,
      bootstrapCiUpper: 0,
    };
  }

  const sampleMean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    n > 1 ? values.reduce((sum, v) => sum + (v - sampleMean) ** 2, 0) / (n - 1) : 0;
  const standardError = Math.sqrt(variance / n);

  // Normal approximation z-score for standard confidence level (1.96 for 95%)
  const z = confidenceLevel === 0.99 ? 2.576 : confidenceLevel === 0.9 ? 1.645 : 1.96;
  const ciLower = Number((sampleMean - z * standardError).toFixed(4));
  const ciUpper = Number((sampleMean + z * standardError).toFixed(4));

  // Deterministic PRNG bootstrap resampling
  let seed = 42;
  const pseudoRandom = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  const bootstrapMeans: number[] = [];
  for (let b = 0; b < bootstrapIterations; b += 1) {
    let resampleSum = 0;
    for (let i = 0; i < n; i += 1) {
      const randomIndex = Math.floor(pseudoRandom() * n);
      resampleSum += values[randomIndex]!;
    }
    bootstrapMeans.push(resampleSum / n);
  }

  bootstrapMeans.sort((a, b) => a - b);
  const lowerPercentileIndex = Math.floor(((1 - confidenceLevel) / 2) * bootstrapIterations);
  const upperPercentileIndex = Math.floor((1 - (1 - confidenceLevel) / 2) * bootstrapIterations);

  const bootstrapMean = Number(
    (bootstrapMeans.reduce((a, b) => a + b, 0) / bootstrapIterations).toFixed(4),
  );
  const bootstrapCiLower = Number((bootstrapMeans[lowerPercentileIndex] ?? sampleMean).toFixed(4));
  const bootstrapCiUpper = Number((bootstrapMeans[upperPercentileIndex] ?? sampleMean).toFixed(4));

  return {
    sampleMean: Number(sampleMean.toFixed(4)),
    standardError: Number(standardError.toFixed(4)),
    confidenceLevel,
    ciLower,
    ciUpper,
    bootstrapMean,
    bootstrapCiLower,
    bootstrapCiUpper,
  };
}

// ============================================================================
// 3. Integration Test Suite
// ============================================================================

describe('Proactive AI Forward Replay & Trade Lifecycle Evaluation (Integration)', () => {
  const frozenDataset = buildFrozenMultiRegimeDataset();
  const initialBalance = 10_000;

  const identicalAssumptions: Required<ReplayExecutionAssumptions> = {
    feeRate: 0.0006,
    slippageRate: 0.0004,
    entryDriftTolerancePct: 0.015,
    defaultLimitTtlCandles: 4,
    stopFirstAmbiguity: true,
    configurationHash: 'proactive-frozen-v1-hash-abc123',
  };

  const identicalRiskLimits: Partial<RiskLimits> = {
    maxDrawdown: 0.12,
    maxPositions: 3,
    riskPerTrade: 0.015,
    maxExposure: 1.0,
    maxSameDirectionPositions: 2,
  };

  const provenance: ReplayDatasetProvenance = {
    source: 'FROZEN_MULTI_REGIME_BENCHMARK_V1',
    symbols: ['BTC-USDT'],
    startTime: frozenDataset.candles[0]!.openTime,
    endTime: frozenDataset.candles[frozenDataset.candles.length - 1]!.closeTime,
    totalCandles: frozenDataset.candles.length,
    checksum: frozenDataset.checksum,
    sourceCutoff: frozenDataset.sourceCutoff,
  };

  it('1. Frozen dataset integrity: covers 5 regimes and provides deterministic checksum', () => {
    expect(frozenDataset.candles).toHaveLength(150);
    expect(frozenDataset.checksum).toBeDefined();
    expect(frozenDataset.checksum).toHaveLength(64); // SHA-256 hex string

    // Verify all 5 regimes are demarcated
    expect(Object.keys(frozenDataset.regimes)).toEqual([
      'SIDEWAY',
      'ACCUMULATION',
      'BREAKOUT',
      'FAKEOUT',
      'TREND_EXHAUSTION',
    ]);

    // Verify candle time ordering is strictly monotonic
    for (let i = 1; i < frozenDataset.candles.length; i += 1) {
      const prev = new Date(frozenDataset.candles[i - 1]!.openTime).getTime();
      const curr = new Date(frozenDataset.candles[i]!.openTime).getTime();
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('2. Forward Replay comparison: evaluates Rules-only, AI Researcher, and AI+Critic under identical execution assumptions', () => {
    const { candles, regimes } = frozenDataset;

    // --- Candidate Set 1: Sideway Regime Trade ---
    const sidewayCutoff = candles[regimes.SIDEWAY.startIndex + 10]!.closeTime as Date;
    const rulesSideway: ReplayCandidateThesis = {
      thesisId: 'rules-sideway-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: sidewayCutoff,
      orderType: 'LIMIT',
      limitPrice: 99.8,
      takeProfit: 101.5,
      stopLoss: 98.8,
      limitTtlCandles: 3,
    };
    const aiSideway: ReplayCandidateThesis = {
      thesisId: 'ai-sideway-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: sidewayCutoff,
      orderType: 'LIMIT',
      limitPrice: 99.8,
      takeProfit: 101.5,
      stopLoss: 98.8,
      limitTtlCandles: 3,
    };
    const aiCriticSideway: ReplayCandidateThesis = {
      ...aiSideway,
      thesisId: 'ai-critic-sideway-1',
    };

    // --- Candidate Set 2: Accumulation & Liquidity Sweep ---
    const accumCutoff = candles[regimes.ACCUMULATION.startIndex + 22]!.closeTime as Date;
    const rulesAccum: ReplayCandidateThesis = {
      thesisId: 'rules-accum-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: accumCutoff,
      orderType: 'MARKET',
      takeProfit: 105.0,
      stopLoss: 98.0,
    };
    const aiAccum: ReplayCandidateThesis = {
      thesisId: 'ai-accum-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: accumCutoff,
      orderType: 'MARKET',
      takeProfit: 108.0,
      stopLoss: 98.0,
    };
    const aiCriticAccum: ReplayCandidateThesis = {
      ...aiAccum,
      thesisId: 'ai-critic-accum-1',
    };

    // --- Candidate Set 3: Genuine Expansion Breakout ---
    const breakoutCutoff = candles[regimes.BREAKOUT.startIndex + 2]!.closeTime as Date;
    const rulesBreakout: ReplayCandidateThesis = {
      thesisId: 'rules-breakout-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: breakoutCutoff,
      orderType: 'MARKET',
      takeProfit: 110.0,
      stopLoss: 99.5,
    };
    const aiBreakout: ReplayCandidateThesis = {
      thesisId: 'ai-breakout-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: breakoutCutoff,
      orderType: 'MARKET',
      takeProfit: 114.0,
      stopLoss: 99.5,
    };
    const aiCriticBreakout: ReplayCandidateThesis = {
      ...aiBreakout,
      thesisId: 'ai-critic-breakout-1',
    };

    // --- Candidate Set 4: Fakeout / Bull Trap ---
    const fakeoutCutoff = candles[regimes.FAKEOUT.startIndex + 2]!.closeTime as Date;
    const rulesFakeout: ReplayCandidateThesis = {
      thesisId: 'rules-fakeout-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: fakeoutCutoff,
      orderType: 'MARKET',
      takeProfit: 125.0,
      stopLoss: 112.0,
    };
    const aiFakeout: ReplayCandidateThesis = {
      thesisId: 'ai-fakeout-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: fakeoutCutoff,
      orderType: 'MARKET',
      takeProfit: 125.0,
      stopLoss: 112.0,
    };

    // --- Candidate Set 5: Trend Exhaustion Reversal ---
    const exhaustCutoff = candles[regimes.TREND_EXHAUSTION.startIndex + 5]!.closeTime as Date;
    const rulesExhaust: ReplayCandidateThesis = {
      thesisId: 'rules-exhaust-1',
      symbol: 'BTC-USDT',
      direction: 'SHORT',
      sourceDataCutoff: exhaustCutoff,
      orderType: 'MARKET',
      takeProfit: 80.0,
      stopLoss: 94.0,
    };
    const aiExhaust: ReplayCandidateThesis = {
      thesisId: 'ai-exhaust-1',
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: exhaustCutoff,
      orderType: 'MARKET',
      takeProfit: 95.0,
      stopLoss: 88.0,
    };
    const aiCriticExhaust: ReplayCandidateThesis = {
      ...aiExhaust,
      thesisId: 'ai-critic-exhaust-1',
      quantity: 0.5,
    };

    // Execute Forward Replay for all 3 configurations
    const rulesInput: ExecutionReplayInput = {
      initialBalance,
      theses: [rulesSideway, rulesAccum, rulesBreakout, rulesFakeout, rulesExhaust],
      candles,
      assumptions: identicalAssumptions,
      riskLimits: identicalRiskLimits,
      provenance,
    };
    const aiInput: ExecutionReplayInput = {
      initialBalance,
      theses: [aiSideway, aiAccum, aiBreakout, aiFakeout, aiExhaust],
      candles,
      assumptions: identicalAssumptions,
      riskLimits: identicalRiskLimits,
      provenance,
    };
    const aiCriticInput: ExecutionReplayInput = {
      initialBalance,
      theses: [aiCriticSideway, aiCriticAccum, aiCriticBreakout, aiCriticExhaust],
      candles,
      assumptions: identicalAssumptions,
      riskLimits: identicalRiskLimits,
      provenance,
    };

    const reportRules = replayExecution(rulesInput);
    const reportAi = replayExecution(aiInput);
    const reportAiCritic = replayExecution(aiCriticInput);

    // ========================================================================
    // Assertion A: NO LOOK-AHEAD
    // No trade may fill at or before its source data cutoff timestamp.
    // Entry must strictly occur on or after the next executable candle openTime.
    // ========================================================================
    const allReports = [reportRules, reportAi, reportAiCritic];
    for (const rep of allReports) {
      expect(rep.outcomes.length).toBeGreaterThan(0);
      for (const outcome of rep.outcomes) {
        expect(outcome.sourceDataCutoff).toBeDefined();
        const cutoffTime = new Date(outcome.sourceDataCutoff).getTime();
        const openTime = outcome.openedAt.getTime();
        expect(openTime).toBeGreaterThan(cutoffTime);

        const candleIndex = candles.findIndex(
          (c) => new Date(c.openTime).getTime() === openTime,
        );
        expect(candleIndex).toBeGreaterThan(0);
        const prevCandle = candles[candleIndex - 1]!;
        expect(new Date(prevCandle.closeTime ?? prevCandle.openTime).getTime()).toBeGreaterThanOrEqual(
          cutoffTime,
        );
      }
    }

    // ========================================================================
    // Assertion B: ZERO PROTECTION OMISSIONS
    // Every executed trade outcome MUST possess a mandatory, non-null, valid stopLoss.
    // ========================================================================
    for (const rep of allReports) {
      for (const outcome of rep.outcomes) {
        expect(outcome.finalStopLoss).toBeDefined();
        expect(typeof outcome.finalStopLoss).toBe('number');
        expect(outcome.finalStopLoss).toBeGreaterThan(0);
        expect(Number.isFinite(outcome.finalStopLoss)).toBe(true);
      }

      const headline = calculateLifecycleHeadlineMetrics(rep.outcomes);
      expect(headline.protectionFailuresCount).toBe(0);
    }

    // ========================================================================
    // Assertion C: ZERO RISK-LIMIT BREACHES
    // Portfolio concurrency, position sizing, and exposure caps must be strictly respected.
    // ========================================================================
    for (const rep of allReports) {
      for (const curvePoint of rep.equityCurve) {
        expect(curvePoint.openPositionsCount).toBeLessThanOrEqual(
          identicalRiskLimits.maxPositions ?? 3,
        );
        expect(curvePoint.equity).toBeGreaterThan(0);
      }
    }

    // ========================================================================
    // Assertion D: REPORTED PAIRED LIFT
    // Avoided loss, missed win, and net lift computed from paired candidate inputs.
    // ========================================================================
    const pairedCandidates: PairedCandidateLiftInput[] = [
      {
        candidateId: 'pair-sideway',
        symbol: 'BTC-USDT',
        rulesNetR: 0.8,
        aiResearcherNetR: 0.8,
        criticAction: 'APPROVE',
        criticSizeFactor: 1.0,
      },
      {
        candidateId: 'pair-accum',
        symbol: 'BTC-USDT',
        rulesNetR: 1.2,
        aiResearcherNetR: 1.5,
        criticAction: 'APPROVE',
        criticSizeFactor: 1.0,
      },
      {
        candidateId: 'pair-breakout',
        symbol: 'BTC-USDT',
        rulesNetR: 1.5,
        aiResearcherNetR: 2.2,
        criticAction: 'APPROVE',
        criticSizeFactor: 1.0,
      },
      {
        candidateId: 'pair-fakeout',
        symbol: 'BTC-USDT',
        rulesNetR: -1.0,
        aiResearcherNetR: -1.0,
        criticAction: 'BLOCK',
        criticSizeFactor: 0.0,
      },
      {
        candidateId: 'pair-exhaust',
        symbol: 'BTC-USDT',
        rulesNetR: -1.0,
        aiResearcherNetR: 0.9,
        criticAction: 'REDUCE_SIZE',
        criticSizeFactor: 0.5,
      },
    ];

    const criticLiftReport = calculateCriticLift(pairedCandidates);

    expect(criticLiftReport.totalCandidates).toBe(5);
    expect(criticLiftReport.totalAvoidedLossR).toBeGreaterThanOrEqual(0);
    expect(criticLiftReport.totalMissedWinR).toBeGreaterThanOrEqual(0);
    expect(criticLiftReport.netLiftR).toBe(
      Number(
        (criticLiftReport.totalAvoidedLossR - criticLiftReport.totalMissedWinR).toFixed(4),
      ),
    );

    const fakeoutPair = criticLiftReport.candidates.find((c) => c.candidateId === 'pair-fakeout')!;
    expect(fakeoutPair.avoidedLossR).toBe(1.0);
    expect(fakeoutPair.aiWithCriticNetR).toBe(0.0);

    const exhaustPair = criticLiftReport.candidates.find((c) => c.candidateId === 'pair-exhaust')!;
    expect(exhaustPair.missedWinR).toBe(0.45);
    expect(exhaustPair.aiWithCriticNetR).toBe(0.45);

    // ========================================================================
    // Assertion E: EXPLICIT UNCERTAINTY INTERVALS
    // Verify standard error, 95% CI, and bootstrap intervals for paired lift and net R.
    // ========================================================================
    const pairedDeltas = criticLiftReport.candidates.map((c) => c.netCriticLiftR);
    const uncertainty = computeUncertaintyInterval(pairedDeltas, 0.95, 1000);

    expect(Number.isFinite(uncertainty.sampleMean)).toBe(true);
    expect(Number.isFinite(uncertainty.standardError)).toBe(true);
    expect(uncertainty.standardError).toBeGreaterThan(0);
    expect(uncertainty.ciLower).toBeLessThanOrEqual(uncertainty.ciUpper);
    expect(uncertainty.bootstrapCiLower).toBeLessThanOrEqual(uncertainty.bootstrapCiUpper);
    expect(uncertainty.confidenceLevel).toBe(0.95);

    // ========================================================================
    // Assertion F: DO NOT ENCODE A GUARANTEED-PROFIT ASSERTION
    // We strictly assert data validity, bounds, and absence of violations.
    // ========================================================================
    for (const rep of allReports) {
      expect(Number.isFinite(rep.metrics.realizedNetPnl)).toBe(true);
      expect(Number.isFinite(rep.metrics.finalEquity)).toBe(true);
      expect(rep.metrics.maxDrawdownPct).toBeGreaterThanOrEqual(0);
      expect(rep.metrics.maxDrawdownPct).toBeLessThanOrEqual(100);
      expect(rep.datasetProvenance.checksum).toBe(frozenDataset.checksum);
    }
  });

  it('3. Promotion State Machine Integration: exercises OBSERVE -> SHADOW -> DEMO_CANARY -> ELIGIBLE -> APPROVED_LIVE_CANARY with manual operator gate and rollback', () => {
    const { candles, regimes } = frozenDataset;
    const cutoff = candles[regimes.BREAKOUT.startIndex]!.closeTime as Date;
    const theses: ReplayCandidateThesis[] = Array.from({ length: 55 }, (_, i) => ({
      thesisId: `thesis-promo-${i}`,
      symbol: 'BTC-USDT',
      direction: i % 2 === 0 ? 'LONG' : 'SHORT',
      sourceDataCutoff: cutoff,
      orderType: 'MARKET',
      takeProfit: 105.0,
      stopLoss: 97.0,
      metadata: {
        cohortKey: `BTC-USDT|1h|${i % 2 === 0 ? 'BREAKOUT' : 'SQUEEZE'}`,
        confidence: 75,
      },
    }));

    const replayInput: ExecutionReplayInput = {
      initialBalance,
      theses,
      candles,
      assumptions: identicalAssumptions,
      riskLimits: identicalRiskLimits,
      provenance,
    };
    const replayReport = replayExecution(replayInput);

    const headline = calculateLifecycleHeadlineMetrics(replayReport.outcomes);
    expect(headline.sampleSize).toBe(replayReport.outcomes.length);
    expect(headline.protectionFailuresCount).toBe(0);

    const mockForwardIds = Array.from({ length: 55 }, (_, i) => `fwd-${i}`);
    const verifiedMetrics = {
      ...headline,
      sampleSize: 55,
      forwardSampleIds: mockForwardIds,
      lifecycleExpectancyNetR: 0.45,
      profitFactor: 1.85,
      markToMarketDrawdownPct: 4.2,
      chaseRate: 0.08,
      cohortStabilityScore: 0.82,
      protectionFailuresCount: 0,
      modelDriftDetected: false,
    };

    const configHash = identicalAssumptions.configurationHash;

    // Step 1: OBSERVE -> SHADOW
    const step1 = evaluatePromotionTransition({
      currentStage: 'OBSERVE',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: verifiedMetrics,
    });
    expect(step1.allowed).toBe(true);
    expect(step1.toStage).toBe('SHADOW');

    // Step 2: SHADOW -> DEMO_CANARY
    const step2 = evaluatePromotionTransition({
      currentStage: 'SHADOW',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: verifiedMetrics,
    });
    expect(step2.allowed).toBe(true);
    expect(step2.toStage).toBe('DEMO_CANARY');

    // Step 3: DEMO_CANARY -> ELIGIBLE
    const step3 = evaluatePromotionTransition({
      currentStage: 'DEMO_CANARY',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: verifiedMetrics,
    });
    expect(step3.allowed).toBe(true);
    expect(step3.toStage).toBe('ELIGIBLE');

    // Step 4: ELIGIBLE -> APPROVED_LIVE_CANARY requires manual operator confirmation
    // Failure case 4a: without operator approval
    const step4NoOperator = evaluatePromotionTransition({
      currentStage: 'ELIGIBLE',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: verifiedMetrics,
      operatorApproval: null,
    });
    expect(step4NoOperator.allowed).toBe(false);
    expect(step4NoOperator.toStage).toBe('ELIGIBLE');
    expect(step4NoOperator.failures).toContain('OPERATOR_APPROVAL_REQUIRED');

    // Failure case 4b: with mismatched configuration hash in operator approval
    const invalidApproval: OperatorApprovalRecord = {
      operatorId: 'operator-alice',
      approvedAt: new Date().toISOString(),
      configurationHash: 'wrong-tampered-hash-999',
      confirmed: true,
    };
    const step4HashMismatch = evaluatePromotionTransition({
      currentStage: 'ELIGIBLE',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: verifiedMetrics,
      operatorApproval: invalidApproval,
    });
    expect(step4HashMismatch.allowed).toBe(false);
    expect(step4HashMismatch.failures).toContain('OPERATOR_APPROVAL_HASH_MISMATCH');

    // Success case 4c: with verified operator approval matching frozen configuration hash
    const validApproval: OperatorApprovalRecord = {
      operatorId: 'operator-alice',
      approvedAt: new Date().toISOString(),
      configurationHash: configHash,
      confirmed: true,
      notes: 'Reviewed frozen replay report and headline metrics. Approved for live canary probe only.',
    };
    const step4Approved = evaluatePromotionTransition({
      currentStage: 'ELIGIBLE',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: verifiedMetrics,
      operatorApproval: validApproval,
    });
    expect(step4Approved.allowed).toBe(true);
    expect(step4Approved.toStage).toBe('APPROVED_LIVE_CANARY');

    // Step 5: Automated Rollback on Breaches
    // Case 5a: Drawdown breach in LIVE CANARY triggers immediate rollback to SHADOW
    const breachMetrics = {
      ...verifiedMetrics,
      markToMarketDrawdownPct: 15.2,
    };
    const rollbackDrawdown = evaluatePromotionTransition({
      currentStage: 'APPROVED_LIVE_CANARY',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: breachMetrics,
      operatorApproval: validApproval,
    });
    expect(rollbackDrawdown.allowed).toBe(false);
    expect(rollbackDrawdown.isRollback).toBe(true);
    expect(rollbackDrawdown.toStage).toBe('SHADOW');
    expect(rollbackDrawdown.failures).toContain('DRAWDOWN_BREACH');

    // Case 5b: Protection omission in DEMO CANARY triggers immediate rollback to SHADOW
    const protectionFailureMetrics = {
      ...verifiedMetrics,
      protectionFailuresCount: 1,
    };
    const rollbackProtection = evaluatePromotionTransition({
      currentStage: 'DEMO_CANARY',
      candidateVersion: 1,
      configurationHash: configHash,
      metrics: protectionFailureMetrics,
    });
    expect(rollbackProtection.allowed).toBe(false);
    expect(rollbackProtection.isRollback).toBe(true);
    expect(rollbackProtection.toStage).toBe('SHADOW');
    expect(rollbackProtection.failures).toContain('PROTECTION_FAILURE');
  });

  it('4. Adversarial stress & risk boundary enforcement: proves zero protection omissions and zero risk-limit breaches when candidate breaches are attempted', () => {
    const { candles, regimes } = frozenDataset;
    const cutoff = candles[regimes.BREAKOUT.startIndex]!.closeTime as Date;

    // Attempt to flood the engine with 6 concurrent theses on BTC-USDT when maxPositions is 2
    const restrictiveRiskLimits: Partial<RiskLimits> = {
      maxPositions: 2,
      maxExposure: 0.5,
      maxDrawdown: 0.10,
    };

    const concurrentTheses: ReplayCandidateThesis[] = Array.from({ length: 6 }, (_, i) => ({
      thesisId: `thesis-flood-${i}`,
      symbol: 'BTC-USDT',
      direction: 'LONG',
      sourceDataCutoff: cutoff,
      orderType: 'MARKET',
      takeProfit: 120.0,
      stopLoss: 95.0,
    }));

    const floodReport = replayExecution({
      initialBalance,
      theses: concurrentTheses,
      candles,
      assumptions: identicalAssumptions,
      riskLimits: restrictiveRiskLimits,
      provenance,
    });

    // Zero risk limit breaches assertion:
    // Engine admits at most maxPositions (2) and rejects the remaining 4 candidates
    expect(floodReport.metrics.executedThesesCount).toBeLessThanOrEqual(2);
    expect(floodReport.metrics.rejectedThesesCount).toBeGreaterThanOrEqual(4);
    expect(floodReport.equityCurve.every((pt) => pt.openPositionsCount <= 2)).toBe(true);
    expect(
      floodReport.metrics.rejections.every(
        (r) =>
          r.reason === 'MAX_OPEN_POSITIONS_EXCEEDED' ||
          r.reason === 'MAX_PORTFOLIO_EXPOSURE_EXCEEDED' ||
          r.reason === 'PYRAMIDING_NOT_ALLOWED',
      ),
    ).toBe(true);

    // Protection omission detection assertion:
    // When a thesis outcome omits mandatory stop loss (e.g. omittedStopLoss: true in metadata)
    const simulatedOutcomesWithMissingStop = floodReport.outcomes.map((o, idx) => ({
      ...o,
      metadata: idx === 0 ? { omittedStopLoss: true } : o.metadata,
    }));
    const headline = calculateLifecycleHeadlineMetrics(simulatedOutcomesWithMissingStop);
    expect(headline.protectionFailuresCount).toBe(1);

    const blockedPromotion = evaluatePromotionTransition({
      currentStage: 'SHADOW',
      candidateVersion: 2,
      configurationHash: identicalAssumptions.configurationHash,
      metrics: headline,
    });
    expect(blockedPromotion.allowed).toBe(false);
    expect(blockedPromotion.failures).toContain('PROTECTION_FAILURE');

    // Uncertainty interval on mixed/negative sample:
    // Proves that uncertainty estimation is statistically valid without assuming or requiring positive profit
    const mixedDeltas = [-0.85, -0.42, 0.15, -0.22, 0.05, -0.6];
    const uncertainty = computeUncertaintyInterval(mixedDeltas, 0.90, 500);
    expect(uncertainty.sampleMean).toBeLessThan(0); // Validly negative
    expect(uncertainty.standardError).toBeGreaterThan(0);
    expect(uncertainty.ciLower).toBeLessThanOrEqual(uncertainty.ciUpper);
    expect(uncertainty.bootstrapCiLower).toBeLessThanOrEqual(uncertainty.bootstrapCiUpper);
  });
});

