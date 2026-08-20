import { describe, expect, it, vi } from "vitest";
import { PublicExchangeService } from "../../src/exchange/application/public-exchange.service";
import { ExchangeProvider } from "../../src/exchange/domain/exchange.types";
import type { ExchangeAdapterFactory } from "../../src/exchange/application/exchange-adapter.factory";
import type { ExchangeCacheService } from "../../src/exchange/infrastructure/exchange-cache.service";
import type { ExchangeRateLimitService } from "../../src/exchange/infrastructure/exchange-rate-limit.service";
import type { ExchangeRealtimeService } from "../../src/exchange/application/exchange-realtime.service";

describe("PublicExchangeService - Provider Isolation", () => {
  it("providerSymbols(OKX_FUTURES) strictly queries OKX and does not call Binance", async () => {
    const mockOkxAdapter = {
      provider: ExchangeProvider.OKX_FUTURES,
      getInstruments: vi.fn().mockResolvedValue([
        { symbol: "BTC-USDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" },
        { symbol: "ETH-USDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING" },
        { symbol: "SOL-USDT", baseAsset: "SOL", quoteAsset: "USDT", status: "TRADING" },
      ]),
    };

    const mockBinanceAdapter = {
      provider: ExchangeProvider.BINANCE_FUTURES,
      getInstruments: vi.fn().mockRejectedValue(new Error("Binance geo-blocked 451")),
    };

    const mockFactory = {
      get: vi.fn((provider: ExchangeProvider) => {
        if (provider === ExchangeProvider.OKX_FUTURES) return mockOkxAdapter;
        if (provider === ExchangeProvider.BINANCE_FUTURES) return mockBinanceAdapter;
        throw new Error("Unexpected provider");
      }),
    } as unknown as ExchangeAdapterFactory;

    const mockCache = {
      remember: vi.fn(async <T>(_key: string, _ttl: number, loader: () => Promise<T>): Promise<T> => loader()),
      instrumentsKey: vi.fn((p: ExchangeProvider) => `inst:${p}`),
      instrumentTtl: 300,
    } as unknown as ExchangeCacheService;

    const mockRateLimit = {
      public: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExchangeRateLimitService;

    const mockRealtime = {} as unknown as ExchangeRealtimeService;

    const service = new PublicExchangeService(
      mockFactory,
      mockRateLimit,
      mockCache,
      mockRealtime,
    );

    const symbols = await service.providerSymbols(ExchangeProvider.OKX_FUTURES);

    expect(symbols).toHaveLength(3);
    expect(symbols.map((s) => s.symbol)).toEqual(["BTC-USDT", "ETH-USDT", "SOL-USDT"]);
    expect(symbols[0]?.okxSupported).toBe(true);
    expect(symbols[0]?.binanceSupported).toBe(false);

    // Verify Binance was NEVER called
    expect(mockBinanceAdapter.getInstruments).not.toHaveBeenCalled();
    expect(mockOkxAdapter.getInstruments).toHaveBeenCalledTimes(1);
  });

  it("recommendTopSymbols(OKX_FUTURES) evaluates only OKX and does not touch Binance", async () => {
    const mockOkxAdapter = {
      provider: ExchangeProvider.OKX_FUTURES,
      getInstruments: vi.fn().mockResolvedValue([
        { symbol: "BTC-USDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" },
      ]),
      getTicker: vi.fn().mockResolvedValue({
        provider: ExchangeProvider.OKX_FUTURES,
        symbol: "BTC-USDT",
        lastPrice: "65000",
        volume24h: "500000000",
        quoteVolume24h: "500000000",
        priceChange24h: "1500",
        priceChangePercent24h: "2.3",
        timestamp: new Date(),
      }),
    };

    const mockBinanceAdapter = {
      provider: ExchangeProvider.BINANCE_FUTURES,
      getInstruments: vi.fn().mockRejectedValue(new Error("Binance geo-blocked 451")),
      getTicker: vi.fn(),
    };

    const mockFactory = {
      get: vi.fn((provider: ExchangeProvider) => {
        if (provider === ExchangeProvider.OKX_FUTURES) return mockOkxAdapter;
        if (provider === ExchangeProvider.BINANCE_FUTURES) return mockBinanceAdapter;
        throw new Error("Unexpected provider");
      }),
    } as unknown as ExchangeAdapterFactory;

    const mockCache = {
      remember: vi.fn(async <T>(_key: string, _ttl: number, loader: () => Promise<T>): Promise<T> => loader()),
      instrumentsKey: vi.fn((p: ExchangeProvider) => `inst:${p}`),
      tickerKey: vi.fn((p: ExchangeProvider, s: string) => `ticker:${p}:${s}`),
      instrumentTtl: 300,
      tickerTtl: 3,
    } as unknown as ExchangeCacheService;

    const mockRateLimit = {
      public: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExchangeRateLimitService;

    const mockRealtime = {
      getTicker: vi.fn().mockResolvedValue(null),
    } as unknown as ExchangeRealtimeService;

    const service = new PublicExchangeService(
      mockFactory,
      mockRateLimit,
      mockCache,
      mockRealtime,
    );

    const recs = await service.recommendTopSymbols({
      provider: ExchangeProvider.OKX_FUTURES,
      limit: 5,
    });

    expect(recs).toHaveLength(1);
    expect(recs[0]?.symbol).toBe("BTC-USDT");
    expect(recs[0]?.provider).toBe(ExchangeProvider.OKX_FUTURES);
    expect(mockBinanceAdapter.getInstruments).not.toHaveBeenCalled();
  });
});
