import { Injectable } from '@nestjs/common';
import type { AnticipatoryMarketSnapshot } from '@platform/shared';

import {
  ExchangeInterval,
  ExchangeProvider,
} from '../../../../exchange/domain/exchange.types';
import type {
  IndicatorSnapshot,
  NormalizedCandle,
  NormalizedFundingRate,
  NormalizedOpenInterest,
} from '../../../../market-data/domain/market-data.types';
import { IndicatorStatus } from '../../../../market-data/domain/market-data.enums';
import { MarketDataRepository } from '../../../../market-data/infrastructure/persistence/market-data.repository';
import {
  buildAnticipatoryMarketSnapshot,
  type AnticipatoryDerivativesInput,
  type AnticipatorySnapshotInput,
  type AnticipatoryExecutionInput,
} from '../../domain/analysis/anticipatory-snapshot-builder';
import { predictDerivativesImbalance } from '../../domain/analysis/derivatives-imbalance-predictor';
import { AgentContextSnapshotRepository } from '../../infrastructure/persistence/agent-context-snapshot.repository';

export interface BuildAnticipatorySnapshotInput {
  userId: string;
  provider: ExchangeProvider;
  symbol: string;
  timeframe: ExchangeInterval;
  sourceDataCutoff: Date;
  execution?: AnticipatoryExecutionInput;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function trend(values: number[]): 'RISING' | 'FALLING' | 'FLAT' {
  if (values.length < 2) return 'FLAT';
  const first = values[0]!;
  const last = values.at(-1)!;
  if (last > first) return 'RISING';
  if (last < first) return 'FALLING';
  return 'FLAT';
}

function indicatorInputs(
  indicator: IndicatorSnapshot | null,
): Pick<AnticipatorySnapshotInput, 'rsiHistory' | 'macdHistory' | 'atrHistory'> {
  if (indicator === null) return {};
  const timestamp = indicator.candleCloseTime;
  const rsi = finiteNumber(indicator.values.rsi14);
  const atr = finiteNumber(indicator.values.atr14);
  const macdValue = finiteNumber(indicator.values.macd?.value);
  const macdSignal = finiteNumber(indicator.values.macd?.signal);
  const macdHistogram = finiteNumber(indicator.values.macd?.histogram);
  return {
    ...(rsi === undefined ? {} : { rsiHistory: [{ timestamp, value: rsi }] }),
    ...(atr === undefined ? {} : { atrHistory: [{ timestamp, value: atr }] }),
    ...(macdValue === undefined || macdSignal === undefined || macdHistogram === undefined
      ? {}
      : {
          macdHistory: [{
            timestamp,
            value: macdValue,
            signal: macdSignal,
            histogram: macdHistogram,
          }],
        }),
  };
}

function derivativesInput(
  fundingRows: NormalizedFundingRate[],
  openInterestRows: NormalizedOpenInterest[],
  candles: NormalizedCandle[],
  sourceDataCutoff: Date,
): AnticipatoryDerivativesInput | undefined {
  const funding = fundingRows
    .map((row) => ({ timestamp: row.fundingTime, value: Number(row.fundingRate) }))
    .filter(
      (row) =>
        Number.isFinite(row.value) &&
        Number.isFinite(row.timestamp.getTime()) &&
        row.timestamp <= sourceDataCutoff,
    )
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const openInterest = openInterestRows
    .map((row) => ({ timestamp: row.timestamp, value: Number(row.openInterest) }))
    .filter(
      (row) =>
        Number.isFinite(row.value) &&
        row.value >= 0 &&
        Number.isFinite(row.timestamp.getTime()) &&
        row.timestamp <= sourceDataCutoff,
    )
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const currentFunding = funding.at(-1);
  const currentOpenInterest = openInterest.at(-1);
  if (currentFunding === undefined || currentOpenInterest === undefined) return undefined;

  const closed = candles
    .filter(
      (candle) =>
        candle.isClosed &&
        Number.isFinite(candle.closeTime.getTime()) &&
        candle.closeTime <= sourceDataCutoff &&
        finiteNumber(candle.close) !== undefined &&
        Number(candle.close) > 0,
    )
    .slice()
    .sort((left, right) => left.closeTime.getTime() - right.closeTime.getTime());
  if (closed.length < 2) return undefined;
  const currentPrice = finiteNumber(closed.at(-1)?.close);
  const previousPrice = finiteNumber(closed.at(-2)?.close);
  if (currentPrice === undefined || previousPrice === undefined || previousPrice <= 0) {
    return undefined;
  }
  const priceChange = ((currentPrice - previousPrice) / previousPrice) * 100;
  const imbalance = predictDerivativesImbalance({
    currentFundingRate: currentFunding.value,
    historicalFundingRates: funding.map((row) => row.value),
    currentOI: currentOpenInterest.value,
    historicalOpenInterest: openInterest.map((row) => row.value),
    priceChange,
    oiTrend: trend(openInterest.map((row) => row.value)),
    fundingTrend: trend(funding.map((row) => row.value)),
  });
  const timestamp = new Date(Math.min(
    currentFunding.timestamp.getTime(),
    currentOpenInterest.timestamp.getTime(),
    closed.at(-2)!.closeTime.getTime(),
  ));

  return {
    timestamp,
    fundingRate: currentFunding.value,
    fundingHistory: funding,
    openInterest: currentOpenInterest.value,
    openInterestHistory: openInterest,
    priceOpenInterestDivergence:
      imbalance.coverage === 'AVAILABLE' ? imbalance.oiPriceDivergence : 'ALIGNED',
    source: 'MARKET_DATA_REPOSITORY',
    ...(imbalance.coverage === 'AVAILABLE'
      ? {
          derivativesImbalance: {
            timestamp,
            fundingExtreme: imbalance.fundingExtreme,
            oiPriceDivergence: imbalance.oiPriceDivergence,
            squeezeProbability: imbalance.squeezeProbability,
            squeezeDirection: imbalance.squeezeDirection,
            signals: imbalance.signals,
            source: 'DERIVATIVES_IMBALANCE_PREDICTOR',
          },
        }
      : {}),
  };
}

@Injectable()
export class AnticipatorySnapshotService {
  public constructor(
    private readonly marketDataRepository: MarketDataRepository,
    private readonly snapshotRepository: AgentContextSnapshotRepository,
  ) {}

