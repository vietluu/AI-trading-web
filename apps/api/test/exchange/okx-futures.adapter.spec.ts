import { describe, expect, it, vi } from "vitest";
import { OkxFuturesAdapter } from "../../src/exchange/infrastructure/okx/okx-futures.adapter";
import type { OkxFuturesClient } from "../../src/exchange/infrastructure/okx/okx-futures.client";
import { ExchangeEnvironment } from "../../src/exchange/domain/exchange.types";

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
});
