import { describe, expect, it, vi } from "vitest";

import {
  ExchangeEnvironment,
  ExchangeInterval,
} from "../src/exchange/domain/exchange.types";
import { BinanceFuturesAdapter } from "../src/exchange/infrastructure/binance/binance-futures.adapter";
import type { BinanceFuturesClient } from "../src/exchange/infrastructure/binance/binance-futures.client";
import { OkxFuturesAdapter } from "../src/exchange/infrastructure/okx/okx-futures.adapter";
import type { OkxFuturesClient } from "../src/exchange/infrastructure/okx/okx-futures.client";

describe("exchange adapter normalization contract", () => {
  it("preserves Binance ticker decimals as strings", async () => {
    const publicGet = vi.fn((path: string) =>
      Promise.resolve(
        path.endsWith("premiumIndex")
          ? {
              markPrice: "67234.12345678",
              indexPrice: "67230.87654321",
              lastFundingRate: "0.00010000",
              nextFundingTime: 1_700_000_000_000,
              time: 1_699_999_999_000,
            }
          : {
              symbol: "BTCUSDT",
              lastPrice: "67233.12345678",
              highPrice: "68000.00000000",
              lowPrice: "65000.00000000",
              volume: "12345.67890000",
              quoteVolume: "829999999.12345678",
              priceChange: "123.00000000",
              priceChangePercent: "0.18300000",
              closeTime: 1_700_000_000_000,
              bidPrice: "67233.10000000",
              askPrice: "67233.20000000",
            },
      ),
    );
    const adapter = new BinanceFuturesAdapter({
      publicGet,
    } as unknown as BinanceFuturesClient);
    const ticker = await adapter.getTicker("BTC-USDT");
    expect(ticker.symbol).toBe("BTC-USDT");
    expect(ticker.lastPrice).toBe("67233.12345678");
    expect(ticker.markPrice).toBe("67234.12345678");
    expect(typeof ticker.lastPrice).toBe("string");
  });

  it("normalizes OKX ticker and keeps provider precision", async () => {
    const publicGet = vi.fn((path: string) =>
      Promise.resolve(
        path.endsWith("mark-price")
          ? [
              {
                instId: "BTC-USDT-SWAP",
                markPx: "67234.12345678",
                ts: "1700000000000",
              },
            ]
          : [
              {
                instId: "BTC-USDT-SWAP",
                last: "67233.12345678",
                bidPx: "67233.10000000",
                askPx: "67233.20000000",
                high24h: "68000.00000000",
                low24h: "65000.00000000",
                vol24h: "12345.67890000",
                volCcy24h: "829999999.12345678",
                open24h: "67100.00000000",
                ts: "1700000000000",
              },
            ],
      ),
    );
    const adapter = new OkxFuturesAdapter({
      publicGet,
    } as unknown as OkxFuturesClient);
    const ticker = await adapter.getTicker("BTC-USDT");
    expect(ticker.symbol).toBe("BTC-USDT");
    expect(ticker.lastPrice).toBe("67233.12345678");
    expect(ticker).not.toHaveProperty("priceChangePercent24h");
  });

  it("normalizes closed klines for both providers", async () => {
    const binance = new BinanceFuturesAdapter({
      publicGet: vi
        .fn()
        .mockResolvedValue([
          [
            1_700_000_000_000,
            "1.00000000",
            "2.00000000",
            "0.50000000",
            "1.50000000",
            "10.00000000",
            1_700_000_059_999,
            "15.00000000",
            42,
            "5.00000000",
            "7.50000000",
            "0",
          ],
        ]),
    } as unknown as BinanceFuturesClient);
    const okx = new OkxFuturesAdapter({
      publicGet: vi
        .fn()
        .mockResolvedValue([
          [
            "1700000000000",
            "1.00000000",
            "2.00000000",
            "0.50000000",
            "1.50000000",
            "10.00000000",
            "10",
            "15.00000000",
            "1",
          ],
        ]),
    } as unknown as OkxFuturesClient);
    const query = { symbol: "BTC-USDT", interval: ExchangeInterval.ONE_MINUTE };
    const [binanceKline] = await binance.getKlines(query);
    const [okxKline] = await okx.getKlines(query);
    expect(binanceKline?.close).toBe("1.50000000");
    expect(okxKline?.close).toBe("1.50000000");
    expect(binanceKline?.isClosed).toBe(true);
    expect(okxKline?.isClosed).toBe(true);
  });

  it("normalizes blank OKX account totals before persistence", async () => {
    const adapter = new OkxFuturesAdapter({
      signedGet: vi.fn().mockResolvedValue([
        {
          totalEq: "76228.69",
          availEq: "",
          upl: "",
          uTime: "1700000000000",
          details: [
            {
              ccy: "BTC",
              cashBal: "1",
              availBal: "1",
              upl: "0",
            },
            {
              ccy: "USDT",
              cashBal: "50000",
              availBal: "48000",
              upl: "125.50",
            },
          ],
        },
      ]),
    } as unknown as OkxFuturesClient);

    const account = await adapter.getAccountSummary({
      apiKey: "demo-key",
      apiSecret: "demo-secret",
      passphrase: "demo-passphrase",
      environment: ExchangeEnvironment.DEMO,
    });

    expect(account.availableBalance).toBe("48000");
    expect(account.totalUnrealizedPnl).toBe("125.50");
  });

  it("converts base-asset risk size to OKX contract size", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const adapter = new OkxFuturesAdapter({
      publicGet: vi.fn().mockResolvedValue([
        {
          instId: "BTC-USDT-SWAP",
          instType: "SWAP",
          state: "live",
          settleCcy: "USDT",
          ctVal: "0.01",
          tickSz: "0.1",
          lotSz: "1",
          minSz: "1",
        },
      ]),
      signedPost,
    } as unknown as OkxFuturesClient);

    await adapter.placeOrder(
      {
        apiKey: "demo-key",
        apiSecret: "demo-secret",
        passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "BTC-USDT",
        side: "BUY",
        quantity: "0.03",
        leverage: 3,
        clientOrderId: "phase9-order",
      },
    );

    expect(signedPost).toHaveBeenNthCalledWith(
      2,
      "/api/v5/trade/order",
      expect.anything(),
      expect.objectContaining({ sz: "3" }),
    );
  });

  it("caps OKX client order ids to the supported length", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const adapter = new OkxFuturesAdapter({
      publicGet: vi.fn().mockResolvedValue([
        {
          instId: "BTC-USDT-SWAP",
          instType: "SWAP",
          state: "live",
          settleCcy: "USDT",
          ctVal: "0.01",
          tickSz: "0.1",
          lotSz: "1",
          minSz: "1",
        },
      ]),
      signedPost,
    } as unknown as OkxFuturesClient);

    await adapter.placeOrder(
      {
        apiKey: "demo-key",
        apiSecret: "demo-secret",
        passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "BTC-USDT",
        side: "BUY",
        quantity: "0.03",
        leverage: 3,
        clientOrderId: "p9-fa86427ec6fb4254b8b2d6cefa32518b",
      },
    );

    const body = signedPost.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(body.clOrdId).toBeDefined();
    expect(String(body.clOrdId).length).toBeLessThanOrEqual(32);
  });
});