  public async build(
    input: BuildAnticipatorySnapshotInput,
  ): Promise<AnticipatoryMarketSnapshot> {
    const cutoff = new Date(input.sourceDataCutoff);
    if (!Number.isFinite(cutoff.getTime())) {
      throw new Error('sourceDataCutoff must be a valid timestamp');
    }

    const [candles, indicator, funding, openInterest, context] = await Promise.all([
      this.marketDataRepository.getClosedCandles({
        provider: input.provider,
        symbol: input.symbol,
        interval: input.timeframe,
        beforeTime: cutoff,
        limit: 250,
      }),
      this.marketDataRepository.getLatestIndicatorSnapshot(
        input.provider,
        input.symbol,
        input.timeframe,
        cutoff,
        IndicatorStatus.CLOSED,
      ),
      this.marketDataRepository.getFundingRates({
        provider: input.provider,
        symbol: input.symbol,
        endTime: cutoff,
        limit: 100,
      }),
      this.marketDataRepository.getOpenInterestHistory({
        provider: input.provider,
        symbol: input.symbol,
        endTime: cutoff,
        limit: 100,
      }),
      this.snapshotRepository.findLatestAnticipatoryContext({
        userId: input.userId,
        provider: input.provider,
        symbol: input.symbol,
        timeframe: input.timeframe,
        sourceDataCutoff: cutoff,
      }),
    ]);

    const alignedClosedCandles = candles.filter(
      (candle) =>
        candle.provider === input.provider &&
        candle.symbol === input.symbol &&
        candle.interval === input.timeframe &&
        candle.isClosed &&
        candle.closeTime <= cutoff,
    );
    const snapshot = buildAnticipatoryMarketSnapshot({
      symbol: input.symbol,
      provider: input.provider,
      timeframe: input.timeframe,
      sourceDataCutoff: cutoff,
      calculationVersion: indicator?.calculationVersion,
      candles: alignedClosedCandles.map((candle) => ({
        openTime: candle.openTime,
        closeTime: candle.closeTime,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
        isClosed: candle.isClosed,
      })),
      ...indicatorInputs(indicator),
      derivatives: derivativesInput(
        funding,
        openInterest,
        alignedClosedCandles,
        cutoff,
      ),
      context,
      execution: input.execution,
    });

    await this.snapshotRepository.saveAnticipatorySnapshot({
      userId: input.userId,
      provider: input.provider,
      symbol: input.symbol,
      timeframe: input.timeframe,
      sourceDataCutoff: cutoff,
      snapshot,
    });
    return snapshot;
  }
}
