import { Injectable } from "@nestjs/common";
import { ExchangeInterval, type ExchangeProvider } from "../../../exchange/domain/exchange.types";
import { MarketDataService } from "../../../market-data/application/market-data.service";
import { MarketRedisCacheService } from "../../../market-data/infrastructure/redis/market-redis-cache.service";
import type { IndicatorSnapshot, NormalizedCandle, NormalizedTicker } from "../../../market-data/domain/market-data.types";
import { RedisService } from "../../../redis/redis.service";

const SCAN_INTERVAL_SECONDS = 55;
const EVENT_COOLDOWN_SECONDS = 180;
const FINGERPRINT_TTL_SECONDS = 15 * 60;
const PERSISTENCE_TTL_SECONDS = 10 * 60;

export interface MarketEventEvidence {
  direction: "BULLISH" | "BEARISH";
  price: number;
  atr: number;
  rsi?: number;
  ema20?: number;
  ema50?: number;
  priceChangePercent?: number;
  volumeChangePercent?: number;
  candleOpenTime: string;
  indicatorCloseTime: string;
  reasons: string[];
  confirmationCount: number;
}

export interface MarketEventScanResult {
  triggered: boolean;
  reason:
    | "EVENT_CONFIRMED"
    | "SCAN_THROTTLED"
    | "MARKET_DATA_UNAVAILABLE"
    | "NO_MATERIAL_EVENT"
    | "AWAITING_CONFIRMATION"
    | "DUPLICATE_FINGERPRINT"
    | "EVENT_COOLDOWN_ACTIVE";
  fingerprint?: string;
  evidence?: MarketEventEvidence;
}

type ScannerSnapshot = {
  ticker: NormalizedTicker | null;
  activeCandle: NormalizedCandle | null;
  indicator: IndicatorSnapshot | null;
  closedCandles: NormalizedCandle[];
};

@Injectable()
export class MarketEventScannerService {
  constructor(
    private readonly cache: MarketRedisCacheService,
    private readonly marketData: MarketDataService,
    private readonly redis: RedisService,
  ) {}

  async reserveAnchor(input: {
    userId: string;
    provider: ExchangeProvider;
    symbol: string;
    strategyIds: string[];
  }): Promise<{ run: boolean; fingerprint?: string }> {
    const indicator = await this.marketData.getIndicatorSnapshot(
      input.provider,
      input.symbol,
      ExchangeInterval.FIFTEEN_MINUTES,
    );
    // Let the pipeline's own freshness gate report unavailable data. The
    // scheduler only deduplicates snapshots it can identify confidently.
    if (!indicator) return { run: true };
    const strategyFingerprint = [...input.strategyIds].sort().join(",");
    const closeIso =
      indicator.candleCloseTime instanceof Date
        ? indicator.candleCloseTime.toISOString()
        : new Date(indicator.candleCloseTime).toISOString();
    const fingerprint = [
      input.provider,
      input.symbol,
      closeIso,
      strategyFingerprint,
    ].join("|");
    const key = `pipeline:anchor:last:${input.userId}:${input.provider}:${input.symbol}`;
    if (await this.redis.get(key) === fingerprint) return { run: false, fingerprint };
    await this.redis.setWithTtl(key, fingerprint, 60 * 60);
    return { run: true, fingerprint };
  }

