import { describe, expect, it, vi } from "vitest";
import { PaperTradingService } from "../../src/modules/paper-trading/application/paper-trading.service";

describe("paper trading decision flow", () => {
  it("turns a LONG pipeline decision into one filled order and one position idempotently", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    type Row = Record<string, unknown>;
    const state: {
      account?: Row;
      position?: Row;
      orders: Row[];
      signals: Row[];
    } = { orders: [], signals: [] };
    const tx = {
      riskAssessment: { findUnique: vi.fn(() => null) },
      paperSignal: {
        findUnique: vi.fn(
          ({ where }: { where: { pipelineRunId: string } }) =>
            state.signals.find(
              (row) => row.pipelineRunId === where.pipelineRunId,
            ) ?? null,
        ),
        create: vi.fn(({ data }: { data: Row }) => {
          const row = {
            id: `signal-${state.signals.length + 1}`,
            createdAt: now,
            ...data,
          };
          state.signals.push(row);
          return row;
        }),
      },
      paperAccount: {
        upsert: vi.fn(
          ({ create }: { create: Row }) =>
            (state.account ??= {
              id: "account-1",
              createdAt: now,
              updatedAt: now,
              marginUsed: 0,
              ...create,
            }),
        ),
        findUniqueOrThrow: vi.fn(() => state.account),
        update: vi.fn(({ data }: { data: Row }) => {
          if (!state.account) throw new Error("missing account");
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === "object" && "increment" in value)
              state.account[key] =
                Number(state.account[key]) + Number(value.increment);
            else if (value && typeof value === "object" && "decrement" in value)
              state.account[key] =
                Number(state.account[key]) - Number(value.decrement);
            else state.account[key] = value;
          }
          return state.account;
        }),
      },
      paperPosition: {
        findUnique: vi.fn(() => state.position ?? null),
        create: vi.fn(
          ({ data }: { data: Row }) =>
            (state.position = {
              id: "position-1",
              openedAt: now,
              updatedAt: now,
              realizedPnL: 0,
              ...data,
            }),
        ),
        update: vi.fn(
          ({ data }: { data: Row }) =>
            (state.position = { ...state.position, ...data, updatedAt: now }),
        ),
        findMany: vi.fn(() => (state.position ? [state.position] : [])),
      },
      simulatedOrder: {
        findFirst: vi.fn(() => null),
        create: vi.fn(({ data }: { data: Row }) => {
          const row = {
            id: `order-${state.orders.length + 1}`,
            createdAt: now,
            ...data,
          };
          state.orders.push(row);
          return row;
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const exchanges = {
      ticker: vi
        .fn()
        .mockResolvedValue({ lastPrice: "50000", markPrice: "50000" }),
    };
    const config = {
      values: {
        enabled: true,
        mode: "PAPER_TRADING",
        initialBalance: 10_000,
        riskPerTrade: 0.02,
        leverage: 3,
        feeRate: 0.0004,
        slippageMin: 0.0002,
        slippageMax: 0.001,
        cooldownMs: 60_000,
        stopLoss: 0.02,
        takeProfit: 0.04,
      },
    };
    const risk = {
      assess: vi
        .fn()
        .mockResolvedValue({
          approved: true,
          positionSize: 0.004,
          leverage: 3,
          stopLoss: 49_000,
          takeProfit: 52_000,
          riskScore: 40,
        }),
    };
    const service = new PaperTradingService(
      prisma as never,
      exchanges as never,
      config as never,
      risk as never,
    );
    const input = {
      userId: "user-1",
      pipelineRunId: "00000000-0000-4000-8000-000000000001",
      symbol: "BTC-USDT",
      provider: "BINANCE_FUTURES" as const,
      decision: { decision: "LONG", confidence: 80 } as never,
    };

    await expect(service.execute(input)).resolves.toMatchObject({
      outcome: "POSITION_OPENED",
      price: 50_000,
    });
    expect(state.position).toMatchObject({
      symbol: "BTC-USDT",
      side: "LONG",
      leverage: 3,
    });
    expect(Number(state.position?.size)).toBeCloseTo(0.004);
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({ side: "BUY", purpose: "OPEN" });
    expect(Number(state.account?.balance)).toBeLessThan(10_000);

    await service.execute(input);
    expect(state.orders).toHaveLength(1);
    expect(state.signals).toHaveLength(1);
  });
});
