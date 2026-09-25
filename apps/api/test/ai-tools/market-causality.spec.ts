import { describe, expect, it } from 'vitest';

import { calculateMarketCausality } from '../../src/modules/ai-tools/domain/market-causality';

const candles = (lastClose: number, lastVolume: number) => [
  { close: 100, volume: 100 },
  { close: 101, volume: 100 },
  { close: lastClose, volume: lastVolume },
];

describe('calculateMarketCausality', () => {
  it('classifies price, volume and OI expansion against negative funding as a short squeeze', () => {
    expect(calculateMarketCausality({
      candles: candles(103, 180),
      openInterest: [{ openInterest: 1000 }, { openInterest: 1030 }],
      funding: [{ fundingRate: -0.0002 }],
    })).toMatchObject({
      volumeRatio: 1.8,
      priceChangePercent: 3,
      deltaOi: 30,
      deltaOiPercent: 3,
      squeezeIndicator: 'SHORT_SQUEEZE',
      causality: 'PRICE_VOLUME_OI_EXPANSION_WITH_NEGATIVE_FUNDING',
    });
  });

  it('distinguishes leveraged long buildup from deleveraging', () => {
    expect(calculateMarketCausality({
      candles: candles(103, 180),
      openInterest: [{ openInterest: 1000 }, { openInterest: 1030 }],
      funding: [{ fundingRate: 0.0002 }],
    }).squeezeIndicator).toBe('LONG_BUILDUP');

    expect(calculateMarketCausality({
      candles: candles(103, 180),
      openInterest: [{ openInterest: 1000 }, { openInterest: 950 }],
      funding: [{ fundingRate: -0.0002 }],
    }).squeezeIndicator).toBe('DELEVERAGING');
  });

  it('normalizes timestamped newest-first OI history before calculating the delta', () => {
    expect(calculateMarketCausality({
      candles: candles(103, 180),
      openInterest: [
        { openInterest: 1030, timestamp: new Date('2026-09-20T10:05:00Z') },
        { openInterest: 1000, timestamp: new Date('2026-09-20T10:00:00Z') },
      ],
      funding: [{ fundingRate: -0.0002 }],
    })).toMatchObject({
      deltaOi: 30,
      deltaOiPercent: 3,
      squeezeIndicator: 'SHORT_SQUEEZE',
    });
  });

  it('reports missing evidence and never invents a squeeze from zero volume history', () => {
    expect(calculateMarketCausality({
      candles: [{ close: 100, volume: 0 }, { close: 103, volume: 180 }],
      openInterest: [],
      funding: [],
    })).toMatchObject({
      volumeRatio: undefined,
      deltaOi: undefined,
      squeezeIndicator: 'NONE',
      missingEvidence: [
        'AVERAGE_VOLUME_UNAVAILABLE',
        'OPEN_INTEREST_HISTORY_UNAVAILABLE',
        'FUNDING_UNAVAILABLE',
        'LIQUIDATION_DATA_UNAVAILABLE',
      ],
    });
  });
});
