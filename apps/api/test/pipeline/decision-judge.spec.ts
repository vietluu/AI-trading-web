import { describe, expect, it } from 'vitest';
import { DecisionJudgeService } from '../../src/modules/pipeline/application/decision-judge.service';

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

    expect(result).toEqual({ approved: true, verdict: 'APPROVE', reasons: [] });
  });

  it('keeps an unreliable global fallback as telemetry instead of a hard veto', () => {
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

    expect(result).toEqual({ approved: true, verdict: 'APPROVE', reasons: [] });
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

    expect(result).toEqual(expect.objectContaining({ approved: false, verdict: 'REQUEST_MORE_DATA' }));
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

    expect(result).toEqual({ approved: true, verdict: 'APPROVE', reasons: [] });
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
    expect(result.reasons).toContain('STALE_ANALYSIS');
  });
});
