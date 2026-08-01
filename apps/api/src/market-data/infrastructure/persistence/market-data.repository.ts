import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '@prisma/client';
import type { ExchangeProvider, ExchangeInterval } from '../../../exchange/domain/exchange.types';
import type { NormalizedCandle, NormalizedFundingRate } from '../../domain/market-data.types';

// Type definitions for repository inputs
interface CandleInput extends Omit<NormalizedCandle, 'provider'> {
  provider: ExchangeProvider;
}

interface FundingRateInput extends Omit<NormalizedFundingRate, 'provider'> {
  provider: ExchangeProvider;
}

interface OpenInterestInput {
  provider: ExchangeProvider;
  symbol: string;
  recordedAt: Date;
  openInterest: string | number;
  openInterestValue?: string | number;
}

interface InstrumentInput {
  provider: ExchangeProvider;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settlementAsset: string;
  type: string;
  status: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: string | number;
  stepSize: string | number;
  minQuantity?: string | number;
  maxQuantity?: string | number;
  minNotional?: string | number;
  contractSize?: string | number;
}

interface GapInput {
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  gapStart: Date;
  gapEnd: Date;
  status: string;
}

interface IncidentInput {
  provider: ExchangeProvider;
  symbol: string;
  code: string;
  message: string;
  metadata?: unknown;
}

interface IndicatorSnapshotInput {
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  candleOpenTime: Date;
  candleCloseTime: Date;
  status: string;
  values: Record<string, unknown>;
  calculationVersion: number;
}

