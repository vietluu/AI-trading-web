import { describe, expect, it, vi } from "vitest";
import { OkxFuturesAdapter } from "../../src/exchange/infrastructure/okx/okx-futures.adapter";
import type { OkxFuturesClient } from "../../src/exchange/infrastructure/okx/okx-futures.client";
import { ExchangeEnvironment } from "../../src/exchange/domain/exchange.types";
import { ExchangeErrorCode } from "../../src/exchange/domain/exchange.error";

describe("OkxFuturesAdapter", () => {
  const credentials = {
    apiKey: "test-key",
    apiSecret: "test-secret",
    passphrase: "test-passphrase",
    environment: ExchangeEnvironment.DEMO,
  };

  it("extracts balance correctly in single-currency margin mode (availBal present)", async () => {
    const mockClient = {
      signedGet: vi.fn().mockResolvedValue([
        {
          totalEq: "1500.5",
          availEq: "",
          upl: "25.0",
          uTime: "1787191200000",
          details: [
            {
              ccy: "USDT",
              cashBal: "1500.5",
              availBal: "1200.0",
              upl: "25.0",
              eq: "1500.5",
            },
          ],
        },
      ]),
    } as unknown as OkxFuturesClient;

    const adapter = new OkxFuturesAdapter(mockClient);
    const summary = await adapter.getAccountSummary(credentials);

    expect(summary.totalEquity).toBe("1500.5");
    expect(summary.availableBalance).toBe("1200.0");
    expect(summary.canTrade).toBe(true);

    const balances = await adapter.getBalances(credentials);
    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({
      asset: "USDT",
      total: "1500.5",
      available: "1200.0",
    });
  });

  it("extracts balance correctly in multi-currency margin mode (availEq present, availBal empty)", async () => {
    const mockClient = {
      signedGet: vi.fn().mockResolvedValue([
        {
          totalEq: "5000.0",
          availEq: "4500.0",
          upl: "50.0",
          uTime: "1787191200000",
          details: [
            {
              ccy: "USDT",
              cashBal: "5000.0",
              availBal: "",
              availEq: "4500.0",
              upl: "50.0",
              eq: "5000.0",
            },
          ],
        },
      ]),
    } as unknown as OkxFuturesClient;

    const adapter = new OkxFuturesAdapter(mockClient);
    const summary = await adapter.getAccountSummary(credentials);

    expect(summary.totalEquity).toBe("5000.0");
    expect(summary.availableBalance).toBe("4500.0");
    expect(summary.canTrade).toBe(true);

    const balances = await adapter.getBalances(credentials);
    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({
      asset: "USDT",
      total: "5000.0",
      available: "4500.0",
    });
  });

  it("returns canTrade: true in getAccountConfiguration", async () => {
    const mockClient = {
      signedGet: vi.fn().mockResolvedValue([
        {
          posMode: "long_short_mode",
          acctLv: "2",
        },
      ]),
    } as unknown as OkxFuturesClient;

    const adapter = new OkxFuturesAdapter(mockClient);
    const config = await adapter.getAccountConfiguration(credentials);

    expect(config.canTrade).toBe(true);
    expect(config.positionMode).toBe("HEDGE");
  });

  it("rejects protection that is inverted by the final maker entry price before order submission", async () => {
    const signedPost = vi.fn().mockResolvedValue([{ lever: "2" }]);
    const mockClient = {
      publicGet: vi
        .fn()
        .mockResolvedValueOnce([{
          instId: "ZRO-USDT-SWAP", instType: "SWAP", state: "live",
          settleCcy: "USDT", ctVal: "1", tickSz: "0.0001", lotSz: "1", minSz: "1",
        }])
        .mockResolvedValueOnce([{
          instId: "ZRO-USDT-SWAP", last: "0.9515", bidPx: "0.9514", askPx: "0.9516",
          high24h: "1.02", low24h: "0.94", vol24h: "100", volCcy24h: "1000",
          open24h: "0.98", ts: "1700000000000",
        }]),
      signedGet: vi.fn().mockResolvedValue([{
        instId: "ZRO-USDT-SWAP", maxBuy: "1000", maxSell: "1000",
      }]),
      signedPost,
    } as unknown as OkxFuturesClient;
    const adapter = new OkxFuturesAdapter(mockClient, {
      get: (key: string) => key === "OKX_MAKER_FIRST_ENABLED",
    } as never);

    await expect(adapter.placeOrder(credentials, {
      symbol: "ZRO-USDT", side: "BUY", quantity: "10", leverage: 2,
      clientOrderId: "inverted-protection", referencePrice: "0.9847",
      stopLoss: "0.9602", takeProfit: "1.0395",
    })).rejects.toMatchObject({
      code: ExchangeErrorCode.ENTRY_PROTECTION_GEOMETRY_INVALID,
      retryable: false,
    });
    expect(signedPost.mock.calls.filter(([path]) => path === "/api/v5/trade/order")).toHaveLength(0);
  });

  it("rejects SELL protection that is inverted by maker entry price above stop loss", async () => {
    const signedPost = vi.fn().mockResolvedValue([{ lever: "2" }]);
    const mockClient = {
      publicGet: vi
        .fn()
        .mockResolvedValueOnce([{
          instId: "ZRO-USDT-SWAP", instType: "SWAP", state: "live",
          settleCcy: "USDT", ctVal: "1", tickSz: "0.0001", lotSz: "1", minSz: "1",
        }])
        .mockResolvedValueOnce([{
          instId: "ZRO-USDT-SWAP", last: "0.9750", bidPx: "0.9740", askPx: "0.9760",
          high24h: "1.02", low24h: "0.94", vol24h: "100", volCcy24h: "1000",
          open24h: "0.98", ts: "1700000000000",
        }]),
      signedGet: vi.fn().mockResolvedValue([{
        instId: "ZRO-USDT-SWAP", maxBuy: "1000", maxSell: "1000",
      }]),
      signedPost,
    } as unknown as OkxFuturesClient;
    const adapter = new OkxFuturesAdapter(mockClient, {
      get: (key: string) => key === "OKX_MAKER_FIRST_ENABLED",
    } as never);

    await expect(adapter.placeOrder(credentials, {
      symbol: "ZRO-USDT", side: "SELL", quantity: "10", leverage: 2,
      clientOrderId: "inverted-sell-protection", referencePrice: "0.9650",
      stopLoss: "0.9700", takeProfit: "0.9100",
    })).rejects.toMatchObject({
      code: ExchangeErrorCode.ENTRY_PROTECTION_GEOMETRY_INVALID,
      retryable: false,
    });
    expect(signedPost.mock.calls.filter(([path]) => path === "/api/v5/trade/order")).toHaveLength(0);
  });
});
