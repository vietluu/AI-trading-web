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

  it("publishes exchange-native mark price and PnL updates to dashboard listeners", () => {
    const service = new OkxPrivateStreamService(
      { sign: vi.fn().mockReturnValue("signature") },
      { instruments: vi.fn().mockResolvedValue([]) } as unknown as PublicExchangeService,
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
    const state = {
      connectionId: "connection-realtime",
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
      instruments: new Map([["BNB-USDT-SWAP", "0.1"]]),
      positions: new Map(),
      positionsInitialized: false,
      orders: new Map(),
      ordersSeeded: false,
    };
    const states = Reflect.get(service, "states") as Map<string, unknown>;
    states.set(state.connectionId, state);
    const listener = vi.fn();
    const unsubscribe = service.subscribePositions(state.connectionId, listener);
    const updatePositions = Reflect.get(service, "updatePositions") as (
      target: unknown,
      data: Array<Record<string, unknown>>,
    ) => void;

    updatePositions.call(service, state, [{
      instId: "BNB-USDT-SWAP",
      pos: "16",
      posSide: "long",
      avgPx: "661.9",
      markPx: "662.2",
      upl: "0.48",
      notionalUsd: "1059.52",
      uTime: "1787191200000",
    }]);

    expect(listener).toHaveBeenLastCalledWith({
      connectionId: state.connectionId,
      positions: [expect.objectContaining({
        symbol: "BNB-USDT",
        quantity: "1.6",
        markPrice: "662.2",
        unrealizedPnl: "0.48",
      })],
    });
    unsubscribe();
    service.onModuleDestroy();
  });

  it("extracts available balance from cashBal or availEq when availBal is empty", async () => {
    const service = new OkxPrivateStreamService(
      { sign: vi.fn().mockReturnValue("signature") },
      { instruments: vi.fn().mockResolvedValue([]) } as unknown as PublicExchangeService,
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
    const state = {
      connectionId: "connection-multi-currency",
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
    states.set("connection-multi-currency", state);
    updateAccount.call(service, state, [{
      totalEq: "85125.19",
      availEq: "75000",
      upl: "12.5",
      uTime: "1787191200000",
      details: [{ ccy: "USDT", cashBal: "90000", availBal: "", availEq: "75000", upl: "12.5" }],
    }]);

    await expect(
      service.account("connection-multi-currency", state.credentials, vi.fn()),
    ).resolves.toMatchObject({
      totalEquity: "85125.19",
      availableBalance: "75000",
      totalUnrealizedPnl: "12.5",
      canTrade: true,
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
