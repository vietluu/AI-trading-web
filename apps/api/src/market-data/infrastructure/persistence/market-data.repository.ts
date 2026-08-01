import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '@prisma/client';
import type { ExchangeProvider } from '../../../exchange/domain/exchange.types';

@Injectable()
export class MarketDataRepository {
  private readonly logger = new Logger(MarketDataRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private mapInterval(interval: string): any {
    return `i${interval}` as any;
  }

  private mapCandleFromDb = (db: any) => ({
    ...db,
    interval: typeof db.interval === 'string' ? db.interval.replace(/^i/, '') : db.interval,
    open: db.open.toString(),
    high: db.high.toString(),
    low: db.low.toString(),
    close: db.close.toString(),
    volume: db.volume.toString(),
    quoteVolume: db.quoteVolume ? db.quoteVolume.toString() : undefined,
  });

  private mapFundingRateFromDb = (db: any) => ({
    ...db,
    fundingRate: db.fundingRate.toString(),
    markPrice: db.markPrice ? db.markPrice.toString() : undefined,
    indexPrice: db.indexPrice ? db.indexPrice.toString() : undefined,
  });

  private mapOpenInterestFromDb = (db: any) => ({
    ...db,
    openInterest: db.openInterest.toString(),
    openInterestValue: db.openInterestValue ? db.openInterestValue.toString() : undefined,
  });

  private mapInstrumentFromDb = (db: any) => ({
    ...db,
    tickSize: db.tickSize.toString(),
    stepSize: db.stepSize.toString(),
  });

  async upsertCandle(input: any): Promise<any> {
    return this.prisma.marketCandle.upsert({
      where: {
        provider_symbol_interval_openTime: {
          provider: input.provider as any,
          symbol: input.symbol,
          interval: this.mapInterval(input.interval),
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
        provider: input.provider as any,
        symbol: input.symbol,
        interval: this.mapInterval(input.interval),
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

  async upsertCandleBatch(candles: any[]): Promise<any[]> {
    return this.prisma.$transaction(
      candles.map((input) =>
        this.prisma.marketCandle.upsert({
          where: {
            provider_symbol_interval_openTime: {
              provider: input.provider as any,
              symbol: input.symbol,
              interval: this.mapInterval(input.interval),
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
            provider: input.provider as any,
            symbol: input.symbol,
            interval: this.mapInterval(input.interval),
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

  async getCandles(query: { provider: string; symbol: string; interval: string; startTime?: Date; endTime?: Date; limit?: number }): Promise<any[]> {
    const { provider, symbol, interval, startTime, endTime, limit } = query;
    return this.prisma.marketCandle.findMany({
      where: {
        provider: provider as any,
        symbol,
        interval: this.mapInterval(interval),
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

  async getClosedCandles(query: { provider: string; symbol: string; interval: string; beforeTime?: Date; limit: number }): Promise<any[]> {
    const { provider, symbol, interval, beforeTime, limit } = query;
    return this.prisma.marketCandle.findMany({
      where: {
        provider: provider as any,
        symbol,
        interval: this.mapInterval(interval),
        isClosed: true,
        ...(beforeTime ? { openTime: { lt: beforeTime } } : {}),
      },
      orderBy: { openTime: 'desc' },
      take: limit,
    }).then(res => res.reverse().map(this.mapCandleFromDb));
  }

  async upsertFundingRate(input: any): Promise<any> {
    return this.prisma.fundingRateSnapshot.upsert({
      where: {
        provider_symbol_fundingTime: {
          provider: input.provider as any,
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
        provider: input.provider as any,
        symbol: input.symbol,
        fundingTime: input.fundingTime,
        fundingRate: new Prisma.Decimal(input.fundingRate.toString()),
        nextFundingTime: input.nextFundingTime,
        markPrice: input.markPrice ? new Prisma.Decimal(input.markPrice.toString()) : undefined,
      },
    });
  }

  async getFundingRates(query: { provider: string; symbol: string; startTime?: Date; endTime?: Date; limit?: number }): Promise<any[]> {
    const { provider, symbol, startTime, endTime, limit } = query;
    return this.prisma.fundingRateSnapshot.findMany({
      where: {
        provider: provider as any,
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

  async upsertOpenInterest(input: any): Promise<any> {
    return this.prisma.openInterestSnapshot.upsert({
      where: {
        provider_symbol_recordedAt: {
          provider: input.provider as any,
          symbol: input.symbol,
          recordedAt: input.recordedAt,
        },
      },
      update: {
        openInterest: new Prisma.Decimal(input.openInterest.toString()),
        openInterestValue: input.openInterestValue ? new Prisma.Decimal(input.openInterestValue.toString()) : undefined,
      },
      create: {
        provider: input.provider as any,
        symbol: input.symbol,
        recordedAt: input.recordedAt,
        openInterest: new Prisma.Decimal(input.openInterest.toString()),
        openInterestValue: input.openInterestValue ? new Prisma.Decimal(input.openInterestValue.toString()) : undefined,
      },
    });
  }

  async getOpenInterestHistory(query: { provider: string; symbol: string; startTime?: Date; endTime?: Date; limit?: number }): Promise<any[]> {
    const { provider, symbol, startTime, endTime, limit } = query;
    return this.prisma.openInterestSnapshot.findMany({
      where: {
        provider: provider as any,
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

  async upsertInstrument(input: any): Promise<any> {
    return this.prisma.marketInstrument.upsert({
      where: {
        provider_symbol: {
          provider: input.provider as any,
          symbol: input.symbol,
        },
      },
      update: {
        baseAsset: input.baseAsset,
        quoteAsset: input.quoteAsset,
        settlementAsset: input.settlementAsset,
        instrumentType: input.type as any,
        status: input.status as any,
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
        provider: input.provider as any,
        symbol: input.symbol,
        baseAsset: input.baseAsset,
        quoteAsset: input.quoteAsset,
        settlementAsset: input.settlementAsset,
        instrumentType: input.type as any,
        status: input.status as any,
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

  async getInstruments(query?: { provider?: string; status?: string }): Promise<any[]> {
    return this.prisma.marketInstrument.findMany({
      where: {
        ...(query?.provider ? { provider: query.provider as any } : {}),
        ...(query?.status ? { status: query.status as any } : {}),
      },
    }).then(res => res.map(this.mapInstrumentFromDb));
  }

  async createGap(input: any): Promise<any> {
    return this.prisma.marketDataGap.upsert({
      where: {
        provider_symbol_interval_gapStart: {
          provider: input.provider as any,
          symbol: input.symbol,
          interval: this.mapInterval(input.interval),
          gapStart: input.gapStart,
        },
      },
      update: {
        gapEnd: input.gapEnd,
        status: input.status as any,
      },
      create: {
        provider: input.provider as any,
        symbol: input.symbol,
        interval: this.mapInterval(input.interval),
        gapStart: input.gapStart,
        gapEnd: input.gapEnd,
        status: input.status as any,
      },
    });
  }

  async updateGapStatus(id: string, status: string, error?: string): Promise<any> {
    return this.prisma.marketDataGap.update({
      where: { id },
      data: {
        status: status as any,
        lastError: error,
      },
    });
  }

  async getGaps(query?: { provider?: string; symbol?: string; status?: string; limit?: number }): Promise<any[]> {
    return this.prisma.marketDataGap.findMany({
      where: {
        ...(query?.provider ? { provider: query.provider as any } : {}),
        ...(query?.symbol ? { symbol: query.symbol } : {}),
        ...(query?.status ? { status: query.status as any } : {}),
      },
      orderBy: { gapStart: 'asc' },
      ...(query?.limit ? { take: query.limit } : {}),
    });
  }

  async createIncident(input: any): Promise<any> {
    return this.prisma.marketStreamIncident.create({
      data: {
        provider: input.provider as any,
        symbol: input.symbol,
        code: input.code as any,
        message: input.message,
        metadata: input.metadata,
      },
    });
  }

  async upsertIndicatorSnapshot(input: any): Promise<any> {
    return this.prisma.indicatorSnapshotRecord.upsert({
      where: {
        provider_symbol_interval_candleOpenTime_status: {
          provider: input.provider as any,
          symbol: input.symbol,
          interval: this.mapInterval(input.interval),
          candleOpenTime: input.candleOpenTime,
          status: input.status as any,
        },
      } as any,
      update: {
        values: input.values,
        calculationVersion: input.calculationVersion,
      },
      create: {
        provider: input.provider as any,
        symbol: input.symbol,
        interval: this.mapInterval(input.interval),
        candleOpenTime: input.candleOpenTime,
        candleCloseTime: input.candleCloseTime,
        status: input.status as any,
        values: input.values,
        calculationVersion: input.calculationVersion,
      },
    });
  }
}
