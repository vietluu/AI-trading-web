import { describe, expect, it } from 'vitest';
import { DecisionJudgeService } from '../../src/modules/pipeline/application/decision-judge.service';
import { buildExecutionContext } from '../../src/modules/pipeline/domain/execution-context';

describe('DecisionJudgeService', () => {
  const judge = new DecisionJudgeService();

  it('requests more data instead of approving synthetic or missing analysis', () => {
    const generatedAt = new Date().toISOString();
    const insufficient = { dataQuality: 'INSUFFICIENT', generatedAt };
    const decision = {
      decision: 'LONG', dataQuality: 'PARTIAL', conflictLevel: 'LOW', confidence: 80,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
    };
    const result = judge.evaluate(decision as never, {
      market: insufficient, technical: insufficient, news: insufficient,
      sentiment: insufficient, macro: insufficient, onchain: insufficient,
    } as never, { symbol: 'ALGO-USDT' });

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.verdict).toBe('REQUEST_MORE_DATA');
  });

  it('rejects a directional decision with non-positive edge', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 80,
      expectedValue: 0, profitFactorEstimate: 1.8, riskScore: 30,
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never, { symbol: 'ALGO-USDT' });

    expect(result).toEqual(expect.objectContaining({ approved: false, verdict: 'REJECT' }));
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('EXPECTED_VALUE_TOO_LOW');
  });

  it('does not deadlock a cold-start signal when empirical calibration is not ready', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'SHORT', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 84,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
      confidenceCalibration: { status: 'INSUFFICIENT_HISTORY', sampleSize: 0 },
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never, { symbol: 'ETH-USDT', requireCalibratedConfidence: true });

    expect(result).toEqual({ approved: true, verdict: 'APPROVE', reasons: ['VALID_EXACT_EVIDENCE'], severity: 'APPROVE' });
  });

  it('does not let a boundary confidence bypass an unreliable global fallback', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'SHORT', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 75,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
      confidenceCalibration: {
        status: 'CALIBRATED', rawScore: 75, empiricalProbability: 0.4,
        sampleSize: 479, bucketSampleSize: 321, brierScore: 0.35,
        scope: 'USER_GLOBAL', fallbackUsed: true,
      },
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never, { symbol: 'ETH-USDT', requireCalibratedConfidence: true });

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.verdict).toBe('REQUEST_MORE_DATA');
    expect(result.reasons).toContain('UNCALIBRATED_CONFIDENCE_TOO_LOW');
  });

  it('requires calibration for partial-data automatic execution even at high confidence', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'SHORT', dataQuality: 'PARTIAL', conflictLevel: 'LOW', confidence: 84,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
      confidenceCalibration: { status: 'INSUFFICIENT_HISTORY', sampleSize: 0 },
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never, { symbol: 'ETH-USDT', requireCalibratedConfidence: true });

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.verdict).toBe('REQUEST_MORE_DATA');
    expect(result.reasons).toContain('PARTIAL_DATA_UNCALIBRATED');
  });

  it('lets fresh aligned core evidence continue to the mandatory quant gate', () => {
    const generatedAt = new Date().toISOString();
    const market = { dataQuality: 'GOOD', generatedAt, trend: { direction: 'UP' } };
    const technical = { dataQuality: 'GOOD', generatedAt, trend: { direction: 'UP' } };
    const partial = { dataQuality: 'PARTIAL', generatedAt };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'PARTIAL', coreDataQuality: 'GOOD',
      conflictLevel: 'LOW', confidence: 65, adaptiveThreshold: 60,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
      confidenceCalibration: { status: 'INSUFFICIENT_HISTORY', sampleSize: 0 },
    } as never, {
      market, technical, news: partial, sentiment: partial, macro: partial,
      onchain: { dataQuality: 'INSUFFICIENT', generatedAt, signals: ['No verified on-chain provider is configured.'] },
    } as never, { symbol: 'SOL-USDT', timeframe: '15m', requireCalibratedConfidence: true });

    expect(result).toEqual({ approved: true, verdict: 'APPROVE', reasons: ['VALID_EXACT_EVIDENCE'], severity: 'APPROVE' });
  });

  it('requires stronger raw confidence for uncalibrated automatic execution', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 71,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
      confidenceCalibration: { status: 'INSUFFICIENT_HISTORY', sampleSize: 0 },
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never, { symbol: 'ETH-USDT', requireCalibratedConfidence: true });

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.verdict).toBe('REQUEST_MORE_DATA');
    expect(result.reasons).toContain('UNCALIBRATED_CONFIDENCE_TOO_LOW');
  });

  it('keeps an unreliable exact-context calibration as a hard gate', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'SHORT', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 75,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
      confidenceCalibration: {
        status: 'CALIBRATED', rawScore: 75, empiricalProbability: 0.4,
        sampleSize: 80, bucketSampleSize: 25, brierScore: 0.36,
        scope: 'EXACT', fallbackUsed: false,
      },
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never, { symbol: 'ETH-USDT', requireCalibratedConfidence: true });

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.verdict).toBe('REQUEST_MORE_DATA');
    expect(result.reasons).toEqual(expect.arrayContaining([
      'CALIBRATED_PROBABILITY_TOO_LOW',
      'CALIBRATION_UNRELIABLE',
    ]));
  });

  it('requests fresh source data when the underlying candle is stale for its timeframe', () => {
    const now = Date.parse('2026-08-08T12:00:00.000Z');
    const good = { dataQuality: 'GOOD', generatedAt: new Date(now).toISOString() };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 80,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
    } as never, {
      symbol: 'BTC-USDT', timeframe: '1m', sourceTimestamp: '2026-08-08T11:55:00.000Z',
    }, now);

    expect(result).toEqual(expect.objectContaining({ approved: false, verdict: 'REQUEST_MORE_DATA', severity: 'BLOCK' }));
    expect(result.reasons).toContain('STALE_SOURCE_DATA');
  });

  it('treats an explicitly unconfigured on-chain provider as optional', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const result = judge.evaluate({
      decision: 'WAIT', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 0,
      expectedValue: 0.2, profitFactorEstimate: 1.4, riskScore: 30,
    } as never, {
      market: good, technical: good, news: good, sentiment: good, macro: good,
      onchain: {
        dataQuality: 'INSUFFICIENT', generatedAt,
        signals: ['No verified on-chain provider is configured.'],
      },
    } as never, { symbol: 'ALGO-USDT' });

    expect(result.reasons).not.toContain('INSUFFICIENT_USABLE_ANALYSTS');
    expect(result.verdict).toBe('APPROVE');
  });

  it('accepts a short-term evidence quorum without requiring macro and social agents', () => {
    const generatedAt = new Date().toISOString();
    const good = { dataQuality: 'GOOD', generatedAt };
    const partial = { dataQuality: 'PARTIAL', generatedAt };
    const insufficient = { dataQuality: 'INSUFFICIENT', generatedAt };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'PARTIAL', conflictLevel: 'LOW', confidence: 75,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
    } as never, {
      market: good,
      technical: good,
      news: partial,
      sentiment: insufficient,
      macro: insufficient,
      onchain: {
        ...insufficient,
        signals: ['No verified on-chain provider is configured.'],
      },
    } as never, { symbol: 'OKB-USDT', timeframe: '15m' });

    expect(result.reasons).not.toContain('INSUFFICIENT_USABLE_ANALYSTS');
    expect(result.approved).toBe(true);
  });

  it('ignores a stale optional analyst when a fresh short-term quorum remains', () => {
    const now = Date.parse('2026-08-14T10:00:00.000Z');
    const fresh = { dataQuality: 'GOOD', generatedAt: new Date(now).toISOString() };
    const stale = { dataQuality: 'GOOD', generatedAt: new Date(now - 60 * 60_000).toISOString() };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 78,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
    } as never, {
      market: fresh, technical: fresh, news: fresh,
      sentiment: stale, macro: fresh, onchain: stale,
    } as never, { symbol: 'ETH-USDT', timeframe: '15m' }, now);

    expect(result).toEqual({ approved: true, verdict: 'APPROVE', reasons: ['VALID_EXACT_EVIDENCE'], severity: 'APPROVE' });
  });

  it('still blocks stale core Market evidence', () => {
    const now = Date.parse('2026-08-14T10:00:00.000Z');
    const fresh = { dataQuality: 'GOOD', generatedAt: new Date(now).toISOString() };
    const stale = { dataQuality: 'GOOD', generatedAt: new Date(now - 60 * 60_000).toISOString() };
    const result = judge.evaluate({
      decision: 'LONG', dataQuality: 'GOOD', conflictLevel: 'LOW', confidence: 78,
      expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30,
    } as never, {
      market: stale, technical: fresh, news: fresh,
      sentiment: fresh, macro: fresh, onchain: fresh,
    } as never, { symbol: 'ETH-USDT', timeframe: '15m' }, now);

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('STALE_ANALYSIS');
  });
});