@Injectable()
export class MarketDataRepository {
  private readonly logger = new Logger(MarketDataRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private mapInterval(interval: string): string {
    return `i${interval}`;
  }

  private mapCandleFromDb = (db: {
    interval: string;
    open: Prisma.Decimal;
    high: Prisma.Decimal;
    low: Prisma.Decimal;
    close: Prisma.Decimal;
    volume: Prisma.Decimal;
    quoteVolume: Prisma.Decimal | null;
    [key: string]: unknown;
  }): Record<string, unknown> => ({
    ...db,
    interval: typeof db.interval === 'string' ? db.interval.replace(/^i/, '') : db.interval,
    open: db.open.toString(),
    high: db.high.toString(),
    low: db.low.toString(),
    close: db.close.toString(),
    volume: db.volume.toString(),
    quoteVolume: db.quoteVolume ? db.quoteVolume.toString() : undefined,
  });

  private mapFundingRateFromDb = (db: unknown): Record<string, unknown> => {
    const data = db as { fundingRate: Prisma.Decimal; markPrice: Prisma.Decimal | null; indexPrice: Prisma.Decimal | null; [key: string]: unknown };
    return {
      ...data,
      fundingRate: data.fundingRate.toString(),
      markPrice: data.markPrice ? data.markPrice.toString() : undefined,
      indexPrice: data.indexPrice ? data.indexPrice.toString() : undefined,
    };
  };

  private mapOpenInterestFromDb = (db: {
    openInterest: Prisma.Decimal;
    openInterestValue: Prisma.Decimal | null;
    [key: string]: unknown;
  }): Record<string, unknown> => ({
    ...db,
    openInterest: db.openInterest.toString(),
    openInterestValue: db.openInterestValue ? db.openInterestValue.toString() : undefined,
  });

  private mapInstrumentFromDb = (db: {
    tickSize: Prisma.Decimal;
    stepSize: Prisma.Decimal;
    [key: string]: unknown;
  }): Record<string, unknown> => ({
    ...db,
    tickSize: db.tickSize.toString(),
    stepSize: db.stepSize.toString(),
  });

  async upsertCandle(input: CandleInput): Promise<Record<string, unknown>> {
    return this.prisma.marketCandle.upsert({
      where: {
        provider_symbol_interval_openTime: {
          provider: input.provider as never,
          symbol: input.symbol,
          interval: this.mapInterval(input.interval) as never,
          openTime: input.openTime,
        },
      },
      update: {
        closeTime: input.closeTime,
        open: new Prisma.Decimal(input.open.toString()),
        high: new Prisma.Decimal(input.high.toString()),
        low: new Prisma.Decimal(input.low.toString()),
        close: new Prisma.Decimal(input.close.toString()),
        volume: new Prisma.Decimal(input.volume.toString()),
        quoteVolume: input.quoteVolume ? new Prisma.Decimal(input.quoteVolume.toString()) : undefined,
        tradeCount: input.tradeCount,
        isClosed: input.isClosed,
      },
      create: {
        provider: input.provider as never,
        symbol: input.symbol,
        interval: this.mapInterval(input.interval) as never,
        openTime: input.openTime,
        closeTime: input.closeTime,
        open: new Prisma.Decimal(input.open.toString()),
        high: new Prisma.Decimal(input.high.toString()),
        low: new Prisma.Decimal(input.low.toString()),
        close: new Prisma.Decimal(input.close.toString()),
        volume: new Prisma.Decimal(input.volume.toString()),
        quoteVolume: input.quoteVolume ? new Prisma.Decimal(input.quoteVolume.toString()) : undefined,
        tradeCount: input.tradeCount,
        isClosed: input.isClosed,
      },
    });
  }

  async upsertCandleBatch(candles: CandleInput[]): Promise<Record<string, unknown>[]> {
    return this.prisma.$transaction(
      candles.map((input) =>
        this.prisma.marketCandle.upsert({
          where: {
            provider_symbol_interval_openTime: {
              provider: input.provider as never,
              symbol: input.symbol,
              interval: this.mapInterval(input.interval) as never,
              openTime: input.openTime,
            },
          },
          update: {
            closeTime: input.closeTime,
            open: new Prisma.Decimal(input.open.toString()),
            high: new Prisma.Decimal(input.high.toString()),
            low: new Prisma.Decimal(input.low.toString()),
            close: new Prisma.Decimal(input.close.toString()),
            volume: new Prisma.Decimal(input.volume.toString()),
            quoteVolume: input.quoteVolume ? new Prisma.Decimal(input.quoteVolume.toString()) : undefined,
            tradeCount: input.tradeCount,
            isClosed: input.isClosed,
          },
          create: {
            provider: input.provider as never,
            symbol: input.symbol,
            interval: this.mapInterval(input.interval) as never,
            openTime: input.openTime,
            closeTime: input.closeTime,
            open: new Prisma.Decimal(input.open.toString()),
            high: new Prisma.Decimal(input.high.toString()),
            low: new Prisma.Decimal(input.low.toString()),
            close: new Prisma.Decimal(input.close.toString()),
            volume: new Prisma.Decimal(input.volume.toString()),
            quoteVolume: input.quoteVolume ? new Prisma.Decimal(input.quoteVolume.toString()) : undefined,
            tradeCount: input.tradeCount,
            isClosed: input.isClosed,
          },
        })
      )
    );
  }

  async getCandles(query: { provider: string; symbol: string; interval: string; startTime?: Date; endTime?: Date; limit?: number }): Promise<Record<string, unknown>[]> {
    const { provider, symbol, interval, startTime, endTime, limit } = query;
    return this.prisma.marketCandle.findMany({
      where: {
        provider: provider as never,
        symbol,
        interval: this.mapInterval(interval) as never,
        ...(startTime || endTime ? {
          openTime: {
            ...(startTime ? { gte: startTime } : {}),
            ...(endTime ? { lte: endTime } : {}),
          },
        } : {}),
      },
      orderBy: { openTime: 'asc' },
      take: limit,
    }).then(res => res.map(this.mapCandleFromDb));
  }

  async getClosedCandles(query: { provider: string; symbol: string; interval: string; beforeTime?: Date; limit: number }): Promise<Record<string, unknown>[]> {
    const { provider, symbol, interval, beforeTime, limit } = query;
    return this.prisma.marketCandle.findMany({
      where: {
        provider: provider as never,
        symbol,
        interval: this.mapInterval(interval) as never,
        isClosed: true,
        ...(beforeTime ? { openTime: { lt: beforeTime } } : {}),
      },
      orderBy: { openTime: 'desc' },
      take: limit,
    }).then(res => res.reverse().map(this.mapCandleFromDb));
  }

  async upsertFundingRate(input: FundingRateInput): Promise<Record<string, unknown>> {
    return this.prisma.fundingRateSnapshot.upsert({
      where: {
        provider_symbol_fundingTime: {
          provider: input.provider,
          symbol: input.symbol,
          fundingTime: input.fundingTime,
        },
      },
      update: {
        fundingRate: new Prisma.Decimal(input.fundingRate.toString()),
        nextFundingTime: input.nextFundingTime,
        markPrice: input.markPrice ? new Prisma.Decimal(input.markPrice.toString()) : undefined,
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        fundingTime: input.fundingTime,
        fundingRate: new Prisma.Decimal(input.fundingRate.toString()),
        nextFundingTime: input.nextFundingTime,
        markPrice: input.markPrice ? new Prisma.Decimal(input.markPrice.toString()) : undefined,
      },
    });
  }

  async getFundingRates(query: { provider: string; symbol: string; startTime?: Date; endTime?: Date; limit?: number }): Promise<Record<string, unknown>[]> {
    const { provider, symbol, startTime, endTime, limit } = query;
    return this.prisma.fundingRateSnapshot.findMany({
      where: {
        provider: provider as never,
        symbol,
        ...(startTime || endTime ? {
          fundingTime: {
            ...(startTime ? { gte: startTime } : {}),
            ...(endTime ? { lte: endTime } : {}),
          },
        } : {}),
      },
      orderBy: { fundingTime: 'desc' },
      take: limit || 100,
    }).then(res => res.map(this.mapFundingRateFromDb));
  }

  async upsertOpenInterest(input: OpenInterestInput): Promise<Record<string, unknown>> {
    return this.prisma.openInterestSnapshot.upsert({
      where: {
        provider_symbol_recordedAt: {
          provider: input.provider,
          symbol: input.symbol,
          recordedAt: input.recordedAt,
        },
      },
      update: {
        openInterest: new Prisma.Decimal(input.openInterest.toString()),
        openInterestValue: input.openInterestValue ? new Prisma.Decimal(input.openInterestValue.toString()) : undefined,
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        recordedAt: input.recordedAt,
        openInterest: new Prisma.Decimal(input.openInterest.toString()),
        openInterestValue: input.openInterestValue ? new Prisma.Decimal(input.openInterestValue.toString()) : undefined,
      },
    });
  }

  async getOpenInterestHistory(query: { provider: string; symbol: string; startTime?: Date; endTime?: Date; limit?: number }): Promise<Record<string, unknown>[]> {
    const { provider, symbol, startTime, endTime, limit } = query;
    return this.prisma.openInterestSnapshot.findMany({
      where: {
        provider: provider as never,
        symbol,
        ...(startTime || endTime ? {
          recordedAt: {
            ...(startTime ? { gte: startTime } : {}),
            ...(endTime ? { lte: endTime } : {}),
          },
        } : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: limit || 100,
    }).then(res => res.map(this.mapOpenInterestFromDb));
  }

  async upsertInstrument(input: InstrumentInput): Promise<Record<string, unknown>> {
    return this.prisma.marketInstrument.upsert({
      where: {
        provider_symbol: {
          provider: input.provider,
          symbol: input.symbol,
        },
      },
      update: {
        baseAsset: input.baseAsset,
        quoteAsset: input.quoteAsset,
        settlementAsset: input.settlementAsset,
        instrumentType: input.type,
        status: input.status,
        pricePrecision: input.pricePrecision,
        quantityPrecision: input.quantityPrecision,
        tickSize: new Prisma.Decimal(input.tickSize.toString()),
        stepSize: new Prisma.Decimal(input.stepSize.toString()),
        minQuantity: input.minQuantity ? new Prisma.Decimal(input.minQuantity.toString()) : undefined,
        maxQuantity: input.maxQuantity ? new Prisma.Decimal(input.maxQuantity.toString()) : undefined,
        minNotional: input.minNotional ? new Prisma.Decimal(input.minNotional.toString()) : undefined,
        contractSize: input.contractSize ? new Prisma.Decimal(input.contractSize.toString()) : undefined,
        lastSyncedAt: new Date(),
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        baseAsset: input.baseAsset,
        quoteAsset: input.quoteAsset,
        settlementAsset: input.settlementAsset,
        instrumentType: input.type,
        status: input.status,
        pricePrecision: input.pricePrecision,
        quantityPrecision: input.quantityPrecision,
        tickSize: new Prisma.Decimal(input.tickSize.toString()),
        stepSize: new Prisma.Decimal(input.stepSize.toString()),
        minQuantity: input.minQuantity ? new Prisma.Decimal(input.minQuantity.toString()) : undefined,
        maxQuantity: input.maxQuantity ? new Prisma.Decimal(input.maxQuantity.toString()) : undefined,
        minNotional: input.minNotional ? new Prisma.Decimal(input.minNotional.toString()) : undefined,
        contractSize: input.contractSize ? new Prisma.Decimal(input.contractSize.toString()) : undefined,
        lastSyncedAt: new Date(),
      },
    });
  }

  async getInstruments(query?: { provider?: string; status?: string }): Promise<Record<string, unknown>[]> {
    return this.prisma.marketInstrument.findMany({
      where: {
        ...(query?.provider ? { provider: query.provider as never } : {}),
        ...(query?.status ? { status: query.status } : {}),
      },
    }).then(res => res.map(this.mapInstrumentFromDb));
  }

  async createGap(input: GapInput): Promise<Record<string, unknown>> {
    return this.prisma.marketDataGap.upsert({
      where: {
        provider_symbol_interval_gapStart: {
          provider: input.provider as never,
          symbol: input.symbol,
          interval: this.mapInterval(input.interval) as never,
          gapStart: input.gapStart,
        },
      },
      update: {
        gapEnd: input.gapEnd,
        status: input.status as never,
      },
      create: {
        provider: input.provider as never,
        symbol: input.symbol,
        interval: this.mapInterval(input.interval) as never,
        gapStart: input.gapStart,
        gapEnd: input.gapEnd,
        status: input.status as never,
      },
    });
  }

  async updateGapStatus(id: string, status: string, error?: string): Promise<Record<string, unknown>> {
    return this.prisma.marketDataGap.update({
      where: { id },
      data: {
        status: status as never,
        lastError: error,
      },
    });
  }

  async getGaps(query?: { provider?: string; symbol?: string; status?: string; limit?: number }): Promise<Record<string, unknown>[]> {
    return this.prisma.marketDataGap.findMany({
      where: {
        ...(query?.provider ? { provider: query.provider as never } : {}),
        ...(query?.symbol ? { symbol: query.symbol } : {}),
        ...(query?.status ? { status: query.status as never } : {}),
      },
      orderBy: { gapStart: 'asc' },
      ...(query?.limit ? { take: query.limit } : {}),
    });
  }

  async createIncident(input: IncidentInput): Promise<Record<string, unknown>> {
    return this.prisma.marketStreamIncident.create({
      data: {
        provider: input.provider as never,
        symbol: input.symbol,
        code: input.code,
        message: input.message,
        metadata: input.metadata as never,
      },
    });
  }

  async upsertIndicatorSnapshot(input: IndicatorSnapshotInput): Promise<Record<string, unknown>> {
    return this.prisma.indicatorSnapshotRecord.upsert({
      where: {
        provider_symbol_interval_candleOpenTime_status: {
          provider: input.provider as never,
          symbol: input.symbol,
          interval: this.mapInterval(input.interval) as never,
          candleOpenTime: input.candleOpenTime,
          status: input.status,
        },
      } as never,
      update: {
        values: input.values as never,
        calculationVersion: input.calculationVersion,
      },
      create: {
        provider: input.provider as never,
        symbol: input.symbol,
        interval: this.mapInterval(input.interval) as never,
        candleOpenTime: input.candleOpenTime,
        candleCloseTime: input.candleCloseTime,
        status: input.status,
        values: input.values as never,
        calculationVersion: input.calculationVersion,
      },
    });
  }
}