  async scan(input: {
    userId: string;
    provider: ExchangeProvider;
    symbol: string;
    strategyIds: string[];
    now?: Date;
  }): Promise<MarketEventScanResult> {
    const now = input.now ?? new Date();
    const keyScope = `${input.userId}:${input.provider}:${input.symbol}`;
    const scanAcquired = await this.redis.setNx(
      `pipeline:event-scan:slot:${keyScope}`,
      now.toISOString(),
      SCAN_INTERVAL_SECONDS,
    );
    if (!scanAcquired) return { triggered: false, reason: "SCAN_THROTTLED" };

    const snapshot = await this.snapshot(input.provider, input.symbol);
    const evidence = this.evaluate(snapshot, now);
    if (!evidence) {
      return {
        triggered: false,
        reason: snapshot.indicator ? "NO_MATERIAL_EVENT" : "MARKET_DATA_UNAVAILABLE",
      };
    }

    const strategyFingerprint = [...input.strategyIds].sort().join(",");
    const fingerprint = [
      input.provider,
      input.symbol,
      evidence.candleOpenTime,
      evidence.direction,
      strategyFingerprint,
    ].join("|");
    const persistenceKey = `pipeline:event-scan:persistence:${keyScope}`;
    const previous = this.parsePersistence(await this.redis.get(persistenceKey));
    const confirmationCount = previous?.fingerprint === fingerprint
      ? Math.min(2, previous.count + 1)
      : 1;
    await this.redis.setWithTtl(
      persistenceKey,
      JSON.stringify({ fingerprint, count: confirmationCount }),
      PERSISTENCE_TTL_SECONDS,
    );
    const confirmedEvidence = { ...evidence, confirmationCount };
    if (confirmationCount < 2) {
      return {
        triggered: false,
        reason: "AWAITING_CONFIRMATION",
        fingerprint,
        evidence: confirmedEvidence,
      };
    }

    const fingerprintKey = `pipeline:event-scan:last:${keyScope}`;
    if (await this.redis.get(fingerprintKey) === fingerprint) {
      return {
        triggered: false,
        reason: "DUPLICATE_FINGERPRINT",
        fingerprint,
        evidence: confirmedEvidence,
      };
    }
    const cooldownAcquired = await this.redis.setNx(
      `pipeline:event-scan:cooldown:${keyScope}`,
      fingerprint,
      EVENT_COOLDOWN_SECONDS,
    );
    if (!cooldownAcquired) {
      return {
        triggered: false,
        reason: "EVENT_COOLDOWN_ACTIVE",
        fingerprint,
        evidence: confirmedEvidence,
      };
    }
    await this.redis.setWithTtl(fingerprintKey, fingerprint, FINGERPRINT_TTL_SECONDS);
    return {
      triggered: true,
      reason: "EVENT_CONFIRMED",
      fingerprint,
      evidence: confirmedEvidence,
    };
  }