describe('explicit evidence release modes', () => {
  it.each(['DEMO', 'SHADOW'] as const)('reduces uncertain evidence in %s', (mode) => {
    const good = { dataQuality: 'GOOD', generatedAt: new Date().toISOString(), trend: { direction: 'UP' } };
    const result = new DecisionJudgeService().evaluate({ decision: 'LONG', dataQuality: 'PARTIAL', conflictLevel: 'LOW', confidence: 75, expectedValue: 0.8, profitFactorEstimate: 1.8, riskScore: 30 } as never,
      { market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good } as never, { symbol: 'BTC-USDT', mode, requireCalibratedConfidence: true });
    expect(result).toMatchObject({ approved: true, severity: 'REDUCE_SIZE', sizeFactor: 0.25 });
  });
});

describe('macro news blackout and direction alignment gates', () => {
  const judge = new DecisionJudgeService();
  const baseAnalyses = () => {
    const good = { dataQuality: 'GOOD', generatedAt: new Date().toISOString(), trend: { direction: 'UP' }, anomalies: [] as string[], signals: [] as string[] };
    return {
      market: good,
      technical: good,
      news: good,
      sentiment: good,
      macro: { dataQuality: 'GOOD', generatedAt: new Date().toISOString(), riskFactors: [] as string[], macroTrend: 'NEUTRAL' },
      onchain: good,
    };
  };

  it('blocks directional trade with MACRO_NEWS_BLACKOUT during pre-news window', () => {
    const analyses = baseAnalyses();
    analyses.macro.riskFactors = ['MACRO_NEWS_BLACKOUT: High-impact release pending within window without actual figures.'];
    const result = judge.evaluate(
      {
        decision: 'SHORT',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 82,
        expectedValue: 0.8,
        profitFactorEstimate: 1.8,
        riskScore: 30,
      } as never,
      analyses as never,
      { symbol: 'ARB-USDT' },
    );

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('MACRO_NEWS_BLACKOUT');
  });

  it('blocks SHORT when macroTrend is RISK_ON with MACRO_DIRECTION_CONFLICT', () => {
    const analyses = baseAnalyses();
    analyses.macro.macroTrend = 'RISK_ON';
    const result = judge.evaluate(
      {
        decision: 'SHORT',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 82,
        expectedValue: 0.8,
        profitFactorEstimate: 1.8,
        riskScore: 30,
      } as never,
      analyses as never,
      { symbol: 'ARB-USDT' },
    );

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('MACRO_DIRECTION_CONFLICT');
  });

  it('blocks LONG when macroTrend is RISK_OFF with MACRO_DIRECTION_CONFLICT', () => {
    const analyses = baseAnalyses();
    analyses.macro.macroTrend = 'RISK_OFF';
    const result = judge.evaluate(
      {
        decision: 'LONG',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 82,
        expectedValue: 0.8,
        profitFactorEstimate: 1.8,
        riskScore: 30,
      } as never,
      analyses as never,
      { symbol: 'ETH-USDT' },
    );

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('MACRO_DIRECTION_CONFLICT');
  });

  it('approves LONG when macroTrend is RISK_ON and technicals align', () => {
    const analyses = baseAnalyses();
    analyses.macro.macroTrend = 'RISK_ON';
    const result = judge.evaluate(
      {
        decision: 'LONG',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 82,
        expectedValue: 0.8,
        profitFactorEstimate: 1.8,
        riskScore: 30,
      } as never,
      analyses as never,
      { symbol: 'ETH-USDT' },
    );

    expect(result.approved).toBe(true);
    expect(result.reasons).not.toContain('MACRO_DIRECTION_CONFLICT');
    expect(result.reasons).not.toContain('MACRO_NEWS_BLACKOUT');
  });

  it('blocks entry with PRE_MORTEM_LIQUIDITY_VACUUM when orderbook thinning is detected', () => {
    const analyses = baseAnalyses();
    analyses.market.anomalies = ['Liquidity vacuum: orderbook thinning rapidly ahead of scheduled event.'];
    const result = judge.evaluate(
      {
        decision: 'LONG',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 80,
        expectedValue: 0.8,
        profitFactorEstimate: 1.8,
        riskScore: 30,
      } as never,
      analyses as never,
      { symbol: 'BTC-USDT' },
    );

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('PRE_MORTEM_LIQUIDITY_VACUUM');
  });

  it('blocks entry with PRE_MORTEM_FAKEOUT_RISK when divergence trap exists with sub-75 confidence', () => {
    const analyses = baseAnalyses();
    analyses.technical.signals = ['Exhaustion wick and divergence trap detected on 15m candle.'];
    const result = judge.evaluate(
      {
        decision: 'LONG',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 68,
        directionalAgreement: 65,
        expectedValue: 0.6,
        profitFactorEstimate: 1.5,
        riskScore: 35,
      } as never,
      analyses as never,
      { symbol: 'BTC-USDT' },
    );

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('PRE_MORTEM_FAKEOUT_RISK');
  });

  it('applies CALIBRATION_SHRINKAGE_SIZE_REDUCED instead of blocking when empiricalProbability >= 0.50 and brierScore <= 0.36', () => {
    const good = { dataQuality: 'GOOD', generatedAt: new Date().toISOString() };
    const result = judge.evaluate(
      {
        decision: 'LONG',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 85,
        expectedValue: 1.0,
        profitFactorEstimate: 2.0,
        riskScore: 30,
        confidenceCalibration: {
          status: 'CALIBRATED',
          rawScore: 85,
          empiricalProbability: 0.54, // Positive edge (54% win rate)
          sampleSize: 137,           // >= 100
          bucketSampleSize: 46,
          brierScore: 0.3315,        // > 0.32 but <= 0.36
          scope: 'EXACT',
          fallbackUsed: false,
          hardGateEligible: true,
        },
      } as never,
      {
        market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
      } as never,
      { symbol: 'ZRO-USDT', requireCalibratedConfidence: true },
    );

    expect(result.approved).toBe(true);
    expect(result.severity).toBe('REDUCE_SIZE');
    expect(result.sizeFactor).toBe(0.5);
    expect(result.reasons).toContain('CALIBRATION_SHRINKAGE_SIZE_REDUCED');
  });

  it('retains hard BLOCK CALIBRATION_UNRELIABLE when empiricalProbability < 0.50 despite sampleSize >= 100', () => {
    const good = { dataQuality: 'GOOD', generatedAt: new Date().toISOString() };
    const result = judge.evaluate(
      {
        decision: 'LONG',
        dataQuality: 'GOOD',
        conflictLevel: 'LOW',
        confidence: 85,
        expectedValue: 1.0,
        profitFactorEstimate: 2.0,
        riskScore: 30,
        confidenceCalibration: {
          status: 'CALIBRATED',
          rawScore: 85,
          empiricalProbability: 0.25, // Poor edge (25% win rate like BNB)
          sampleSize: 150,           // >= 100
          bucketSampleSize: 30,
          brierScore: 0.34,          // > 0.32
          scope: 'EXACT',
          fallbackUsed: false,
          hardGateEligible: true,
        },
      } as never,
      {
        market: good, technical: good, news: good, sentiment: good, macro: good, onchain: good,
      } as never,
      { symbol: 'BNB-USDT', requireCalibratedConfidence: true },
    );

    expect(result.approved).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.reasons).toContain('CALIBRATION_UNRELIABLE');
  });
});

