import { describe, expect, it } from 'vitest';
import {
  analyzeMultiTimeframe,
  evaluateMultiTimeframeDecision,
  selectPipelineTimeframes,
} from '../../src/modules/pipeline/domain/multi-timeframe-analysis';

describe('multi-timeframe pipeline analysis', () => {
  it('uses 15m as setup timeframe while retaining all user preferences', () => {
    expect(selectPipelineTimeframes(undefined, ['5m', '15m', '1h', '4h'])).toEqual({
      primary: '15m',
      selected: ['5m', '15m', '1h', '4h'],
    });
  });

  it('honors an explicit timeframe and includes it in confirmation data', () => {
    expect(selectPipelineTimeframes('1h', ['5m', '15m'])).toEqual({
      primary: '1h',
      selected: ['5m', '15m', '1h'],
    });
  });

  it('rejects a long entry when higher timeframes carry opposing weight', () => {
    const analysis = analyzeMultiTimeframe('15m', [
      { timeframe: '5m', close: 11, ema20: 10, ema50: 9 },
      { timeframe: '15m', close: 11, ema20: 10, ema50: 9 },
      { timeframe: '1h', close: 8, ema20: 9, ema50: 10 },
      { timeframe: '4h', close: 8, ema20: 9, ema50: 10 },
    ]);

    expect(evaluateMultiTimeframeDecision('LONG', analysis)).toEqual({
      allowed: false,
      reason: 'MULTI_TIMEFRAME_CONFLICT',
      confirmation: 30,
    });
    expect(evaluateMultiTimeframeDecision('SHORT', analysis)).toEqual({
      allowed: true,
      confirmation: 70,
    });
  });

  it('does not block when fewer than two timeframes have usable direction', () => {
    const analysis = analyzeMultiTimeframe('15m', [
      { timeframe: '5m' },
      { timeframe: '15m', close: 11, ema20: 10, ema50: 9 },
      { timeframe: '1h', close: 10, ema20: 11, ema50: 9 },
    ]);

    expect(evaluateMultiTimeframeDecision('SHORT', analysis)).toEqual({
      allowed: true,
      confirmation: 0,
    });
  });
});
