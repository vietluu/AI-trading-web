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
    await this.limit(provider);
    const instruments = await this.cache.remember(
      this.cache.instrumentsKey(provider),
      this.cache.instrumentTtl,
      () => this.factory.get(provider).getInstruments(),
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
    await this.limit(provider);
    return this.cache.remember(
      this.cache.tickerKey(provider, normalized),
      this.cache.tickerTtl,
      () =>
        this.factory
          .get(provider)
          .getTicker(normalized)
          .catch((caught: unknown) => {
            if (
              provider === ExchangeProvider.BINANCE_FUTURES &&
              this.isGeoBlockedError(caught)
            ) {
              return this.factory
                .get(ExchangeProvider.OKX_FUTURES)
                .getTicker(normalized);
            }
            throw caught;
          }),
    );
  }

  async orderBook(
    provider: ExchangeProvider,
    symbol: string,
    depth?: number,
  ): Promise<ExchangeOrderBook> {
    await this.limit(provider);
    return this.factory
      .get(provider)
      .getOrderBook(normalizeSymbol(symbol), depth)
      .catch((caught: unknown) => {
        if (
          provider === ExchangeProvider.BINANCE_FUTURES &&
          this.isGeoBlockedError(caught)
        ) {
          return this.factory
            .get(ExchangeProvider.OKX_FUTURES)
            .getOrderBook(normalizeSymbol(symbol), depth);
        }
        throw caught;
      });
  }

  async trades(
    provider: ExchangeProvider,
    symbol: string,
    limit?: number,
  ): Promise<ExchangeTrade[]> {
    await this.limit(provider);
    return this.factory
      .get(provider)
      .getRecentTrades(normalizeSymbol(symbol), limit)
      .catch((caught: unknown) => {
        if (
          provider === ExchangeProvider.BINANCE_FUTURES &&
          this.isGeoBlockedError(caught)
        ) {
          return this.factory
            .get(ExchangeProvider.OKX_FUTURES)
            .getRecentTrades(normalizeSymbol(symbol), limit);
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
      .catch((caught: unknown) => {
        if (
          provider === ExchangeProvider.BINANCE_FUTURES &&
          this.isGeoBlockedError(caught)
        ) {
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
    await this.limit(provider);
    return this.cache.remember(
      this.cache.fundingKey(provider, normalized),
      this.cache.tickerTtl,
      () =>
        this.factory
          .get(provider)
          .getFundingRate(normalized)
          .catch((caught: unknown) => {
            if (
              provider === ExchangeProvider.BINANCE_FUTURES &&
              this.isGeoBlockedError(caught)
            ) {
              return this.factory
                .get(ExchangeProvider.OKX_FUTURES)
                .getFundingRate(normalized);
            }
            throw caught;
          }),
    );
  }

  async openInterest(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ExchangeOpenInterest> {
    const normalized = normalizeSymbol(symbol);
    await this.limit(provider);
    return this.cache.remember(
      this.cache.openInterestKey(provider, normalized),
      this.cache.tickerTtl,
      () =>
        this.factory
          .get(provider)
          .getOpenInterest(normalized)
          .catch((caught: unknown) => {
            if (
              provider === ExchangeProvider.BINANCE_FUTURES &&
              this.isGeoBlockedError(caught)
            ) {
              return this.factory
                .get(ExchangeProvider.OKX_FUTURES)
                .getOpenInterest(normalized);
            }
            throw caught;
          }),
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
}
