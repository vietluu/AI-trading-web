import { Injectable, NotFoundException } from "@nestjs/common";

import {
  ExchangeEnvironment,
  ExchangeProvider,
  type ExchangeFundingRate,
  type ExchangeInstrument,
  type ExchangeKline,
  type ExchangeOpenInterest,
  type ExchangeOrderBook,
  type ExchangeServerTime,
  type ExchangeTicker,
  type ExchangeTrade,
  type KlineQuery,
} from "../domain/exchange.types";
import { ExchangeCacheService } from "../infrastructure/exchange-cache.service";
import { ExchangeRateLimitService } from "../infrastructure/exchange-rate-limit.service";
import { normalizeSymbol } from "../infrastructure/exchange-symbol";
import { ExchangeAdapterFactory } from "./exchange-adapter.factory";
import { ExchangeRealtimeService } from "./exchange-realtime.service";

export interface ExchangeProviderMetadata {
  provider: ExchangeProvider;
  displayName: string;
  environments: ExchangeEnvironment[];
  requiredCredentialFields: string[];
  publicCapabilities: string[];
  privateCapabilities: string[];
}

@Injectable()
export class PublicExchangeService {
  constructor(
    private readonly factory: ExchangeAdapterFactory,
    private readonly rateLimit: ExchangeRateLimitService,
    private readonly cache: ExchangeCacheService,
    private readonly realtime: ExchangeRealtimeService,
  ) {}

  providers(): ExchangeProviderMetadata[] {
    const publicCapabilities = [
      "TIME",
      "INSTRUMENTS",
      "TICKER",
      "ORDER_BOOK",
      "TRADES",
      "KLINES",
      "FUNDING_RATE",
      "OPEN_INTEREST",
    ];
    const privateCapabilities = [
      "ACCOUNT",
      "BALANCES",
      "POSITIONS",
      "OPEN_ORDERS",
      "ORDER_LOOKUP",
      "CONFIGURATION",
    ];
    return [
      {
        provider: ExchangeProvider.BINANCE_FUTURES,
        displayName: "Binance USD-M Futures",
        environments: [
          ExchangeEnvironment.TESTNET,
          ExchangeEnvironment.PRODUCTION,
        ],
        requiredCredentialFields: ["apiKey", "apiSecret"],
        publicCapabilities,
        privateCapabilities,
      },
      {
        provider: ExchangeProvider.OKX_FUTURES,
        displayName: "OKX Perpetual Swaps",
        environments: [
          ExchangeEnvironment.DEMO,
          ExchangeEnvironment.PRODUCTION,
        ],
        requiredCredentialFields: ["apiKey", "apiSecret", "passphrase"],
        publicCapabilities,
        privateCapabilities,
      },
    ];
  }

  async time(provider: ExchangeProvider): Promise<ExchangeServerTime> {
    await this.limit(provider);
    return this.factory
      .get(provider)
      .getServerTime(ExchangeEnvironment.PRODUCTION);
  }

  async instruments(
    provider: ExchangeProvider,
    status?: string,
  ): Promise<ExchangeInstrument[]> {
    const instruments = await this.cache.remember(
      this.cache.instrumentsKey(provider),
      this.cache.instrumentTtl,
      async () => {
        await this.limit(provider);
        return this.factory.get(provider).getInstruments();
      },
    );
    return status
      ? instruments.filter((instrument) => instrument.status === status)
      : instruments;
  }

