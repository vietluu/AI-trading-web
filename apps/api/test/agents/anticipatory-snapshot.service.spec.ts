import {
  AnticipatoryMarketSnapshotSchema,
  type AnticipatoryMarketSnapshot,
} from '@platform/shared';
import { describe, expect, it, vi } from 'vitest';

import { ExchangeInterval, ExchangeProvider } from '../../src/exchange/domain/exchange.types';
import { IndicatorStatus } from '../../src/market-data/domain/market-data.enums';
import type {
  IndicatorSnapshot,
  NormalizedFundingRate,
  NormalizedOpenInterest,
} from '../../src/market-data/domain/market-data.types';
import { AnticipatorySnapshotService } from '../../src/modules/agents/application/services/anticipatory-snapshot.service';
import type { AnticipatoryContextInput } from '../../src/modules/agents/domain/analysis/anticipatory-snapshot-builder';

const cutoff = new Date('2026-09-09T12:00:00.000Z');
const minute = 60_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function candles() {
  const start = cutoff.getTime() - 40 * minute;
  return Array.from({ length: 40 }, (_, index) => {
    const close = index >= 38 ? 100 : 100 + Math.sin(index / 2) * 4;
    return {
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.ONE_MINUTE,
      openTime: new Date(start + index * minute),
      closeTime: new Date(start + (index + 1) * minute),
      open: String(close - 0.1),
      high: String(close + 1),
      low: String(close - 1),
      close: String(close),
      volume: String(100 + index),
      isClosed: true,
    };
  });
}

