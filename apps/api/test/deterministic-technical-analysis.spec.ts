import { describe, expect, it } from 'vitest';
import { deterministicTechnicalAnalysis } from '../src/modules/agents/domain/analysis/deterministic-core-analysis';

const baseIndicators = {
  ema20: 50000,
  ema50: 48000,
  rsi: 55,
  macdHistogram: 100,
  bollingerUpper: 52000,
  bollingerMid: 50000,
  bollingerLower: 48000,
  atr: 800,
};

const makeCandles = (n: number, startPrice = 49000, step = 100) =>
  Array.from({ length: n }, (_, i) => ({
    close: startPrice + i * step,
    high: startPrice + i * step + 300,
    low: startPrice + i * step - 300,
    volume: 1000,
  }));

describe('Bollinger Squeeze', () => {
  it('should be false when bandwidth >= 3%', () => {
    // bandwidth = (52000-48000)/50000 = 8% → not squeeze
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': baseIndicators,
        'market.candles.list': { candles: makeCandles(25) },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.volatility.bollinger.squeeze).toBe(false);
  });

  it('should be true when bandwidth < 3%', () => {
    // bandwidth = (50300-49700)/50000 = 1.2% → squeeze
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          bollingerUpper: 50300,
          bollingerMid: 50000,
          bollingerLower: 49700,
        },
        'market.candles.list': { candles: makeCandles(25) },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.volatility.bollinger.squeeze).toBe(true);
  });

  it('should be false when bollinger indicators are missing', () => {
    const noBollinger = {
      ema20: baseIndicators.ema20,
      ema50: baseIndicators.ema50,
      rsi: baseIndicators.rsi,
      macdHistogram: baseIndicators.macdHistogram,
      atr: baseIndicators.atr,
    };
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': noBollinger,
        'market.candles.list': { candles: makeCandles(25) },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.volatility.bollinger.squeeze).toBe(false);
  });
});

describe('Bollinger Position', () => {
  it('should be UPPER when price > bollingerUpper', () => {
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          bollingerUpper: 49500,
          bollingerMid: 48000,
          bollingerLower: 46500,
        },
        'market.candles.list': { candles: makeCandles(25, 50000) }, // price ~52400 > 49500
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.volatility.bollinger.position).toBe('UPPER');
  });

  it('should be LOWER when price < bollingerLower', () => {
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          bollingerUpper: 55000,
          bollingerMid: 53000,
          bollingerLower: 51000,
        },
        'market.candles.list': { candles: makeCandles(25, 48000, 0) }, // price 48000 < 51000
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.volatility.bollinger.position).toBe('LOWER');
  });

  it('should be MIDDLE when price is within bands', () => {
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          bollingerUpper: 55000,
          bollingerMid: 50000,
          bollingerLower: 45000,
        },
        'market.candles.list': { candles: makeCandles(25, 50000, 0) }, // price 50000
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.volatility.bollinger.position).toBe('MIDDLE');
  });
});

describe('RSI Divergence', () => {
  it('should detect BEARISH RSI divergence when price makes higher high but RSI drops', () => {
    const candles = [
      ...makeCandles(10, 50000, 0),
      ...makeCandles(10, 52000, 0),
    ];
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          rsi: 40,
          macdHistogram: -10,
        },
        'market.candles.list': { candles },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.divergence.rsiDivergence).toBe('BEARISH');
  });

  it('should detect BULLISH RSI divergence when price makes lower low but RSI is higher', () => {
    const candles = [
      ...makeCandles(10, 50000, 0),
      ...makeCandles(10, 48000, 0),
    ];
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          rsi: 65,
          macdHistogram: 10,
        },
        'market.candles.list': { candles },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.divergence.rsiDivergence).toBe('BULLISH');
  });

  it('should return NONE when candles < 10', () => {
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': baseIndicators,
        'market.candles.list': { candles: makeCandles(8) },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.divergence.rsiDivergence).toBe('NONE');
  });
});

describe('MACD Divergence', () => {
  it('should detect BEARISH MACD divergence when price makes higher high but macdHistogram < 0', () => {
    const candles = [
      ...makeCandles(10, 50000, 0),
      ...makeCandles(10, 52000, 0),
    ];
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          macdHistogram: -5,
        },
        'market.candles.list': { candles },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.divergence.macdDivergence).toBe('BEARISH');
  });

  it('should detect BULLISH MACD divergence when price makes lower low but macdHistogram > 0', () => {
    const candles = [
      ...makeCandles(10, 50000, 0),
      ...makeCandles(10, 48000, 0),
    ];
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          macdHistogram: 5,
        },
        'market.candles.list': { candles },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.divergence.macdDivergence).toBe('BULLISH');
  });

  it('should return NONE when conditions not met', () => {
    const candles = [
      ...makeCandles(10, 50000, 0),
      ...makeCandles(10, 50100, 0),
    ];
    const result = deterministicTechnicalAnalysis(
      {
        'market.indicators.get': {
          ...baseIndicators,
          macdHistogram: 5,
        },
        'market.candles.list': { candles },
      },
      ['market.indicators.get', 'market.candles.list'],
    );
    expect(result?.divergence.macdDivergence).toBe('NONE');
  });
});
