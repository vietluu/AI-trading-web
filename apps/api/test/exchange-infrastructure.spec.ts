import { createHmac } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import { ExchangeErrorCode } from "../src/exchange/domain/exchange.error";
import {
  ExchangeEnvironment,
  ExchangeInterval,
  ExchangeProvider,
} from "../src/exchange/domain/exchange.types";
import { BinanceSignatureService } from "../src/exchange/infrastructure/binance/binance-signature.service";
import { ExchangeCacheService } from "../src/exchange/infrastructure/exchange-cache.service";
import { isRetryableStatus } from "../src/exchange/infrastructure/exchange-http.service";
import {
  toBinanceInterval,
  toOkxInterval,
} from "../src/exchange/infrastructure/exchange-interval";
import { ExchangeRateLimitService } from "../src/exchange/infrastructure/exchange-rate-limit.service";
import {
  fromAssets,
  fromOkxSymbol,
  mapSymbol,
  normalizeSymbol,
  toBinanceSymbol,
  toOkxSymbol,
} from "../src/exchange/infrastructure/exchange-symbol";
import { ExchangeTimeService } from "../src/exchange/infrastructure/exchange-time.service";
import { OkxSignatureService } from "../src/exchange/infrastructure/okx/okx-signature.service";
import { RedisService } from "../src/redis/redis.service";
import type { RedisService as RedisServiceType } from "../src/redis/redis.service";