  async instrument(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ExchangeInstrument> {
    const normalized = normalizeSymbol(symbol);
    const instrument = (await this.instruments(provider)).find(
      (candidate) => candidate.symbol === normalized,
    );
    if (!instrument)
      throw new NotFoundException("Exchange instrument not found");
    return instrument;
  }

  async ticker(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ExchangeTicker> {
    const normalized = normalizeSymbol(symbol);
    const realtimeTicker = await this.realtime.getTicker(provider, normalized);
    if (realtimeTicker) {
      return realtimeTicker;
    }
    return this.cache.remember(
      this.cache.tickerKey(provider, normalized),
      this.cache.tickerTtl,
      async () => {
        await this.limit(provider);
        return this.factory
          .get(provider)
          .getTicker(normalized)
          .catch(async (caught: unknown) => {
            if (
              provider === ExchangeProvider.BINANCE_FUTURES &&
              this.isGeoBlockedError(caught)
            ) {
              await this.limit(ExchangeProvider.OKX_FUTURES);
              return this.factory
                .get(ExchangeProvider.OKX_FUTURES)
                .getTicker(normalized);
            }
            throw caught;
          });
      },
    );
  }

  async orderBook(
    provider: ExchangeProvider,
    symbol: string,
    depth?: number,
  ): Promise<ExchangeOrderBook> {
    const normalized = normalizeSymbol(symbol);
    const realtimeOrderBook = await this.realtime.getOrderBook(
      provider,
      normalized,
      depth ?? 5,
    );
    if (realtimeOrderBook) {
      return realtimeOrderBook;
    }
    await this.limit(provider);
    return this.factory
      .get(provider)
      .getOrderBook(normalized, depth)
      .catch(async (caught: unknown) => {
        if (
          provider === ExchangeProvider.BINANCE_FUTURES &&
          this.isGeoBlockedError(caught)
        ) {
          await this.limit(ExchangeProvider.OKX_FUTURES);
          return this.factory
            .get(ExchangeProvider.OKX_FUTURES)
            .getOrderBook(normalized, depth);
        }
        throw caught;
      });
  }

  async trades(
    provider: ExchangeProvider,
    symbol: string,
    limit?: number,
  ): Promise<ExchangeTrade[]> {
    const normalized = normalizeSymbol(symbol);
    const realtimeTrades = await this.realtime.getTrades(provider, normalized);
    if (realtimeTrades) {
      return limit ? realtimeTrades.slice(0, limit) : realtimeTrades;
    }
    await this.limit(provider);
    return this.factory
      .get(provider)
      .getRecentTrades(normalized, limit)
      .catch(async (caught: unknown) => {
        if (
          provider === ExchangeProvider.BINANCE_FUTURES &&
          this.isGeoBlockedError(caught)
        ) {
          await this.limit(ExchangeProvider.OKX_FUTURES);
          return this.factory
            .get(ExchangeProvider.OKX_FUTURES)
            .getRecentTrades(normalized, limit);
        }
        throw caught;
      });
  }

  async klines(
    provider: ExchangeProvider,
    query: KlineQuery,
  ): Promise<ExchangeKline[]> {
    await this.limit(provider);
    const normalized = normalizeSymbol(query.symbol);
    return this.factory
      .get(provider)
      .getKlines({ ...query, symbol: normalized })
      .catch(async (caught: unknown) => {
        if (
          provider === ExchangeProvider.BINANCE_FUTURES &&
          this.isGeoBlockedError(caught)
        ) {
          await this.limit(ExchangeProvider.OKX_FUTURES);
          return this.factory
            .get(ExchangeProvider.OKX_FUTURES)
            .getKlines({ ...query, symbol: normalized });
        }
        throw caught;
      });
  }

  async funding(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ExchangeFundingRate> {
    const normalized = normalizeSymbol(symbol);
    return this.cache.remember(
      this.cache.fundingKey(provider, normalized),
      this.cache.tickerTtl,
      async () => {
        await this.limit(provider);
        return this.factory
          .get(provider)
          .getFundingRate(normalized)
          .catch(async (caught: unknown) => {
            if (
              provider === ExchangeProvider.BINANCE_FUTURES &&
              this.isGeoBlockedError(caught)
            ) {
              await this.limit(ExchangeProvider.OKX_FUTURES);
              return this.factory
                .get(ExchangeProvider.OKX_FUTURES)
                .getFundingRate(normalized);
            }
            throw caught;
          });
      },
    );
  }

  async openInterest(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ExchangeOpenInterest> {
    const normalized = normalizeSymbol(symbol);
    return this.cache.remember(
      this.cache.openInterestKey(provider, normalized),
      this.cache.tickerTtl,
      async () => {
        await this.limit(provider);
        return this.factory
          .get(provider)
          .getOpenInterest(normalized)
          .catch(async (caught: unknown) => {
            if (
              provider === ExchangeProvider.BINANCE_FUTURES &&
              this.isGeoBlockedError(caught)
            ) {
              await this.limit(ExchangeProvider.OKX_FUTURES);
              return this.factory
                .get(ExchangeProvider.OKX_FUTURES)
                .getOpenInterest(normalized);
            }
            throw caught;
          });
      },
    );
  }

  private isGeoBlockedError(caught: unknown): boolean {
    if (!caught || typeof caught !== "object") return false;
    const statusCode = "statusCode" in caught ? caught.statusCode : undefined;
    const message = "message" in caught ? String(caught.message) : "";
    return (
      statusCode === 451 ||
      statusCode === 403 ||
      message.includes("451") ||
      message.includes("Unavailable For Legal Reasons")
    );
  }

  private limit(provider: ExchangeProvider): Promise<void> {
    return this.rateLimit.public(provider, ExchangeEnvironment.PRODUCTION);
  }

  /**
   * Discovers all active trading pairs across Binance Futures & OKX Perpetual Swaps.
   * Identifies symbols available on Binance, OKX, or common to both.
   */
  async crossExchangeSymbols(): Promise<
    Array<{
      symbol: string;
      baseAsset: string;
      quoteAsset: string;
      binanceSupported: boolean;
      okxSupported: boolean;
      isCommon: boolean;
    }>
  > {
    const [binanceInsts, okxInsts] = await Promise.allSettled([
      this.instruments(ExchangeProvider.BINANCE_FUTURES, "TRADING"),
      this.instruments(ExchangeProvider.OKX_FUTURES, "TRADING"),
    ]);

    const binanceMap = new Set(
      binanceInsts.status === "fulfilled"
        ? binanceInsts.value.map((i) => i.symbol)
        : [],
    );
    const okxMap = new Set(
      okxInsts.status === "fulfilled" ? okxInsts.value.map((i) => i.symbol) : [],
    );

    const allSymbols = new Set([...binanceMap, ...okxMap]);
    const results = [];

    for (const symbol of allSymbols) {
      const [baseAsset, quoteAsset] = symbol.split("-");
      const binanceSupported = binanceMap.has(symbol);
      const okxSupported = okxMap.has(symbol);
      results.push({
        symbol,
        baseAsset: baseAsset ?? symbol,
        quoteAsset: quoteAsset ?? "USDT",
        binanceSupported,
        okxSupported,
        isCommon: binanceSupported && okxSupported,
      });
    }

    return results.sort((a, b) => {
      // Prioritize common symbols first, then alphabetical
      if (a.isCommon !== b.isCommon) return a.isCommon ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });
  }

  /**
   * Scans active market instruments and ranks the top N symbols offering the
   * highest trading opportunity EV (volatility, 24h volume, momentum).
   * Helps users optimize pipeline runs instead of blindly running on 300+ symbols.
   */
  async recommendTopSymbols(options?: {
    provider?: ExchangeProvider;
    limit?: number;
    commonOnly?: boolean;
    symbols?: string[];
  }): Promise<
    Array<{
      symbol: string;
      provider: ExchangeProvider;
      opportunityScore: number;
      price: number;
      volume24h: number;
      change24hPct: number;
      reasons: string[];
      isCommon: boolean;
    }>
  > {
    let activeProvider = options?.provider ?? ExchangeProvider.BINANCE_FUTURES;
    const limit = options?.limit ?? 10;

    const [crossSymbols, initialInstruments] = await Promise.all([
      this.crossExchangeSymbols(),
      this.instruments(activeProvider, "TRADING").catch(() => []),
    ]);
    let instruments = initialInstruments;

    // Automatic fallback to OKX_FUTURES if requested provider (e.g. BINANCE_FUTURES) is unavailable
    if (!instruments || instruments.length === 0) {
      const fallbackProvider = ExchangeProvider.OKX_FUTURES;
      const fallbackInstruments = await this.instruments(
        fallbackProvider,
        "TRADING",
      ).catch(() => []);
      if (fallbackInstruments.length > 0) {
        activeProvider = fallbackProvider;
        instruments = fallbackInstruments;
      }
    }

    const commonSet = new Set(
      crossSymbols.filter((s) => s.isCommon).map((s) => s.symbol),
    );

    let candidates = instruments;
    if (options?.symbols) {
      const selectedSymbols = new Set(options.symbols.map((symbol) => symbol.trim().toUpperCase()));
      candidates = candidates.filter((instrument) => selectedSymbols.has(instrument.symbol));
    }
    if (options?.commonOnly && commonSet.size > 0) {
      candidates = candidates.filter((inst) => commonSet.has(inst.symbol));
    }

    // Evaluate tickers in parallel batches for candidates
    const tickerCandidates = candidates.slice(0, 50);
    const tickers: PromiseSettledResult<{
      symbol: string;
      ticker: ExchangeTicker;
    } | null>[] = [];
    const batchSize = 5;
    for (let offset = 0; offset < tickerCandidates.length; offset += batchSize) {
      const batch = tickerCandidates.slice(offset, offset + batchSize);
      tickers.push(
        ...(await Promise.allSettled(
          batch.map(async (inst) => {
            try {
              const ticker = await this.ticker(activeProvider, inst.symbol);
              return { symbol: inst.symbol, ticker };
            } catch {
              return null;
            }
          }),
        )),
      );
    }

    const scored: Array<{
      symbol: string;
      provider: ExchangeProvider;
      opportunityScore: number;
      price: number;
      volume24h: number;
      change24hPct: number;
      reasons: string[];
      isCommon: boolean;
    }> = [];

    for (const item of tickers) {
      if (item.status !== "fulfilled" || !item.value) continue;
      const { symbol, ticker } = item.value;
      const price = Number(ticker.lastPrice ?? ticker.markPrice ?? 0);
      const volume24h = Number(ticker.quoteVolume24h ?? ticker.volume24h ?? 0);
      const change24hPct = Number(ticker.priceChangePercent24h ?? 0);

      if (price <= 0) continue;

      const reasons: string[] = [];
      let score = 50; // Base score

      // High volume booster (Liquidity)
      if (volume24h > 500_000_000) {
        score += 20;
        reasons.push("Ultra-high liquidity ($500M+ 24h vol)");
      } else if (volume24h > 100_000_000) {
        score += 10;
        reasons.push("Strong liquidity ($100M+ 24h vol)");
      }

      // Strong momentum / volatility booster (Profit opportunities)
      const absChange = Math.abs(change24hPct);
      if (absChange >= 5 && absChange <= 20) {
        score += 25;
        reasons.push(
          `High trading momentum (${change24hPct > 0 ? "+" : ""}${change24hPct.toFixed(1)}% 24h)`,
        );
      } else if (absChange > 20) {
        score += 10; // Extreme volatility has higher risk
        reasons.push(
          `Extreme price expansion (${change24hPct.toFixed(1)}% 24h)`,
        );
      }

      // Cross-exchange compatibility bonus
      const isCommon = commonSet.has(symbol);
      if (isCommon) {
        score += 10;
        reasons.push("Supported on both Binance & OKX");
      }

      scored.push({
        symbol,
        provider: activeProvider,
        opportunityScore: Math.min(100, Math.round(score)),
        price,
        volume24h,
        change24hPct,
        reasons,
        isCommon,
      });
    }

    return scored
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, limit);
  }
}

