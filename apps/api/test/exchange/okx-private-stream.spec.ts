import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import type { PublicExchangeService } from "../../src/exchange/application/public-exchange.service";
import { ExchangeEnvironment } from "../../src/exchange/domain/exchange.types";
import { OkxPrivateStreamService } from "../../src/exchange/infrastructure/okx/okx-private-stream.service";

describe("OKX private WebSocket cache", () => {
  it("serves pushed account and position state without another REST read", async () => {
    const service = new OkxPrivateStreamService(
      { sign: vi.fn().mockReturnValue("signature") },
      { instruments: vi.fn().mockResolvedValue([]) } as unknown as PublicExchangeService,
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
    const state = {
      connectionId: "connection-1",
      credentials: {
        apiKey: "key",
        apiSecret: "secret",
        passphrase: "passphrase",
        environment: ExchangeEnvironment.PRODUCTION,
      },
      connected: true,
      stopped: false,
      reconnectAttempts: 0,
      lastMessageAt: Date.now(),
      instruments: new Map([["BTC-USDT-SWAP", "0.01"]]),
      positions: new Map(),
      positionsInitialized: false,
      orders: new Map(),
      ordersSeeded: false,
    };
    const states = Reflect.get(service, "states") as Map<string, unknown>;
    const updateAccount = Reflect.get(service, "updateAccount") as (
      target: unknown,
      data: Array<Record<string, unknown>>,
    ) => void;
    const updatePositions = Reflect.get(service, "updatePositions") as (
      target: unknown,
      data: Array<Record<string, unknown>>,
    ) => void;
    states.set("connection-1", state);
    updateAccount.call(service, state, [
      {
        totalEq: "1000",
        availEq: "800",
        upl: "12",
        uTime: "1787191200000",
        details: [
          { ccy: "USDT", cashBal: "900", availBal: "800", upl: "12" },
        ],
      },
    ]);
    updatePositions.call(service, state, [
      {
        instId: "BTC-USDT-SWAP",
        pos: "2",
        posSide: "long",
        avgPx: "60000",
        upl: "4",
        uTime: "1787191200000",
      },
    ]);
    const accountFallback = vi.fn();
    const positionFallback = vi.fn();

    await expect(
      service.account("connection-1", state.credentials, accountFallback),
    ).resolves.toMatchObject({ totalEquity: "1000", availableBalance: "800" });
    await expect(
      service.positions("connection-1", state.credentials, positionFallback),
    ).resolves.toEqual([
      expect.objectContaining({ symbol: "BTC-USDT", quantity: "0.02", side: "LONG" }),
    ]);
    expect(accountFallback).not.toHaveBeenCalled();
    expect(positionFallback).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it("normalizes empty account balances to zero before exposing them as account snapshots", async () => {
    const service = new OkxPrivateStreamService(
      { sign: vi.fn().mockReturnValue("signature") },
      { instruments: vi.fn().mockResolvedValue([]) } as unknown as PublicExchangeService,
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
    const state = {
      connectionId: "connection-empty-balance",
      credentials: {
        apiKey: "key",
        apiSecret: "secret",
        passphrase: "passphrase",
        environment: ExchangeEnvironment.PRODUCTION,
      },
      connected: true,
      stopped: false,
      reconnectAttempts: 0,
      lastMessageAt: Date.now(),
      instruments: new Map(),
      positions: new Map(),
      positionsInitialized: false,
      orders: new Map(),
      ordersSeeded: false,
    };
    const states = Reflect.get(service, "states") as Map<string, unknown>;
    const updateAccount = Reflect.get(service, "updateAccount") as (
      target: unknown,
      data: Array<Record<string, unknown>>,
    ) => void;
    states.set("connection-empty-balance", state);
    updateAccount.call(service, state, [{
      totalEq: "85125.1901335633",
      availEq: "",
      upl: "12.5",
      uTime: "1787191200000",
      details: [{ ccy: "USDT", cashBal: "90000", availBal: "", upl: "12.5" }],
    }]);

    await expect(
      service.account("connection-empty-balance", state.credentials, vi.fn()),
    ).resolves.toMatchObject({
      totalEquity: "85125.1901335633",
      availableBalance: "0",
      totalUnrealizedPnl: "12.5",
    });
  });

  it("removes terminal orders from the ephemeral open-order cache", () => {
    const service = new OkxPrivateStreamService(
      { sign: vi.fn() },
      { instruments: vi.fn().mockResolvedValue([]) } as unknown as PublicExchangeService,
      { get: vi.fn().mockReturnValue(undefined) } as never,
    );
    const state = { orders: new Map() };
    const updateOrders = Reflect.get(service, "updateOrders") as (
      target: unknown,
      data: Array<Record<string, unknown>>,
    ) => void;
    const base = {
      instId: "ETH-USDT-SWAP",
      ordId: "order-1",
      clOrdId: "client-1",
      side: "buy",
      ordType: "limit",
      px: "3000",
      sz: "1",
      accFillSz: "0",
    };
    updateOrders.call(service, state, [{ ...base, state: "live" }]);
    expect(state.orders.size).toBe(1);
    updateOrders.call(service, state, [{ ...base, state: "filled", accFillSz: "1" }]);
    expect(state.orders.size).toBe(0);
  });

  it("uses the in-memory private stream for stale-but-usable connection snapshots", async () => {
    const service = new OkxPrivateStreamService(
      { sign: vi.fn().mockReturnValue("signature") },
      { instruments: vi.fn().mockResolvedValue([]) } as unknown as PublicExchangeService,
      { get: vi.fn().mockImplementation((key: string) => {
        if (key === "OKX_PRIVATE_WS_STALE_FALLBACK_MS") return 30_000;
        return undefined;
      }) } as never,
    );

    const credentials = {
      apiKey: "key",
      apiSecret: "secret",
      passphrase: "passphrase",
      environment: ExchangeEnvironment.PRODUCTION,
    };
    const state = {
      connectionId: "connection-2",
      credentials,
      connected: false,
      stopped: false,
      reconnectAttempts: 0,
      lastMessageAt: Date.now(),
      disconnectedAt: Date.now() - 20_000,
      instruments: new Map(),
      positions: new Map([["BTC-USDT-SWAP:long", {
        symbol: "BTC-USDT",
        side: "LONG",
        quantity: "0.02",
        entryPrice: "60000",
      }]]),
      positionsInitialized: true,
      orders: new Map(),
      ordersSeeded: true,
    };

    const states = Reflect.get(service, "states") as Map<string, typeof state>;
    states.set("connection-2", state);

    const fallback = vi.fn().mockResolvedValue([]);
    await expect(service.positions("connection-2", credentials, fallback)).resolves.toEqual([
      expect.objectContaining({ symbol: "BTC-USDT", quantity: "0.02", side: "LONG" }),
    ]);
    expect(fallback).not.toHaveBeenCalled();
  });
});
