import { Injectable, Logger } from "@nestjs/common";
import {
  Prisma,
  type ExchangeProvider as DbExchangeProvider,
  type MarketDataInterval as DbMarketDataInterval,
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import {
  ExchangeInterval,
  ExchangeProvider,
  type ExchangeInstrumentStatus,
  type ExchangeInstrumentType,
} from "../../../exchange/domain/exchange.types";
import { IndicatorStatus, DataGapStatus } from "../../domain/market-data.enums";
import type {
  IndicatorSnapshot,
  NormalizedCandle,
  NormalizedFundingRate,
  NormalizedOpenInterest,
} from "../../domain/market-data.types";

type CandleRow = Awaited<
  ReturnType<PrismaService["marketCandle"]["findMany"]>
>[number];
type FundingRateRow = Awaited<
  ReturnType<PrismaService["fundingRateSnapshot"]["findMany"]>
>[number];
type OpenInterestRow = Awaited<
  ReturnType<PrismaService["openInterestSnapshot"]["findMany"]>
>[number];
type InstrumentRow = Awaited<
  ReturnType<PrismaService["marketInstrument"]["findMany"]>
>[number];
type GapRow = Awaited<ReturnType<PrismaService["marketDataGap"]["findMany"]>>[number];
type IncidentRow = Awaited<ReturnType<PrismaService["marketStreamIncident"]["create"]>>;
type SnapshotRow = Awaited<
  ReturnType<PrismaService["indicatorSnapshotRecord"]["upsert"]>
>;

type MarketInstrumentView = {
  provider: ExchangeProvider;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settlementAsset: string;
  instrumentType: ExchangeInstrumentType;
  status: ExchangeInstrumentStatus;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: string;
  stepSize: string;
  minQuantity?: string;
  maxQuantity?: string;
  minNotional?: string;
  contractSize?: string;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type MarketDataGapView = {
  id: string;
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  gapStart: Date;
  gapEnd: Date;
  status: DataGapStatus;
  retryCount: number;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MarketStreamIncidentView = {
  id: string;
  provider: ExchangeProvider;
  symbol?: string | null;
  code: string;
  message: string;
  metadata?: Prisma.JsonValue | null;
  resolvedAt?: Date | null;
  createdAt: Date;
};

type CreateGapInput = {
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  gapStart: Date;
  gapEnd: Date;
  status: DataGapStatus;
};

type CreateIncidentInput = {
  provider: ExchangeProvider;
  symbol?: string | null;
  code: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
};

function toDbInterval(interval: ExchangeInterval): DbMarketDataInterval {
  switch (interval) {
    case ExchangeInterval.ONE_MINUTE:
      return "i1m";
    case ExchangeInterval.THREE_MINUTES:
      return "i3m";
    case ExchangeInterval.FIVE_MINUTES:
      return "i5m";
    case ExchangeInterval.FIFTEEN_MINUTES:
      return "i15m";
    case ExchangeInterval.THIRTY_MINUTES:
      return "i30m";
    case ExchangeInterval.ONE_HOUR:
      return "i1h";
    case ExchangeInterval.TWO_HOURS:
      return "i2h";
    case ExchangeInterval.FOUR_HOURS:
      return "i4h";
    case ExchangeInterval.SIX_HOURS:
      return "i6h";
    case ExchangeInterval.EIGHT_HOURS:
      return "i8h";
    case ExchangeInterval.TWELVE_HOURS:
      return "i12h";
    case ExchangeInterval.ONE_DAY:
      return "i1d";
    case ExchangeInterval.ONE_WEEK:
      return "i1w";
    case ExchangeInterval.ONE_MONTH:
      return "i1M";
  }
}

function fromDbInterval(interval: DbMarketDataInterval): ExchangeInterval {
  switch (interval) {
    case "i1m":
      return ExchangeInterval.ONE_MINUTE;
    case "i3m":
      return ExchangeInterval.THREE_MINUTES;
    case "i5m":
      return ExchangeInterval.FIVE_MINUTES;
    case "i15m":
      return ExchangeInterval.FIFTEEN_MINUTES;
    case "i30m":
      return ExchangeInterval.THIRTY_MINUTES;
    case "i1h":
      return ExchangeInterval.ONE_HOUR;
    case "i2h":
      return ExchangeInterval.TWO_HOURS;
    case "i4h":
      return ExchangeInterval.FOUR_HOURS;
    case "i6h":
      return ExchangeInterval.SIX_HOURS;
    case "i8h":
      return ExchangeInterval.EIGHT_HOURS;
    case "i12h":
      return ExchangeInterval.TWELVE_HOURS;
    case "i1d":
      return ExchangeInterval.ONE_DAY;
    case "i1w":
      return ExchangeInterval.ONE_WEEK;
    case "i1M":
      return ExchangeInterval.ONE_MONTH;
  }
}

function toDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function toOptionalDecimal(value?: string): Prisma.Decimal | undefined {
  return value ? toDecimal(value) : undefined;
}

function toStringValue(value: Prisma.Decimal | number | string): string {
  return value.toString();
}

function toOptionalString(value: Prisma.Decimal | number | string | null): string | undefined {
  return value === null ? undefined : value.toString();
}

function toDomainProvider(value: DbExchangeProvider): ExchangeProvider {
  return value as ExchangeProvider;
}

function toInstrumentType(value: string): ExchangeInstrumentType {
  return value === "FUTURE" ? "FUTURE" : "PERPETUAL";
}

function toInstrumentStatus(value: string): ExchangeInstrumentStatus {
  switch (value) {
    case "TRADING":
    case "SUSPENDED":
    case "PRE_TRADING":
    case "UNKNOWN":
      return value;
    default:
      return "UNKNOWN";
  }
}

function toGapStatus(value: string): DataGapStatus {
  switch (value) {
    case "DETECTED":
      return DataGapStatus.DETECTED;
    case "REPAIRING":
      return DataGapStatus.REPAIRING;
    case "REPAIRED":
      return DataGapStatus.REPAIRED;
    case "FAILED":
      return DataGapStatus.FAILED;
    case "IGNORED":
      return DataGapStatus.IGNORED;
    default:
      return DataGapStatus.DETECTED;
  }
}

function toIndicatorStatus(value: string): IndicatorStatus {
  switch (value) {
    case "CLOSED":
      return IndicatorStatus.CLOSED;
    case "PROVISIONAL":
      return IndicatorStatus.PROVISIONAL;
    case "INSUFFICIENT_DATA":
      return IndicatorStatus.INSUFFICIENT_DATA;
    default:
      return IndicatorStatus.CLOSED;
  }
}

function mapCandleRow(row: CandleRow): NormalizedCandle {
  return {
    provider: toDomainProvider(row.provider),
    symbol: row.symbol,
    interval: fromDbInterval(row.interval),
    openTime: row.openTime,
    closeTime: row.closeTime,
    open: toStringValue(row.open),
    high: toStringValue(row.high),
    low: toStringValue(row.low),
    close: toStringValue(row.close),
    volume: toStringValue(row.volume),
    quoteVolume: toOptionalString(row.quoteVolume),
    tradeCount: row.tradeCount ?? undefined,
    isClosed: row.isClosed,
  };
}

function mapFundingRateRow(row: FundingRateRow): NormalizedFundingRate {
  return {
    provider: toDomainProvider(row.provider),
    symbol: row.symbol,
    fundingRate: toStringValue(row.fundingRate),
    fundingTime: row.fundingTime,
    nextFundingTime: row.nextFundingTime ?? undefined,
    markPrice: toOptionalString(row.markPrice),
  };
}

function mapOpenInterestRow(row: OpenInterestRow): NormalizedOpenInterest {
  return {
    provider: toDomainProvider(row.provider),
    symbol: row.symbol,
    openInterest: toStringValue(row.openInterest),
    openInterestValue: toOptionalString(row.openInterestValue),
    timestamp: row.recordedAt,
  };
}

function mapInstrumentRow(row: InstrumentRow): MarketInstrumentView {
  return {
    provider: toDomainProvider(row.provider),
    symbol: row.symbol,
    baseAsset: row.baseAsset,
    quoteAsset: row.quoteAsset,
    settlementAsset: row.settlementAsset,
    instrumentType: toInstrumentType(row.instrumentType),
    status: toInstrumentStatus(row.status),
    pricePrecision: row.pricePrecision,
    quantityPrecision: row.quantityPrecision,
    tickSize: toStringValue(row.tickSize),
    stepSize: toStringValue(row.stepSize),
    minQuantity: toOptionalString(row.minQuantity),
    maxQuantity: toOptionalString(row.maxQuantity),
    minNotional: toOptionalString(row.minNotional),
    contractSize: toOptionalString(row.contractSize),
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapGapRow(row: GapRow): MarketDataGapView {
  return {
    id: row.id,
    provider: toDomainProvider(row.provider),
    symbol: row.symbol,
    interval: fromDbInterval(row.interval),
    gapStart: row.gapStart,
    gapEnd: row.gapEnd,
    status: toGapStatus(row.status),
    retryCount: row.retryCount,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapIncidentRow(row: IncidentRow): MarketStreamIncidentView {
  return {
    id: row.id,
    provider: toDomainProvider(row.provider),
    symbol: row.symbol,
    code: row.code,
    message: row.message,
    metadata: row.metadata,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

function mapSnapshotRow(row: SnapshotRow): IndicatorSnapshot {
  return {
    provider: toDomainProvider(row.provider),
    symbol: row.symbol,
    interval: fromDbInterval(row.interval),
    candleOpenTime: row.candleOpenTime,
    candleCloseTime: row.candleCloseTime,
    status: toIndicatorStatus(row.status),
    values: row.values as IndicatorSnapshot["values"],
    calculatedAt: row.createdAt,
    calculationVersion: row.calculationVersion,
  };
}

@Injectable()
export class MarketDataRepository {
  private readonly logger = new Logger(MarketDataRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertCandle(input: NormalizedCandle): Promise<NormalizedCandle> {
    const row = await this.prisma.marketCandle.upsert({
      where: {
        provider_symbol_interval_openTime: {
          provider: input.provider,
          symbol: input.symbol,
          interval: toDbInterval(input.interval),
          openTime: input.openTime,
        },
      },
      update: {
        closeTime: input.closeTime,
        open: toDecimal(input.open),
        high: toDecimal(input.high),
        low: toDecimal(input.low),
        close: toDecimal(input.close),
        volume: toDecimal(input.volume),
        quoteVolume: toOptionalDecimal(input.quoteVolume),
        tradeCount: input.tradeCount,
        isClosed: input.isClosed,
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        interval: toDbInterval(input.interval),
        openTime: input.openTime,
        closeTime: input.closeTime,
        open: toDecimal(input.open),
        high: toDecimal(input.high),
        low: toDecimal(input.low),
        close: toDecimal(input.close),
        volume: toDecimal(input.volume),
        quoteVolume: toOptionalDecimal(input.quoteVolume),
        tradeCount: input.tradeCount,
        isClosed: input.isClosed,
      },
    });

    return mapCandleRow(row);
  }

  async upsertCandleBatch(
    candles: NormalizedCandle[],
  ): Promise<NormalizedCandle[]> {
    const chunkSize = 250;
    const persisted: NormalizedCandle[] = [];
    for (let index = 0; index < candles.length; index += chunkSize) {
      const chunk = candles.slice(index, index + chunkSize);
      if (chunk.length === 0) continue;
      try {
        const values = chunk.map((input) => Prisma.sql`(
          gen_random_uuid(),
          ${input.provider}::"ExchangeProvider",
          ${input.symbol},
          ${input.interval}::"MarketDataInterval",
          ${input.openTime}, ${input.closeTime},
          ${input.open}::numeric, ${input.high}::numeric, ${input.low}::numeric,
          ${input.close}::numeric, ${input.volume}::numeric,
          ${input.quoteVolume ?? null}::numeric, ${input.tradeCount ?? null}::integer,
          ${input.isClosed}, NOW(), NOW()
        )`);
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO "market_candles"
            ("id", "provider", "symbol", "interval", "openTime", "closeTime", "open", "high", "low", "close", "volume", "quoteVolume", "tradeCount", "isClosed", "createdAt", "updatedAt")
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("provider", "symbol", "interval", "openTime") DO UPDATE SET
            "closeTime" = EXCLUDED."closeTime", "open" = EXCLUDED."open",
            "high" = EXCLUDED."high", "low" = EXCLUDED."low", "close" = EXCLUDED."close",
            "volume" = EXCLUDED."volume", "quoteVolume" = EXCLUDED."quoteVolume",
            "tradeCount" = EXCLUDED."tradeCount", "isClosed" = EXCLUDED."isClosed",
            "updatedAt" = NOW()
        `);
        persisted.push(...chunk);
      } catch (error) {
        this.logger.error({
          event: "market_candle_batch_upsert_failed",
          batchSize: chunk.length,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return persisted;
  }

  async getCandles(query: {
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<NormalizedCandle[]> {
    const boundedRange = Boolean(query.startTime || query.endTime);
    const rows = await this.prisma.marketCandle.findMany({
      where: {
        provider: query.provider,
        symbol: query.symbol,
        interval: toDbInterval(query.interval),
        ...(query.startTime || query.endTime
          ? {
              openTime: {
                ...(query.startTime ? { gte: query.startTime } : {}),
                ...(query.endTime ? { lte: query.endTime } : {}),
              },
            }
          : {}),
      },
      // Without an explicit range callers are asking for the latest N candles.
      // Querying ASC + take returned the oldest rows and could feed a stale
      // reference price into the trading pipeline.
      orderBy: { openTime: boundedRange ? "asc" : "desc" },
      take: query.limit,
    });

    const chronologicalRows = boundedRange ? rows : rows.reverse();
    return chronologicalRows.map(mapCandleRow);
  }

  async getClosedCandles(query: {
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    beforeTime?: Date;
    limit: number;
  }): Promise<NormalizedCandle[]> {
    const rows = await this.prisma.marketCandle.findMany({
      where: {
        provider: query.provider,
        symbol: query.symbol,
        interval: toDbInterval(query.interval),
        isClosed: true,
        ...(query.beforeTime ? { openTime: { lt: query.beforeTime } } : {}),
      },
      orderBy: { openTime: "desc" },
      take: query.limit,
    });

    return rows.reverse().map(mapCandleRow);
  }

  async upsertFundingRate(
    input: NormalizedFundingRate,
  ): Promise<NormalizedFundingRate> {
    const row = await this.prisma.fundingRateSnapshot.upsert({
      where: {
        provider_symbol_fundingTime: {
          provider: input.provider,
          symbol: input.symbol,
          fundingTime: input.fundingTime,
        },
      },
      update: {
        fundingRate: toDecimal(input.fundingRate),
        nextFundingTime: input.nextFundingTime,
        markPrice: toOptionalDecimal(input.markPrice),
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        fundingTime: input.fundingTime,
        fundingRate: toDecimal(input.fundingRate),
        nextFundingTime: input.nextFundingTime,
        markPrice: toOptionalDecimal(input.markPrice),
      },
    });

    return mapFundingRateRow(row);
  }

  async getFundingRates(query: {
    provider: ExchangeProvider;
    symbol: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<NormalizedFundingRate[]> {
    const rows = await this.prisma.fundingRateSnapshot.findMany({
      where: {
        provider: query.provider,
        symbol: query.symbol,
        ...(query.startTime || query.endTime
          ? {
              fundingTime: {
                ...(query.startTime ? { gte: query.startTime } : {}),
                ...(query.endTime ? { lte: query.endTime } : {}),
              },
            }
          : {}),
      },
      orderBy: { fundingTime: "desc" },
      take: query.limit ?? 100,
    });

    return rows.map(mapFundingRateRow);
  }

  async upsertOpenInterest(
    input: NormalizedOpenInterest,
  ): Promise<NormalizedOpenInterest> {
    const row = await this.prisma.openInterestSnapshot.upsert({
      where: {
        provider_symbol_recordedAt: {
          provider: input.provider,
          symbol: input.symbol,
          recordedAt: input.timestamp,
        },
      },
      update: {
        openInterest: toDecimal(input.openInterest),
        openInterestValue: toOptionalDecimal(input.openInterestValue),
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        recordedAt: input.timestamp,
        openInterest: toDecimal(input.openInterest),
        openInterestValue: toOptionalDecimal(input.openInterestValue),
      },
    });

    return mapOpenInterestRow(row);
  }

  async getOpenInterestHistory(query: {
    provider: ExchangeProvider;
    symbol: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<NormalizedOpenInterest[]> {
    const rows = await this.prisma.openInterestSnapshot.findMany({
      where: {
        provider: query.provider,
        symbol: query.symbol,
        ...(query.startTime || query.endTime
          ? {
              recordedAt: {
                ...(query.startTime ? { gte: query.startTime } : {}),
                ...(query.endTime ? { lte: query.endTime } : {}),
              },
            }
          : {}),
      },
      orderBy: { recordedAt: "desc" },
      take: query.limit ?? 100,
    });

    return rows.map(mapOpenInterestRow);
  }

  async upsertInstrument(
    input: {
      provider: ExchangeProvider;
      symbol: string;
      baseAsset: string;
      quoteAsset: string;
      settlementAsset: string;
      type: ExchangeInstrumentType;
      status: ExchangeInstrumentStatus;
      pricePrecision: number;
      quantityPrecision: number;
      tickSize: string;
      stepSize: string;
      minQuantity?: string;
      maxQuantity?: string;
      minNotional?: string;
      contractSize?: string;
    },
  ): Promise<MarketInstrumentView> {
    const row = await this.prisma.marketInstrument.upsert({
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
        tickSize: toDecimal(input.tickSize),
        stepSize: toDecimal(input.stepSize),
        minQuantity: toOptionalDecimal(input.minQuantity),
        maxQuantity: toOptionalDecimal(input.maxQuantity),
        minNotional: toOptionalDecimal(input.minNotional),
        contractSize: toOptionalDecimal(input.contractSize),
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
        tickSize: toDecimal(input.tickSize),
        stepSize: toDecimal(input.stepSize),
        minQuantity: toOptionalDecimal(input.minQuantity),
        maxQuantity: toOptionalDecimal(input.maxQuantity),
        minNotional: toOptionalDecimal(input.minNotional),
        contractSize: toOptionalDecimal(input.contractSize),
        lastSyncedAt: new Date(),
      },
    });

    return mapInstrumentRow(row);
  }

  async getInstruments(query?: {
    provider?: ExchangeProvider;
    status?: string;
  }): Promise<MarketInstrumentView[]> {
    const rows = await this.prisma.marketInstrument.findMany({
      where: {
        ...(query?.provider ? { provider: query.provider } : {}),
        ...(query?.status ? { status: query.status } : {}),
      },
    });

    return rows.map(mapInstrumentRow);
  }

  async createGap(input: CreateGapInput): Promise<MarketDataGapView> {
    const row = await this.prisma.marketDataGap.upsert({
      where: {
        provider_symbol_interval_gapStart: {
          provider: input.provider,
          symbol: input.symbol,
          interval: toDbInterval(input.interval),
          gapStart: input.gapStart,
        },
      },
      update: {
        gapEnd: input.gapEnd,
        status: input.status,
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        interval: toDbInterval(input.interval),
        gapStart: input.gapStart,
        gapEnd: input.gapEnd,
        status: input.status,
      },
    });

    return mapGapRow(row);
  }

  async updateGapStatus(
    id: string,
    status: DataGapStatus,
    error?: string,
  ): Promise<MarketDataGapView> {
    const row = await this.prisma.marketDataGap.update({
      where: { id },
      data: {
        status,
        lastError: error,
      },
    });

    return mapGapRow(row);
  }

  async getGaps(query?: {
    provider?: ExchangeProvider;
    symbol?: string;
    status?: DataGapStatus;
    limit?: number;
  }): Promise<MarketDataGapView[]> {
    const rows = await this.prisma.marketDataGap.findMany({
      where: {
        ...(query?.provider ? { provider: query.provider } : {}),
        ...(query?.symbol ? { symbol: query.symbol } : {}),
        ...(query?.status ? { status: query.status } : {}),
      },
      orderBy: { gapStart: "asc" },
      ...(query?.limit ? { take: query.limit } : {}),
    });

    return rows.map(mapGapRow);
  }

  async createIncident(input: CreateIncidentInput): Promise<MarketStreamIncidentView> {
    const row = await this.prisma.marketStreamIncident.create({
      data: {
        provider: input.provider,
        symbol: input.symbol,
        code: input.code,
        message: input.message,
        metadata: input.metadata,
      },
    });

    return mapIncidentRow(row);
  }

  async upsertIndicatorSnapshot(input: IndicatorSnapshot): Promise<IndicatorSnapshot> {
    const row = await this.prisma.indicatorSnapshotRecord.upsert({
      where: {
        provider_symbol_interval_candleOpenTime_status: {
          provider: input.provider,
          symbol: input.symbol,
          interval: toDbInterval(input.interval),
          candleOpenTime: input.candleOpenTime,
          status: input.status,
        },
      },
      update: {
        values: input.values,
        calculationVersion: input.calculationVersion,
      },
      create: {
        provider: input.provider,
        symbol: input.symbol,
        interval: toDbInterval(input.interval),
        candleOpenTime: input.candleOpenTime,
        candleCloseTime: input.candleCloseTime,
        status: input.status,
        values: input.values,
        calculationVersion: input.calculationVersion,
      },
    });

    return mapSnapshotRow(row);
  }
}