  private async snapshot(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ScannerSnapshot> {
    const [ticker, activeCandle, indicator, closedCandles] = await Promise.all([
      this.cache.getTicker(provider, symbol),
      this.cache.getCandle(provider, symbol, ExchangeInterval.FIVE_MINUTES),
      this.marketData.getIndicatorSnapshot(provider, symbol, ExchangeInterval.FIVE_MINUTES),
      this.marketData.getHistoricalCandles({
        provider,
        symbol,
        interval: ExchangeInterval.FIVE_MINUTES,
        limit: 2,
      }),
    ]);
    return { ticker, activeCandle, indicator, closedCandles };
  }

  private evaluate(snapshot: ScannerSnapshot, now: Date): Omit<MarketEventEvidence, "confirmationCount"> | undefined {
    const { indicator } = snapshot;
    if (!indicator || now.getTime() - indicator.candleCloseTime.getTime() > 10 * 60_000)
      return undefined;
    const latestClosed = [...snapshot.closedCandles]
      .filter((candle) => candle.isClosed)
      .sort((a, b) => b.closeTime.getTime() - a.closeTime.getTime())[0];
    const tickerTime = snapshot.ticker?.timestamp instanceof Date
      ? snapshot.ticker.timestamp.getTime()
      : snapshot.ticker?.timestamp
        ? new Date(snapshot.ticker.timestamp).getTime()
        : NaN;
    const tickerFresh = Number.isFinite(tickerTime) && now.getTime() - tickerTime <= 90_000;
    const price = this.number(
      tickerFresh
        ? snapshot.ticker?.markPrice ?? snapshot.ticker?.lastPrice
        : snapshot.activeCandle?.close ?? latestClosed?.close,
    );
    const open = this.number(snapshot.activeCandle?.open ?? latestClosed?.open);
    const atr = this.number(indicator.values.atr14);
    if (!(price > 0) || !(open > 0) || !(atr > 0)) return undefined;

    const rsi = this.optionalNumber(indicator.values.rsi14);
    const ema20 = this.optionalNumber(indicator.values.ema20);
    const ema50 = this.optionalNumber(indicator.values.ema50);
    const rollingHigh = this.optionalNumber(indicator.values.rollingHigh);
    const rollingLow = this.optionalNumber(indicator.values.rollingLow);
    const priceChangePercent = this.optionalNumber(indicator.values.priceChangePercent);
    const volumeChangePercent = this.optionalNumber(indicator.values.volumeChangePercent);
    const histogram = this.optionalNumber(indicator.values.macd?.histogram);
    const move = price - open;
    const atrImpulse = Math.abs(move) >= atr * 0.6;
    const bullishBreakout = rollingHigh !== undefined && price > rollingHigh;
    const bearishBreakout = rollingLow !== undefined && price < rollingLow;
    const volumeExpansion = (volumeChangePercent ?? 0) >= 25;
    const bullishReasons: string[] = [];
    const bearishReasons: string[] = [];
    let bullishScore = 0;
    let bearishScore = 0;

    if (ema20 !== undefined && ema50 !== undefined && price > ema20 && ema20 > ema50) {
      bullishScore += 2;
      bullishReasons.push("BULLISH_EMA_ALIGNMENT");
    }
    if (ema20 !== undefined && ema50 !== undefined && price < ema20 && ema20 < ema50) {
      bearishScore += 2;
      bearishReasons.push("BEARISH_EMA_ALIGNMENT");
    }
    if (histogram !== undefined && histogram > 0) {
      bullishScore += 1;
      bullishReasons.push("POSITIVE_MACD_HISTOGRAM");
    }
    if (histogram !== undefined && histogram < 0) {
      bearishScore += 1;
      bearishReasons.push("NEGATIVE_MACD_HISTOGRAM");
    }
    if (rsi !== undefined && rsi >= 55 && rsi < 80) {
      bullishScore += 1;
      bullishReasons.push("BULLISH_RSI_MOMENTUM");
    }
    if (rsi !== undefined && rsi <= 45 && rsi > 20) {
      bearishScore += 1;
      bearishReasons.push("BEARISH_RSI_MOMENTUM");
    }
    if (bullishBreakout) {
      bullishScore += 2;
      bullishReasons.push("ROLLING_HIGH_BREAKOUT");
    }
    if (bearishBreakout) {
      bearishScore += 2;
      bearishReasons.push("ROLLING_LOW_BREAKDOWN");
    }
    if (atrImpulse && move > 0) {
      bullishScore += 2;
      bullishReasons.push("BULLISH_ATR_IMPULSE");
    }
    if (atrImpulse && move < 0) {
      bearishScore += 2;
      bearishReasons.push("BEARISH_ATR_IMPULSE");
    }
    if ((priceChangePercent ?? 0) >= 0.5 && volumeExpansion) {
      bullishScore += 2;
      bullishReasons.push("BULLISH_PRICE_VOLUME_EXPANSION");
    }
    if ((priceChangePercent ?? 0) <= -0.5 && volumeExpansion) {
      bearishScore += 2;
      bearishReasons.push("BEARISH_PRICE_VOLUME_EXPANSION");
    }

    const bullishMaterial = bullishBreakout || (atrImpulse && move > 0) ||
      ((priceChangePercent ?? 0) >= 0.5 && volumeExpansion);
    const bearishMaterial = bearishBreakout || (atrImpulse && move < 0) ||
      ((priceChangePercent ?? 0) <= -0.5 && volumeExpansion);
    const direction = bullishScore >= 4 && bullishScore >= bearishScore + 2 && bullishMaterial
      ? "BULLISH"
      : bearishScore >= 4 && bearishScore >= bullishScore + 2 && bearishMaterial
        ? "BEARISH"
        : undefined;
    if (!direction) return undefined;

    return {
      direction,
      price,
      atr,
      ...(rsi !== undefined ? { rsi } : {}),
      ...(ema20 !== undefined ? { ema20 } : {}),
      ...(ema50 !== undefined ? { ema50 } : {}),
      ...(priceChangePercent !== undefined ? { priceChangePercent } : {}),
      ...(volumeChangePercent !== undefined ? { volumeChangePercent } : {}),
      candleOpenTime: (snapshot.activeCandle?.openTime ?? indicator.candleOpenTime).toISOString(),
      indicatorCloseTime: indicator.candleCloseTime.toISOString(),
      reasons: direction === "BULLISH" ? bullishReasons : bearishReasons,
    };
  }

  private parsePersistence(value: string | null): { fingerprint: string; count: number } | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value) as { fingerprint?: unknown; count?: unknown };
      if (typeof parsed.fingerprint !== "string" || !Number.isFinite(Number(parsed.count)))
        return undefined;
      return { fingerprint: parsed.fingerprint, count: Number(parsed.count) };
    } catch {
      return undefined;
    }
  }

  private number(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private optionalNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