describe("exchange infrastructure", () => {
  it("builds and signs a deterministic Binance query", () => {
    const signer = new BinanceSignatureService();
    const query = signer.query({
      timestamp: 1_490_000_000_000,
      symbol: "BTCUSDT",
      recvWindow: 5000,
    });
    expect(query).toBe(
      "recvWindow=5000&symbol=BTCUSDT&timestamp=1490000000000",
    );
    expect(signer.sign(query, "test-secret")).toBe(
      createHmac("sha256", "test-secret").update(query).digest("hex"),
    );
  });

  it("signs the complete OKX pre-hash string", () => {
    const signer = new OkxSignatureService();
    const timestamp = "2020-12-08T09:08:57.715Z";
    const path = "/api/v5/account/balance?ccy=BTC";
    expect(signer.sign(timestamp, "get", path, "", "test-secret")).toBe(
      createHmac("sha256", "test-secret")
        .update(`${timestamp}GET${path}`)
        .digest("base64"),
    );
  });

  it("normalizes provider symbols without losing the quote separator", () => {
    expect(normalizeSymbol(" btc-usdt ")).toBe("BTC-USDT");
    expect(normalizeSymbol("BTC - USDT")).toBe("BTC-USDT");
    expect(normalizeSymbol("BTCUSDT")).toBe("BTC-USDT");
    expect(fromAssets("BTC", "USDT")).toBe("BTC-USDT");
    expect(toBinanceSymbol("BTC-USDT")).toBe("BTCUSDT");
    expect(toOkxSymbol("BTC-USDT")).toBe("BTC-USDT-SWAP");
    expect(fromOkxSymbol("BTC-USDT-SWAP")).toBe("BTC-USDT");
  });

  it("maps execution symbols for OKX and Binance safely", () => {
    expect(mapSymbol("BTC-USDT", ExchangeProvider.OKX_FUTURES)).toBe(
      "BTC-USDT-SWAP",
    );
    expect(mapSymbol("BTC/USDT", ExchangeProvider.OKX_FUTURES)).toBe(
      "BTC-USDT-SWAP",
    );
    expect(mapSymbol("BTC-USDT-SWAP", ExchangeProvider.OKX_FUTURES)).toBe(
      "BTC-USDT-SWAP",
    );
    expect(mapSymbol("BTC-USDT", ExchangeProvider.BINANCE_FUTURES)).toBe(
      "BTCUSDT",
    );
    expect(mapSymbol("BNB-USDT", ExchangeProvider.OKX_FUTURES)).toBe(
      "BNB-USDT-SWAP",
    );
    expect(mapSymbol("BNB-USDT", ExchangeProvider.BINANCE_FUTURES)).toBe(
      "BNBUSDT",
    );
    expect(mapSymbol("BTCUSDT", ExchangeProvider.BINANCE_FUTURES)).toBe(
      "BTCUSDT",
    );
    expect(() => mapSymbol("", ExchangeProvider.OKX_FUTURES)).toThrow(
      "Symbol must not be empty",
    );
  });

  it("maps supported intervals and rejects unsupported OKX intervals", () => {
    expect(toBinanceInterval(ExchangeInterval.ONE_HOUR)).toBe("1h");
    expect(toOkxInterval(ExchangeInterval.ONE_DAY)).toBe("1Dutc");
    expect(() => toOkxInterval(ExchangeInterval.EIGHT_HOURS)).toThrow(
      "Unsupported OKX interval",
    );
  });

  it("classifies only throttling and server failures as retryable", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
  });

  it("preserves the OKX rejection message from non-2xx response envelopes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: () => Promise.resolve({ code: "50004", msg: "Order quantity exceeds limit" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const service = new (await import("../src/exchange/infrastructure/exchange-http.service")).ExchangeHttpService(
        new ConfigService({}),
      );
      await expect(
        service.request({
          provider: ExchangeProvider.OKX_FUTURES,
          operation: "/api/v5/trade/order",
          url: "https://example.com/api/v5/trade/order",
        }),
      ).rejects.toMatchObject({
        code: ExchangeErrorCode.INVALID_REQUEST,
        message: "Order quantity exceeds limit",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses globally shareable public cache keys", () => {
    const redis = {
      get: vi.fn(),
      setWithTtl: vi.fn(),
    } as unknown as RedisService;
    const cache = new ExchangeCacheService(redis, new ConfigService({}));
    expect(cache.instrumentsKey(ExchangeProvider.BINANCE_FUTURES)).toBe(
      "exchange:instruments:BINANCE_FUTURES:PRODUCTION",
    );
    expect(cache.tickerKey(ExchangeProvider.OKX_FUTURES, "BTC-USDT")).toBe(
      "exchange:ticker:OKX_FUTURES:BTC-USDT",
    );
  });

  it("scopes private rate-limit keys by user and connection", () => {
    const redis = { incrementWithTtl: vi.fn() } as unknown as RedisService;
    const limiter = new ExchangeRateLimitService(redis, new ConfigService({}));
    expect(
      limiter.privateKey(
        ExchangeProvider.OKX_FUTURES,
        ExchangeEnvironment.DEMO,
        "user-a",
        "connection-b",
      ),
    ).toBe("exchange:rate:private:OKX_FUTURES:DEMO:user-a:connection-b");
  });

  it("only sets TTL on the first increment for a rate-limit counter", async () => {
    const evalCommand = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    const redis = new RedisService(new ConfigService({ REDIS_URL: "redis://localhost:6379" }));
    (redis as unknown as { client: { eval: typeof evalCommand } }).client = {
      eval: evalCommand,
    };

    await expect(redis.incrementWithTtl("exchange:rate:test", 60)).resolves.toBe(1);
    await expect(redis.incrementWithTtl("exchange:rate:test", 60)).resolves.toBe(2);
    await expect(redis.incrementWithTtl("exchange:rate:test", 60)).resolves.toBe(3);

    expect(evalCommand).toHaveBeenCalledTimes(3);
    expect(evalCommand).toHaveBeenCalledWith(expect.any(String), 1, "exchange:rate:test", 60);
  });

  it("calculates and caches server time offset", async () => {
    const setWithTtl = vi.fn().mockResolvedValue(undefined);
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setWithTtl,
    } as unknown as RedisServiceType;
    const time = new ExchangeTimeService(redis, new ConfigService({}));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await expect(
      time.offset(
        ExchangeProvider.BINANCE_FUTURES,
        ExchangeEnvironment.TESTNET,
        () => Promise.resolve(1_250),
      ),
    ).resolves.toBe(250);
    expect(setWithTtl).toHaveBeenCalledWith(
      "exchange:time-offset:BINANCE_FUTURES:TESTNET",
      "250",
      300,
    );
    now.mockRestore();
  });
});