describe('execution context setup enforcement', () => {
  const judge = new DecisionJudgeService();
  const now = Date.parse('2026-09-13T06:00:00.000Z');
  const analysesFixture = () => {
    const good = { dataQuality: 'GOOD', generatedAt: new Date(now).toISOString() };
    return {
      market: good,
      technical: good,
      news: good,
      sentiment: good,
      macro: good,
      onchain: good,
    } as never;
  };

  const decisionFixture = (overrides: Record<string, unknown> = {}) => ({
    decision: 'SHORT',
    dataQuality: 'GOOD',
    conflictLevel: 'LOW',
    confidence: 85,
    expectedValue: 0.8,
    profitFactorEstimate: 1.8,
    riskScore: 30,
    generatedAt: new Date(now).toISOString(),
    confidenceCalibration: {
      status: 'CALIBRATED',
      rawScore: 85,
      empiricalProbability: 0.65,
      sampleSize: 120,
      bucketSampleSize: 40,
      brierScore: 0.22,
      scope: 'EXACT',
      fallbackUsed: false,
      hardGateEligible: true,
    },
    ...overrides,
  });

  it('rejects bearish indicators when a range short is near support', () => {
    const zroExecutionContext = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 1.0171,
      support: 1.0151,
      resistance: 1.0245,
      atr: 0.00467606,
      sourceDataCutoff: new Date(now).toISOString(),
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    const review = judge.evaluate(
      decisionFixture({
        decision: 'SHORT',
        executionContext: zroExecutionContext,
      }) as never,
      analysesFixture(),
      { symbol: 'ZRO-USDT', requireCalibratedConfidence: true },
      now,
    );

    expect(review.approved).toBe(false);
    expect(review.reasons).toContain('RANGE_SHORT_NOT_AT_UPPER_BOUNDARY');
  });

  it('rejects when regime and setup are mismatched', () => {
    const mismatchedContext = buildExecutionContext({
      regime: 'RANGING',
      setup: 'TREND_PULLBACK',
      action: 'ENTER',
      price: 100,
      atr: 1,
      sourceDataCutoff: new Date(now).toISOString(),
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    const review = judge.evaluate(
      decisionFixture({
        decision: 'LONG',
        executionContext: mismatchedContext,
      }) as never,
      analysesFixture(),
      { symbol: 'BTC-USDT' },
      now,
    );

    expect(review.approved).toBe(false);
    expect(review.reasons).toContain('REGIME_SETUP_MISMATCH');
  });

  it('rejects when primary candle is not closed for ENTER action', () => {
    const openCandleContext = buildExecutionContext({
      regime: 'TRENDING',
      setup: 'TREND_PULLBACK',
      action: 'ENTER',
      price: 100,
      atr: 1,
      sourceDataCutoff: new Date(now).toISOString(),
      primaryCandleClosed: false,
      triggerConfirmed: true,
    });

    const review = judge.evaluate(
      decisionFixture({
        decision: 'LONG',
        executionContext: openCandleContext,
      }) as never,
      analysesFixture(),
      { symbol: 'BTC-USDT' },
      now,
    );

    expect(review.approved).toBe(false);
    expect(review.reasons).toContain('PRIMARY_CANDLE_NOT_CLOSED');
  });

  it('rejects when entry trigger is unconfirmed', () => {
    const unconfirmedContext = buildExecutionContext({
      regime: 'BREAKOUT',
      setup: 'BREAKOUT_RETEST',
      action: 'ENTER',
      price: 100,
      atr: 1,
      sourceDataCutoff: new Date(now).toISOString(),
      primaryCandleClosed: true,
      triggerConfirmed: false,
    });

    const review = judge.evaluate(
      decisionFixture({
        decision: 'LONG',
        executionContext: unconfirmedContext,
      }) as never,
      analysesFixture(),
      { symbol: 'BTC-USDT' },
      now,
    );

    expect(review.approved).toBe(false);
    expect(review.reasons).toContain('ENTRY_TRIGGER_NOT_CONFIRMED');
  });

  it('rejects when entry chase distance is exceeded', () => {
    const chasedContext = buildExecutionContext({
      regime: 'BREAKOUT',
      setup: 'BREAKOUT_RETEST',
      action: 'ENTER',
      price: 102,
      triggerPrice: 100,
      atr: 1,
      sourceDataCutoff: new Date(now).toISOString(),
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    const review = judge.evaluate(
      decisionFixture({
        decision: 'LONG',
        executionContext: chasedContext,
      }) as never,
      analysesFixture(),
      { symbol: 'BTC-USDT' },
      now,
    );

    expect(review.approved).toBe(false);
    expect(review.reasons).toContain('ENTRY_CHASE_DISTANCE_EXCEEDED');
  });

  it('rejects when expected move is already consumed', () => {
    const consumedContext = buildExecutionContext({
      regime: 'TRENDING',
      setup: 'TREND_PULLBACK',
      action: 'ENTER',
      price: 100,
      atr: 1,
      moveConsumedPct: 0.6,
      sourceDataCutoff: new Date(now).toISOString(),
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    const review = judge.evaluate(
      decisionFixture({
        decision: 'LONG',
        executionContext: consumedContext,
      }) as never,
      analysesFixture(),
      { symbol: 'BTC-USDT' },
      now,
    );

    expect(review.approved).toBe(false);
    expect(review.reasons).toContain('EXPECTED_MOVE_ALREADY_CONSUMED');
  });

  it('approves a valid range short at the upper boundary', () => {
    const validUpperBoundaryContext = buildExecutionContext({
      regime: 'RANGING',
      setup: 'RANGE_REVERSION',
      action: 'ENTER',
      price: 1.0235,
      support: 1.0151,
      resistance: 1.0245,
      atr: 0.00467606,
      sourceDataCutoff: new Date(now).toISOString(),
      primaryCandleClosed: true,
      triggerConfirmed: true,
    });

    const review = judge.evaluate(
      decisionFixture({
        decision: 'SHORT',
        executionContext: validUpperBoundaryContext,
      }) as never,
      analysesFixture(),
      { symbol: 'ZRO-USDT', requireCalibratedConfidence: true },
      now,
    );

    expect(review.approved).toBe(true);
    expect(review.verdict).toBe('APPROVE');
  });
});

