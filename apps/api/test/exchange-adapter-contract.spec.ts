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

function okxAdapter(
  client: Partial<OkxFuturesClient>,
  config?: ConstructorParameters<typeof OkxFuturesAdapter>[1],
): OkxFuturesAdapter {
  return new OkxFuturesAdapter(
    {
      signedGet: vi.fn().mockResolvedValue([
        {
          instId: "BTC-USDT-SWAP",
          maxBuy: "1000000000",
          maxSell: "1000000000",
        },
      ]),
      ...client,
    } as unknown as OkxFuturesClient,
    config,
  );
}

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
    const adapter = okxAdapter({
      publicGet,
    });

    const instruments = await adapter.getInstruments({ symbol: "ETH-USDT" });

    expect(publicGet).toHaveBeenCalledWith(
      "/api/v5/public/instruments",
      expect.objectContaining({ instType: "SWAP", instId: "ETH-USDT-SWAP" }),
    );
    expect(instruments[0]?.contractSize).toBe("0.1");
  });

  it("requests OKX instrument metadata from the account environment", async () => {
    const publicGet = vi.fn().mockResolvedValue([]);
    const adapter = okxAdapter({
      publicGet,
    });

    await adapter.getInstruments({
      symbol: "OKB-USDT",
      environment: ExchangeEnvironment.DEMO,
    });

    expect(publicGet).toHaveBeenCalledWith(
      "/api/v5/public/instruments",
      expect.objectContaining({ instId: "OKB-USDT-SWAP" }),
      ExchangeEnvironment.DEMO,
    );
  });

  it("correctly parses OKX USD_UM swap instruments without ignoring or warning", async () => {
    const warning = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const publicGet = vi.fn().mockResolvedValue([
      {
        instId: "EWJ-USD_UM-SWAP",
        instType: "SWAP",
        state: "live",
        settleCcy: "USD",
        ctVal: "1",
        tickSz: "0.01",
        lotSz: "1",
        minSz: "1",
      },
      {
        instId: "SLX-USD_UM-SWAP",
        instType: "SWAP",
        state: "live",
        settleCcy: "USD",
        ctVal: "1",
        tickSz: "0.01",
        lotSz: "1",
        minSz: "1",
      },
    ]);
    const adapter = okxAdapter({ publicGet });

    const instruments = await adapter.getInstruments();

    expect(instruments).toHaveLength(2);
    expect(instruments[0]?.symbol).toBe("EWJ-USD_UM");
    expect(instruments[1]?.symbol).toBe("SLX-USD_UM");
    expect(warning).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: "okx_non_swap_record_ignored",
      }),
    );
    warning.mockRestore();
  });

  it("ignores non-swap position records without failing OKX account sync", async () => {
    const warning = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const signedGet = vi.fn().mockResolvedValue([
      {
        instId: "BTC-USDT-SWAP",
        pos: "2",
        posSide: "net",
        avgPx: "65000",
        upl: "1.5",
        uTime: "1700000000000",
      },
      {
        instId: "LINK-USDT",
        pos: "1",
        posSide: "net",
        avgPx: "9.5",
        upl: "0",
        uTime: "1700000000000",
      },
    ]);
    const publicGet = vi.fn().mockResolvedValue([
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
    ]);
    const adapter = okxAdapter({ signedGet, publicGet });

    const positions = await adapter.getPositions({
      apiKey: "demo-key",
      apiSecret: "demo-secret",
      environment: ExchangeEnvironment.DEMO,
    });

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      symbol: "BTC-USDT",
      quantity: "0.02",
    });
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "okx_non_swap_record_ignored",
        source: "positions",
        instId: "LINK-USDT",
      }),
    );
    warning.mockRestore();
  });

  it("ignores non-swap pending orders without failing the connection test path", async () => {
    const signedGet = vi.fn().mockResolvedValue([
      {
        instId: "BTC-USDT-SWAP",
        ordId: "swap-order",
        side: "buy",
        ordType: "limit",
        state: "live",
        sz: "1",
        accFillSz: "0",
        source: "13",
        algoClOrdId: "protective-child-1",
        algoId: "algo-1",
      },
      {
        instId: "LINK-USDT",
        ordId: "unexpected-order",
        side: "buy",
        ordType: "limit",
        state: "live",
        sz: "1",
        accFillSz: "0",
      },
    ]);
    const adapter = okxAdapter({ signedGet });

    const orders = await adapter.getOpenOrders({
      apiKey: "demo-key",
      apiSecret: "demo-secret",
      environment: ExchangeEnvironment.DEMO,
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      symbol: "BTC-USDT",
      exchangeOrderId: "swap-order",
      sourceCode: "13",
      algoClientOrderId: "protective-child-1",
      algoOrderId: "algo-1",
    });
  });

  it("normalizes OKX order-history contracts into base quantity", async () => {
    const signedGet = vi.fn().mockResolvedValue([{
      instId: "XRP-USDT-SWAP",
      ordId: "filled-order",
      side: "sell",
      ordType: "market",
      state: "filled",
      sz: "8.97",
      accFillSz: "8.97",
    }]);
    const publicGet = vi.fn().mockResolvedValue([{
      instId: "XRP-USDT-SWAP",
      instType: "SWAP",
      state: "live",
      settleCcy: "USDT",
      ctVal: "100",
      tickSz: "0.0001",
      lotSz: "0.01",
      minSz: "0.01",
    }]);
    const adapter = okxAdapter({ signedGet, publicGet });

    const orders = await adapter.getOrderHistory({
      apiKey: "demo-key",
      apiSecret: "demo-secret",
      environment: ExchangeEnvironment.DEMO,
    });

    expect(orders[0]).toMatchObject({
      originalQuantity: "897",
      executedQuantity: "897",
    });
  });

  it("adds the simulated-trading header to OKX Demo public requests", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { code: "0", data: [] },
      correlationId: "corr-demo",
    });
    const client = new OkxFuturesClient(
      { request } as never,
      { sign: vi.fn() },
      { offset: vi.fn() } as never,
      { getOrThrow: vi.fn().mockReturnValue("https://example.test") } as never,
    );

    await client.publicGet(
      "/api/v5/public/instruments",
      { instType: "SWAP", instId: "OKB-USDT-SWAP" },
      ExchangeEnvironment.DEMO,
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        init: { headers: { "x-simulated-trading": "1" } },
      }),
    );
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
    const adapter = okxAdapter({
      publicGet,
    });
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
    const okx = okxAdapter({
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
    });
    const query = { symbol: "BTC-USDT", interval: ExchangeInterval.ONE_MINUTE };
    const [binanceKline] = await binance.getKlines(query);
    const [okxKline] = await okx.getKlines(query);
    expect(binanceKline?.close).toBe("1.50000000");
    expect(okxKline?.close).toBe("1.50000000");
    expect(binanceKline?.isClosed).toBe(true);
    expect(okxKline?.isClosed).toBe(true);
  });

  it("normalizes blank OKX account totals before persistence", async () => {
    const adapter = okxAdapter({
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
    });

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
    const adapter = okxAdapter({
      publicGet,
      signedPost,
    });
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

  it("caps an OKX entry at the account maximum size for the selected leverage", async () => {
    const signedGet = vi.fn().mockResolvedValue([
      { instId: "ZRO-USDT-SWAP", maxBuy: "300", maxSell: "280" },
    ]);
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "9" }])
      .mockResolvedValueOnce([
        { ordId: "zro-1", clOrdId: "zro-entry", sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([
        {
          instId: "ZRO-USDT-SWAP",
          instType: "SWAP",
          state: "live",
          settleCcy: "USDT",
          ctVal: "1",
          tickSz: "0.0001",
          lotSz: "1",
          minSz: "1",
        },
      ])
      .mockResolvedValueOnce([
        {
          instId: "ZRO-USDT-SWAP",
          last: "0.79",
          bidPx: "0.7899",
          askPx: "0.7901",
          high24h: "0.82",
          low24h: "0.77",
          vol24h: "100000",
          volCcy24h: "79000",
          open24h: "0.80",
          ts: "1700000000000",
        },
      ]);
    const adapter = okxAdapter({
      publicGet,
      signedGet,
      signedPost,
    });

    const order = await adapter.placeOrder(
      {
        apiKey: "demo-key",
        apiSecret: "demo-secret",
        passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "ZRO-USDT",
        side: "SELL",
        quantity: "9595.297780946372",
        leverage: 9,
        clientOrderId: "zro-entry",
      },
    );

    expect(signedGet).toHaveBeenCalledWith(
      "/api/v5/account/max-size",
      expect.anything(),
      { instId: "ZRO-USDT-SWAP", tdMode: "cross" },
    );
    expect(signedPost).toHaveBeenNthCalledWith(
      2,
      "/api/v5/trade/order",
      expect.anything(),
      expect.objectContaining({ sz: "280" }),
    );
    expect(order.originalQuantity).toBe("280");
  });

  it.each([
    { symbol: "ETH-USDT", contractSize: "0.1", requested: "50", maximum: "120", expectedBase: "12" },
    { symbol: "SOL-USDT", contractSize: "1", requested: "900", maximum: "75", expectedBase: "75" },
  ])("applies the account cap generically to $symbol", async ({
    symbol,
    contractSize,
    requested,
    maximum,
    expectedBase,
  }) => {
    const instId = `${symbol}-SWAP`;
    const signedGet = vi.fn().mockResolvedValue([
      { instId, maxBuy: maximum, maxSell: maximum },
    ]);
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "5" }])
      .mockResolvedValueOnce([
        { ordId: `${symbol}-1`, clOrdId: `${symbol}-entry`, sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([{
        instId,
        instType: "SWAP",
        state: "live",
        settleCcy: "USDT",
        ctVal: contractSize,
        tickSz: "0.01",
        lotSz: "1",
        minSz: "1",
      }])
      .mockResolvedValueOnce([{
        instId,
        last: "100",
        bidPx: "99.9",
        askPx: "100.1",
        high24h: "105",
        low24h: "95",
        vol24h: "1000",
        volCcy24h: "100000",
        open24h: "100",
        ts: "1700000000000",
      }]);
    const adapter = okxAdapter({ publicGet, signedGet, signedPost });

    const order = await adapter.placeOrder(
      {
        apiKey: "demo-key",
        apiSecret: "demo-secret",
        passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol,
        side: "BUY",
        quantity: requested,
        leverage: 5,
        clientOrderId: `${symbol}-entry`,
      },
    );

    expect(signedPost).toHaveBeenNthCalledWith(
      2,
      "/api/v5/trade/order",
      expect.anything(),
      expect.objectContaining({ sz: maximum }),
    );
    expect(order.originalQuantity).toBe(expectedBase);
  });

  it("fails an opening order closed when OKX max-size preflight is unavailable", async () => {
    const signedGet = vi.fn().mockRejectedValue(new Error("max-size unavailable"));
    const signedPost = vi.fn().mockResolvedValueOnce([{ lever: "3" }]);
    const publicGet = vi.fn().mockResolvedValueOnce([{
      instId: "ETH-USDT-SWAP",
      instType: "SWAP",
      state: "live",
      settleCcy: "USDT",
      ctVal: "0.1",
      tickSz: "0.1",
      lotSz: "1",
      minSz: "1",
    }]);
    const adapter = okxAdapter({ publicGet, signedGet, signedPost });

    await expect(adapter.placeOrder(
      {
        apiKey: "demo-key",
        apiSecret: "demo-secret",
        passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "ETH-USDT",
        side: "BUY",
        quantity: "1",
        leverage: 3,
        clientOrderId: "eth-entry",
      },
    )).rejects.toMatchObject({
      code: ExchangeErrorCode.UNAVAILABLE,
      retryable: true,
    });
    expect(signedPost).toHaveBeenCalledTimes(1);
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
    const adapter = okxAdapter({
      publicGet,
      signedPost,
    });

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
    const publicGet = vi.fn().mockResolvedValue([
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
    ]);
    const adapter = okxAdapter({ signedPost, publicGet });
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

  it("recognizes live OKX protection and recreates a full-position OCO", async () => {
    const signedGet = vi.fn().mockResolvedValue([
      { algoId: "algo-1", algoClOrdId: "protect-1", state: "live" },
    ]);
    const signedPost = vi.fn().mockResolvedValue([
      { algoId: "algo-2", algoClOrdId: "repair-1", sCode: "0", sMsg: "" },
    ]);
    const publicGet = vi.fn().mockResolvedValue([
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
    ]);
    const adapter = okxAdapter({ signedGet, signedPost, publicGet });
    const credentials = {
      apiKey: "demo-key",
      apiSecret: "demo-secret",
      passphrase: "demo-passphrase",
      environment: ExchangeEnvironment.DEMO,
    };

    await expect(
      adapter.getProtectiveOrderStatus(credentials, {
        symbol: "BTC-USDT",
        protectiveClientOrderId: "protect-1",
      }),
    ).resolves.toBe("ACTIVE");
    await adapter.placeProtectiveOrder(credentials, {
      symbol: "BTC-USDT",
      positionSide: "LONG",
      positionMode: "HEDGE",
      protectiveClientOrderId: "repair-1",
      stopLoss: "65000",
      takeProfit: "68000",
    });

    expect(signedPost).toHaveBeenCalledWith(
      "/api/v5/trade/order-algo",
      credentials,
      expect.objectContaining({
        instId: "BTC-USDT-SWAP",
        side: "sell",
        posSide: "long",
        ordType: "oco",
        closeFraction: "1",
        algoClOrdId: "repair1",
        slTriggerPx: "65000",
        tpTriggerPx: "68000",
      }),
    );
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
    const adapter = okxAdapter({
      publicGet,
      signedPost,
    });

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

  it("floors OKX futures sizes to the advertised contract lot", async () => {
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
    const adapter = okxAdapter({
      publicGet,
      signedPost,
    });

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
      expect.objectContaining({ sz: "4.83" }),
    );
  });

  it("uses a worst price for OKX ioc orders when maxAdverseDriftBps is provided", async () => {
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
    const adapter = okxAdapter({
      publicGet,
      signedPost,
    });

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
        referencePrice: "67230",
        maxAdverseDriftBps: 10,
      },
    );

    const body = signedPost.mock.calls[1]?.[2] as Record<string, unknown>;
    // 67230 * 1.001 = 67297.23
    expect(body.px).toBe("67297.2");
    expect(body.ordType).toBe("ioc");
  });

  it("converts base-asset risk size to OKX contract size", async () => {
    const signedPost = vi.fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const adapter = okxAdapter({
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
    });

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
    const adapter = okxAdapter({
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
    });

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
    const adapter = okxAdapter({
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
    });

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

  it("uses post-only for an OKX entry and falls back only after cancellation is confirmed", async () => {
    let canceled = false;
    const signedPost = vi.fn().mockImplementation(
      (path: string, _credentials: unknown, body: Record<string, unknown>) => {
        if (path === "/api/v5/account/set-leverage") return [{ lever: "3" }];
        if (path === "/api/v5/trade/cancel-order") {
          canceled = true;
          return [{ ordId: "maker-1", clOrdId: "maker-entry", sCode: "0", sMsg: "" }];
        }
        if (body.ordType === "post_only") {
          return [{ ordId: "maker-1", clOrdId: "maker-entry", sCode: "0", sMsg: "" }];
        }
        return [{ ordId: "market-2", clOrdId: body.clOrdId, sCode: "0", sMsg: "" }];
      },
    );
    const signedGet = vi.fn().mockImplementation((path: string) => path === "/api/v5/account/max-size" ? [{
      instId: "BTC-USDT-SWAP", maxBuy: "1000000", maxSell: "1000000",
    }] : [{
      instId: "BTC-USDT-SWAP",
      ordId: "maker-1",
      clOrdId: "maker-entry",
      side: "buy",
      ordType: "post_only",
      state: canceled ? "canceled" : "live",
      px: "67233.1",
      avgPx: "",
      sz: "3",
      accFillSz: "0",
    }]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([{
        instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live",
        settleCcy: "USDT", ctVal: "0.01", tickSz: "0.1", lotSz: "1", minSz: "1",
      }])
      .mockResolvedValueOnce([{
        instId: "BTC-USDT-SWAP", last: "67233.15", bidPx: "67233.1", askPx: "67233.2",
        high24h: "68000", low24h: "65000", vol24h: "100", volCcy24h: "1000",
        open24h: "67100", ts: "1700000000000",
      }]);
    const config = {
      get: (key: string) => key === "OKX_MAKER_FIRST_ENABLED"
        ? true
        : key === "OKX_MAKER_FIRST_TIMEOUT_MS"
          ? 5
          : 1,
    };
    const adapter = okxAdapter(
      { publicGet, signedGet, signedPost },
      config as never,
    );

    const order = await adapter.placeOrder(
      {
        apiKey: "demo-key", apiSecret: "demo-secret", passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "BTC-USDT", side: "BUY", quantity: "0.03", leverage: 3,
        clientOrderId: "maker-entry", stopLoss: "65000", takeProfit: "68000",
      },
    );

    const orderBodies = signedPost.mock.calls
      .filter(([path]) => path === "/api/v5/trade/order")
      .map((call) => call[2] as Record<string, unknown>);
    expect(orderBodies[0]).toMatchObject({ ordType: "post_only", px: "67233.1" });
    expect(signedPost).toHaveBeenCalledWith(
      "/api/v5/trade/cancel-order",
      expect.anything(),
      expect.objectContaining({ ordId: "maker-1" }),
    );
    expect(orderBodies[1]).toMatchObject({ ordType: "market", clOrdId: "makerentryfb" });
    expect(orderBodies[1]?.px).toBeUndefined();
    expect(order).toMatchObject({
      exchangeOrderId: "market-2",
      clientOrderId: "makerentryfb",
      type: "MARKET",
      status: "NEW",
    });
  });

  it("rejects an OKX entry when the executable price has moved beyond approval", async () => {
    const signedPost = vi.fn().mockResolvedValueOnce([{ lever: "3" }]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([{
        instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live",
        settleCcy: "USDT", ctVal: "0.01", tickSz: "0.1", lotSz: "1", minSz: "1",
      }])
      .mockResolvedValueOnce([{
        instId: "BTC-USDT-SWAP", last: "101", bidPx: "100.9", askPx: "101.1",
        high24h: "105", low24h: "95", vol24h: "100", volCcy24h: "1000",
        open24h: "100", ts: "1700000000000",
      }]);
    const adapter = okxAdapter({ publicGet, signedPost });

    await expect(adapter.placeOrder(
      {
        apiKey: "demo-key", apiSecret: "demo-secret", passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "BTC-USDT", side: "BUY", quantity: "0.03", leverage: 3,
        clientOrderId: "drift-entry", referencePrice: "100", maxAdverseDriftBps: 10,
      },
    )).rejects.toMatchObject({
      code: ExchangeErrorCode.INVALID_REQUEST,
      exchangeCode: "ENTRY_PRICE_DRIFT",
      retryable: false,
    });
    expect(signedPost).toHaveBeenCalledTimes(1);
  });

  it("keeps a partially-filled maker entry without submitting excess market quantity", async () => {
    let canceled = false;
    const signedPost = vi.fn().mockImplementation(
      (path: string, _credentials: unknown, body: Record<string, unknown>) => {
        if (path === "/api/v5/account/set-leverage") return [{ lever: "3" }];
        if (path === "/api/v5/trade/cancel-order") {
          canceled = true;
          return [{ ordId: "maker-1", clOrdId: "maker-entry", sCode: "0", sMsg: "" }];
        }
        return [{ ordId: "maker-1", clOrdId: body.clOrdId, sCode: "0", sMsg: "" }];
      },
    );
    const signedGet = vi.fn().mockImplementation((path: string) => path === "/api/v5/account/max-size" ? [{
      instId: "BTC-USDT-SWAP", maxBuy: "1000000", maxSell: "1000000",
    }] : [{
      instId: "BTC-USDT-SWAP", ordId: "maker-1", clOrdId: "maker-entry",
      side: "buy", ordType: "post_only", state: canceled ? "canceled" : "partially_filled",
      px: "67233.1", avgPx: "67233.1", sz: "3", accFillSz: "1",
    }]);
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce([{
        instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live",
        settleCcy: "USDT", ctVal: "0.01", tickSz: "0.1", lotSz: "1", minSz: "1",
      }])
      .mockResolvedValueOnce([{
        instId: "BTC-USDT-SWAP", last: "67233.15", bidPx: "67233.1", askPx: "67233.2",
        high24h: "68000", low24h: "65000", vol24h: "100", volCcy24h: "1000",
        open24h: "67100", ts: "1700000000000",
      }]);
    const adapter = okxAdapter(
      { publicGet, signedGet, signedPost },
      { get: (key: string) => key === "OKX_MAKER_FIRST_ENABLED" ? true : key.includes("TIMEOUT") ? 5 : 1 } as never,
    );

    const order = await adapter.placeOrder(
      {
        apiKey: "demo-key", apiSecret: "demo-secret", passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "BTC-USDT", side: "BUY", quantity: "0.03", leverage: 3,
        clientOrderId: "maker-entry", stopLoss: "65000", takeProfit: "68000",
      },
    );

    const placedOrders = signedPost.mock.calls.filter(([path]) => path === "/api/v5/trade/order");
    expect(placedOrders).toHaveLength(1);
    expect(order).toMatchObject({
      exchangeOrderId: "maker-1", type: "LIMIT", timeInForce: "POST_ONLY",
      status: "PARTIALLY_FILLED", executedQuantity: "0.01",
    });
  });

  it("keeps OKX reduce-only exits as market orders when maker-first is enabled", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([
        { ordId: "exit-1", clOrdId: "stop-exit", sCode: "0", sMsg: "" },
      ]);
    const publicGet = vi.fn().mockResolvedValueOnce([{
      instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live",
      settleCcy: "USDT", ctVal: "0.01", tickSz: "0.1", lotSz: "1", minSz: "1",
    }]);
    const adapter = okxAdapter(
      { publicGet, signedPost },
      { get: () => true } as never,
    );

    await adapter.placeOrder(
      {
        apiKey: "demo-key", apiSecret: "demo-secret", passphrase: "demo-passphrase",
        environment: ExchangeEnvironment.DEMO,
      },
      {
        symbol: "BTC-USDT", side: "SELL", quantity: "0.03", leverage: 3,
        clientOrderId: "stop-exit", reduceOnly: true,
      },
    );

    expect(signedPost).toHaveBeenNthCalledWith(
      1,
      "/api/v5/trade/order",
      expect.anything(),
      expect.objectContaining({ ordType: "market", reduceOnly: true }),
    );
    expect(publicGet).toHaveBeenCalledTimes(1);
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
    const adapter = okxAdapter({
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
    });

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

  it("fails an opening order closed if leverage setup fails", async () => {
    const signedPost = vi
      .fn()
      .mockRejectedValueOnce(new Error("leverage setup failed"));
    const adapter = okxAdapter({
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
    });

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
    ).rejects.toMatchObject({
      code: ExchangeErrorCode.UNKNOWN,
      retryable: true,
      message: "OKX leverage setup failed for BTC-USDT-SWAP",
    });
    expect(signedPost).toHaveBeenCalledTimes(1);
  });

  it("caps OKX client order ids to the supported length", async () => {
    const signedPost = vi
      .fn()
      .mockResolvedValueOnce([{ lever: "3" }])
      .mockResolvedValueOnce([
        { ordId: "123", clOrdId: "phase9-order", sCode: "0", sMsg: "" },
      ]);
    const adapter = okxAdapter({
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
    });

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
