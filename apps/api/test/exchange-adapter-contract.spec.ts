import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ExchangeError, ExchangeErrorCode } from "../src/exchange/domain/exchange.error";
import {
  ExchangeEnvironment,
  ExchangeInterval,
  ExchangeProvider,
} from "../src/exchange/domain/exchange.types";
import { BinanceFuturesAdapter } from "../src/exchange/infrastructure/binance/binance-futures.adapter";
import { normalizeSymbol } from "../src/exchange/infrastructure/exchange-symbol";
import type { BinanceFuturesClient } from "../src/exchange/infrastructure/binance/binance-futures.client";
import { OkxFuturesAdapter } from "../src/exchange/infrastructure/okx/okx-futures.adapter";
import { OkxFuturesClient } from "../src/exchange/infrastructure/okx/okx-futures.client";

describe("exchange adapter normalization contract", () => {
  it("does not silently backfill hard-coded Binance symbols", async () => {
    const signedGet = vi.fn();
    const adapter = new BinanceFuturesAdapter({ signedGet } as unknown as BinanceFuturesClient);

    await expect(adapter.getTradeFills({
      apiKey: "key",
      apiSecret: "secret",
      environment: ExchangeEnvironment.TESTNET,
    })).resolves.toEqual([]);
    expect(signedGet).not.toHaveBeenCalled();
  });

  it("passes the backfill time cursor to Binance", async () => {
    const signedGet = vi.fn().mockResolvedValue([]);
    const adapter = new BinanceFuturesAdapter({ signedGet } as unknown as BinanceFuturesClient);
    const before = new Date("2026-08-01T00:00:00.000Z");

    await adapter.getTradeFills({
      apiKey: "key",
      apiSecret: "secret",
      environment: ExchangeEnvironment.TESTNET,
    }, ["ALGO-USDT"], 1000, before);

    expect(signedGet).toHaveBeenCalledWith(
      "/fapi/v1/userTrades",
      expect.any(Object),
      { symbol: "ALGOUSDT", limit: 1000, endTime: before.getTime() },
    );
  });

  it("normalizes compact quote symbols into base-quote format", () => {
    expect(normalizeSymbol("BNBUSDT")).toBe("BNB-USDT");
    expect(normalizeSymbol("ETHUSDT")).toBe("ETH-USDT");
    expect(normalizeSymbol("SOLUSDT")).toBe("SOL-USDT");
  });

  it("requests the specific OKX instrument metadata for the requested symbol", async () => {
    const publicGet = vi.fn().mockResolvedValue([
      {
        instId: "ETH-USDT-SWAP",
        instType: "SWAP",
        state: "live",
        settleCcy: "USDT",
        ctVal: "0.1",
        tickSz: "0.1",
        lotSz: "1",
        minSz: "1",
      },
    ]);
    const adapter = new OkxFuturesAdapter({
      publicGet,
    } as unknown as OkxFuturesClient);

    const instruments = await adapter.getInstruments({ symbol: "ETH-USDT" });

    expect(publicGet).toHaveBeenCalledWith(
      "/api/v5/public/instruments",
      expect.objectContaining({ instType: "SWAP", instId: "ETH-USDT-SWAP" }),
    );
    expect(instruments[0]?.contractSize).toBe("0.1");
  });

  it("surfaces the specific OKX order rejection from envelope details", async () => {
    const client = new OkxFuturesClient(
      {
        request: vi.fn().mockResolvedValue({
          data: {
            code: "1",
            msg: "All operations failed",
            data: [{ sCode: "1", sMsg: "Position size exceeds max" }],
          },
          correlationId: "corr-1",
        }),
      } as never,
      {
        sign: vi.fn().mockReturnValue("signature"),
      },
      {
        offset: vi.fn().mockResolvedValue(0),
        invalidate: vi.fn(),
      } as never,
      {
        getOrThrow: vi.fn().mockReturnValue("https://example.test"),
      } as never,
    );

    await expect(
      client.signedPost(
        "/api/v5/trade/order",
        {
          apiKey: "demo-key",
          apiSecret: "demo-secret",
          passphrase: "demo-passphrase",
          environment: ExchangeEnvironment.DEMO,
        },
        { instId: "BTC-USDT-SWAP" },
      ),
    ).rejects.toMatchObject({
      message: "Position size exceeds max",
      exchangeCode: "1",
    });
  });

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
    expect(Number(ticker.priceChange24h)).toBeCloseTo(133.12345678, 8);
    expect(Number(ticker.priceChangePercent24h)).toBeCloseTo(0.19839561, 8);
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

  it("logs the requested quantity alongside the converted OKX contract quantity", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
      ]);
    const adapter = new OkxFuturesAdapter({
      publicGet,
      signedPost,
    } as unknown as OkxFuturesClient);
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

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
        quantity: "8.19409863277",
        leverage: 3,
        clientOrderId: "phase9-order",
      } as never,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "okx_order_request",
        requestedQuantity: "8.19409863277",
        contractQuantity: "819",
      }),
    );
  });

  it("forwards stop-loss and take-profit values to OKX as trigger fields", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
      ]);
    const adapter = new OkxFuturesAdapter({
      publicGet,
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
        stopLoss: "65000",
        takeProfit: "68000",
      },
    );

    const body = signedPost.mock.calls[1]?.[2] as {
      attachAlgoOrds?: Array<{
        attachAlgoClOrdId?: string;
        slTriggerPx?: string;
        slOrdPx?: string;
        tpTriggerPx?: string;
        tpOrdPx?: string;
      }>;
    };
    const algo = body.attachAlgoOrds?.[0];
    expect(algo?.attachAlgoClOrdId).toBe("phase9orderpm");
    expect(algo?.slTriggerPx).toBe("65000");
    expect(algo?.slOrdPx).toBe("-1");
    expect(algo?.tpTriggerPx).toBe("68000");
    expect(algo?.tpOrdPx).toBe("-1");
  });

  it("amends and cancels OKX attached protection by client algo id", async () => {
    const signedPost = vi.fn().mockResolvedValue([
      { algoId: "algo-1", algoClOrdId: "protect-1", sCode: "0", sMsg: "" },
    ]);
    const adapter = new OkxFuturesAdapter({ signedPost } as unknown as OkxFuturesClient);
    const credentials = {
      apiKey: "demo-key",
      apiSecret: "demo-secret",
      passphrase: "demo-passphrase",
      environment: ExchangeEnvironment.DEMO,
    };

    await adapter.amendProtectiveOrder(credentials, {
      symbol: "BTC-USDT",
      protectiveClientOrderId: "protect-1",
      stopLoss: "66000",
      takeProfit: "68000",
      requestId: "amend-1",
    });
    expect(signedPost).toHaveBeenNthCalledWith(1, "/api/v5/trade/amend-algos", credentials, expect.objectContaining({
      instId: "BTC-USDT-SWAP",
      algoClOrdId: "protect1",
      newSlTriggerPx: "66000",
    }));

    await adapter.cancelProtectiveOrder(credentials, {
      symbol: "BTC-USDT",
      protectiveClientOrderId: "protect-1",
    });
    expect(signedPost).toHaveBeenNthCalledWith(2, "/api/v5/trade/cancel-algos", credentials, [expect.objectContaining({
      algoClOrdId: "protect1",
    })]);
  });

  it("removes hyphens from UUID-style client order ids before OKX submission", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
      ]);
    const adapter = new OkxFuturesAdapter({
      publicGet,
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
        clientOrderId: "550e8400-e29b-41d4-a716-446655440000",
      },
    );

    const body = signedPost.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(String(body.clOrdId)).not.toContain("-");
    expect(String(body.clOrdId)).toBe("550e8400e29b41d4a716446655440000");
  });

  it("uses whole-contract sizes for OKX futures orders", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([
        {
          instId: "BTC-USDT-SWAP",
          instType: "SWAP",
          state: "live",
          settleCcy: "USDT",
          ctVal: "0.01",
          tickSz: "0.1",
          lotSz: "0.01",
          minSz: "1",
        },
      ])
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
        {
          instId: "BTC-USDT-SWAP",
          markPx: "67234.12345678",
          ts: "1700000000000",
        },
      ]);
    const adapter = new OkxFuturesAdapter({
      publicGet,
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
        quantity: "0.0483",
        leverage: 3,
        clientOrderId: "phase9-order",
      },
    );

    expect(signedPost).toHaveBeenCalledWith(
      "/api/v5/trade/order",
      expect.anything(),
      expect.objectContaining({ sz: "5" }),
    );
  });

  it("uses a real market price for OKX limit orders", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
        {
          instId: "BTC-USDT-SWAP",
          markPx: "67234.12345678",
          ts: "1700000000000",
        },
      ]);
    const adapter = new OkxFuturesAdapter({
      publicGet,
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

    const body = signedPost.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(body.px).toBe("67233.20000000");
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

  it("caps OKX market order quantity to the instrument maximum size", async () => {
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
          maxMktSz: "3",
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
        quantity: "0.05",
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

  it("retries an OKX order as a market order when the limit order is rejected", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "1", sMsg: "All operations failed" },
      ])
      .mockResolvedValueOnce([
        { ordId: "456", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
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

    const order = await adapter.placeOrder(
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

    expect(order.exchangeOrderId).toBe("456");
    const fallbackBody = signedPost.mock.calls[2]?.[2] as Record<string, unknown>;
    expect(fallbackBody.ordType).toBe("market");
    expect(fallbackBody.px).toBeUndefined();
  });

  it("retries an OKX order as a market order when the exchange envelope rejects the limit order", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockRejectedValueOnce(
        new ExchangeError(
          ExchangeErrorCode.INVALID_REQUEST,
          ExchangeProvider.OKX_FUTURES,
          false,
          400,
          "All operations failed",
          "1",
        ),
      )
      .mockResolvedValueOnce([
        { ordId: "456", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
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

    const order = await adapter.placeOrder(
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

    expect(order.exchangeOrderId).toBe("456");
    const fallbackBody = signedPost.mock.calls[2]?.[2] as Record<string, unknown>;
    expect(fallbackBody.ordType).toBe("market");
  });

  it("continues placing an OKX order if leverage setup fails", async () => {
    const signedPost = vi
      .fn()
      .mockRejectedValueOnce(new Error("leverage setup failed"))
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

    await expect(
      adapter.placeOrder(
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
      ),
    ).resolves.toMatchObject({ exchangeOrderId: "123" });
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
    expect(String(body.clOrdId)).toMatch(/^[A-Za-z0-9]+$/);
  });
});