describe('AnticipatorySnapshotService', () => {
  it('loads cutoff-bounded evidence concurrently and persists a runtime-valid snapshot', async () => {
    const calls: string[] = [];
    const candleResult = deferred<ReturnType<typeof candles>>();
    const indicatorResult = deferred<IndicatorSnapshot | null>();
    const fundingResult = deferred<NormalizedFundingRate[]>();
    const oiResult = deferred<NormalizedOpenInterest[]>();
    const contextResult = deferred<AnticipatoryContextInput | undefined>();
    const saveAnticipatorySnapshot = vi.fn(
      (input: { snapshot: AnticipatoryMarketSnapshot }) => Promise.resolve(input),
    );

    const marketData = {
      getClosedCandles: vi.fn((query) => {
        calls.push('candles');
        expect(query).toEqual({
          provider: ExchangeProvider.BINANCE_FUTURES,
          symbol: 'BTC-USDT',
          interval: ExchangeInterval.ONE_MINUTE,
          beforeTime: cutoff,
          limit: 250,
        });
        return candleResult.promise;
      }),
      getLatestIndicatorSnapshot: vi.fn((provider, symbol, interval, atOrBefore, status) => {
        calls.push('indicator');
        expect([provider, symbol, interval, atOrBefore, status]).toEqual([
          ExchangeProvider.BINANCE_FUTURES,
          'BTC-USDT',
          ExchangeInterval.ONE_MINUTE,
          cutoff,
          IndicatorStatus.CLOSED,
        ]);
        return indicatorResult.promise;
      }),
      getFundingRates: vi.fn((query) => {
        calls.push('funding');
        expect(query).toMatchObject({ endTime: cutoff });
        return fundingResult.promise;
      }),
      getOpenInterestHistory: vi.fn((query) => {
        calls.push('open-interest');
        expect(query).toMatchObject({ endTime: cutoff });
        return oiResult.promise;
      }),
    };
    const snapshots = {
      findLatestAnticipatoryContext: vi.fn((query) => {
        calls.push('context');
        expect(query).toMatchObject({ sourceDataCutoff: cutoff });
        return contextResult.promise;
      }),
      saveAnticipatorySnapshot,
    };

    const buildPromise = new AnticipatorySnapshotService(
      marketData as never,
      snapshots as never,
    ).build({
      userId: '00000000-0000-4000-8000-000000000001',
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      timeframe: ExchangeInterval.ONE_MINUTE,
      sourceDataCutoff: cutoff,
    });

    await Promise.resolve();
    expect(calls).toEqual([
      'candles',
      'indicator',
      'funding',
      'open-interest',
      'context',
    ]);

    const candleRows = candles();
    candleResult.resolve(candleRows);
    indicatorResult.resolve({
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.ONE_MINUTE,
      candleOpenTime: candleRows.at(-1)!.openTime,
      candleCloseTime: cutoff,
      status: IndicatorStatus.CLOSED,
      values: {
        rsi14: '42',
        macd: { value: '-0.2', signal: '-0.1', histogram: '-0.1' },
        atr14: '2',
      },
      calculatedAt: cutoff,
      calculationVersion: 2,
    });
    fundingResult.resolve(
      [-0.05, 0, 0.01, 0.02, 0.03, 0.04].map((fundingRate, index) => ({
        provider: ExchangeProvider.BINANCE_FUTURES,
        symbol: 'BTC-USDT',
        fundingRate: String(fundingRate),
        fundingTime: new Date(cutoff.getTime() - index * minute),
      })),
    );
    oiResult.resolve([
      {
        provider: ExchangeProvider.BINANCE_FUTURES,
        symbol: 'BTC-USDT',
        openInterest: '110',
        timestamp: cutoff,
      },
      {
        provider: ExchangeProvider.BINANCE_FUTURES,
        symbol: 'BTC-USDT',
        openInterest: '100',
        timestamp: new Date(cutoff.getTime() - minute),
      },
    ]);
    contextResult.resolve({
      news: {
        source: 'REUTERS',
        freshnessThresholdMs: minute,
        observations: [
          {
            observedAt: new Date(cutoff.getTime() - 10 * minute),
            summary: 'Stale but still provenance-bearing context',
          },
        ],
      },
    });

    const snapshot = await buildPromise;

    expect(AnticipatoryMarketSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.derivatives).toMatchObject({
      coverage: 'AVAILABLE',
      derivativesImbalance: {
        coverage: 'AVAILABLE',
        fundingExtreme: 'EXTREME_NEGATIVE',
        oiPriceDivergence: 'OI_RISING_PRICE_FLAT',
      },
    });
    expect(snapshot.context).toMatchObject({
      coverage: 'AVAILABLE',
      news: { coverage: 'AVAILABLE', freshness: 'STALE' },
    });
    expect(saveAnticipatorySnapshot).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000001',
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      timeframe: ExchangeInterval.ONE_MINUTE,
      sourceDataCutoff: cutoff,
      snapshot,
    });
  });

  it('keeps derivatives unavailable when actual histories are too short', async () => {
    const candleRows = candles();
    const saveAnticipatorySnapshot = vi.fn(
      (input: { snapshot: AnticipatoryMarketSnapshot }) => Promise.resolve(input),
    );
    const service = new AnticipatorySnapshotService(
      {
        getClosedCandles: vi.fn().mockResolvedValue(candleRows),
        getLatestIndicatorSnapshot: vi.fn().mockResolvedValue(null),
        getFundingRates: vi.fn().mockResolvedValue([
          {
            fundingRate: '0.01',
            fundingTime: cutoff,
          },
        ]),
        getOpenInterestHistory: vi.fn().mockResolvedValue([
          {
            openInterest: '100',
            timestamp: cutoff,
          },
        ]),
      } as never,
      {
        findLatestAnticipatoryContext: vi.fn().mockResolvedValue(undefined),
        saveAnticipatorySnapshot,
      } as never,
    );

    const snapshot = await service.build({
      userId: '00000000-0000-4000-8000-000000000001',
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      timeframe: ExchangeInterval.ONE_MINUTE,
      sourceDataCutoff: cutoff,
    });

    expect(snapshot.derivatives).toEqual({
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: [
        'derivatives.fundingRatePercentile',
        'derivatives.openInterestChangePct',
      ],
      reason: 'DERIVATIVES_HISTORY_INSUFFICIENT_AT_CUTOFF',
    });
    expect(saveAnticipatorySnapshot).toHaveBeenCalledOnce();
  });

  it('keeps derivatives unavailable without two valid aligned price candles', async () => {
    const [aligned, unaligned] = candles().slice(-2);
    const service = new AnticipatorySnapshotService(
      {
        getClosedCandles: vi.fn().mockResolvedValue([
          aligned,
          { ...unaligned, symbol: 'ETH-USDT' },
        ]),
        getLatestIndicatorSnapshot: vi.fn().mockResolvedValue(null),
        getFundingRates: vi.fn().mockResolvedValue(
          [-0.05, 0, 0.01, 0.02, 0.03].map((fundingRate, index) => ({
            fundingRate: String(fundingRate),
            fundingTime: new Date(cutoff.getTime() - index * minute),
          })),
        ),
        getOpenInterestHistory: vi.fn().mockResolvedValue([
          { openInterest: '110', timestamp: cutoff },
          { openInterest: '100', timestamp: new Date(cutoff.getTime() - minute) },
        ]),
      } as never,
      {
        findLatestAnticipatoryContext: vi.fn().mockResolvedValue(undefined),
        saveAnticipatorySnapshot: vi.fn().mockResolvedValue(undefined),
      } as never,
    );

    const snapshot = await service.build({
      userId: '00000000-0000-4000-8000-000000000001',
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      timeframe: ExchangeInterval.ONE_MINUTE,
      sourceDataCutoff: cutoff,
    });

    expect(snapshot.derivatives).toEqual({
      coverage: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      observationAgeMs: null,
      unavailableFields: ['derivatives'],
      reason: 'DERIVATIVES_UNAVAILABLE',
    });
  });

  it('uses the older comparison candle timestamp for derivatives freshness', async () => {
    const candleRows = candles().slice(-2).map((candle, index) => ({
      ...candle,
      openTime: new Date(cutoff.getTime() - (index === 0 ? 11 : 1) * minute),
      closeTime: new Date(cutoff.getTime() - (index === 0 ? 10 : 0) * minute),
    }));
    const service = new AnticipatorySnapshotService(
      {
        getClosedCandles: vi.fn().mockResolvedValue(candleRows),
        getLatestIndicatorSnapshot: vi.fn().mockResolvedValue(null),
        getFundingRates: vi.fn().mockResolvedValue(
          [-0.05, 0, 0.01, 0.02, 0.03].map((fundingRate, index) => ({
            fundingRate: String(fundingRate),
            fundingTime: new Date(cutoff.getTime() - index * minute),
          })),
        ),
        getOpenInterestHistory: vi.fn().mockResolvedValue([
          { openInterest: '110', timestamp: cutoff },
          { openInterest: '100', timestamp: new Date(cutoff.getTime() - minute) },
        ]),
      } as never,
      {
        findLatestAnticipatoryContext: vi.fn().mockResolvedValue(undefined),
        saveAnticipatorySnapshot: vi.fn().mockResolvedValue(undefined),
      } as never,
    );

    const snapshot = await service.build({
      userId: '00000000-0000-4000-8000-000000000001',
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      timeframe: ExchangeInterval.ONE_MINUTE,
      sourceDataCutoff: cutoff,
    });

    expect(snapshot.derivatives).toMatchObject({
      coverage: 'AVAILABLE',
      freshness: 'STALE',
      sourceTimestamp: new Date(cutoff.getTime() - 10 * minute).toISOString(),
      derivativesImbalance: {
        coverage: 'AVAILABLE',
        freshness: 'STALE',
        sourceTimestamp: new Date(cutoff.getTime() - 10 * minute).toISOString(),
      },
    });
  });
});
