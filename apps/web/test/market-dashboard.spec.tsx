import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketDashboard } from "../src/components/market/MarketDashboard";

let staleStatus = false;

const socket = vi.hoisted(() => {
  const handlers = new Map<string, (payload?: unknown) => void>();
  return {
    handlers,
    emit: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
      if (event === "connect") queueMicrotask(() => handler());
    }),
  };
});

vi.mock("socket.io-client", () => ({ io: vi.fn(() => socket) }));
vi.mock("../src/components/market/TradingChart", () => ({
  TradingChart: ({
    realtimeUpdate,
  }: {
    realtimeUpdate?: { close: number };
  }) => (
    <div data-testid="trading-chart">
      Realtime close: {realtimeUpdate?.close ?? "none"}
    </div>
  ),
}));

function responseFor(url: string): Response {
  if (url.includes("/candles/")) {
    return Response.json([
      {
        provider: "BINANCE_FUTURES",
        symbol: "BTC-USDT",
        interval: "1h",
        openTime: "2026-08-01T00:00:00.000Z",
        open: "100",
        high: "102",
        low: "99",
        close: "101",
      },
    ]);
  }
  if (url.includes("/klines/")) {
    return Response.json([
      {
        provider: "BINANCE_FUTURES",
        symbol: "BTC-USDT",
        interval: "1h",
        openTime: "2026-08-01T01:00:00.000Z",
        open: "101",
        high: "103",
        low: "100",
        close: "102",
      },
    ]);
  }
  if (url.includes("/ticker/")) {
    return Response.json({
      provider: "BINANCE_FUTURES",
      symbol: "BTC-USDT",
      lastPrice: "101",
      volume24h: "1250",
    });
  }
  if (url.includes("/status/")) {
    return Response.json({
      provider: "BINANCE_FUTURES",
      state: staleStatus ? "STALE" : "CONNECTED",
      lastMessageAt: staleStatus
        ? "2026-07-31T00:00:00.000Z"
        : new Date().toISOString(),
      messageCount: 42,
    });
  }
  if (url.includes("/funding-rate/")) {
    return Response.json({ fundingRate: "0.0001" });
  }
  if (url.includes("/open-interest/")) {
    return Response.json({ openInterest: "12345", timestamp: new Date() });
  }
  if (url.includes("/indicators/")) {
    return Response.json({
      values: { sma20: "100.25", ema20: "100.5", rsi14: "55" },
    });
  }
  return Response.json({});
}

describe("MarketDashboard", () => {
  beforeEach(() => {
    socket.handlers.clear();
    staleStatus = false;
    socket.emit.mockClear();
    socket.close.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(responseFor(String(input))),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders market controls and Phase 4 metrics", async () => {
    render(<MarketDashboard apiBaseUrl="http://localhost:3001" />);

    expect(screen.getByText("Realtime market")).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Exchange" })).toBeDefined();
    expect(
      screen.getByRole("combobox", { name: "Trading pair" }),
    ).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Timeframe" })).toBeDefined();
    expect(await screen.findByText("0.01%")).toBeDefined();
    expect(await screen.findByText("12,345")).toBeDefined();
    expect(await screen.findByText("100.25")).toBeDefined();
    expect(await screen.findByText("Realtime close: 102")).toBeDefined();
  });

  it("reloads history when pair and timeframe change", async () => {
    render(<MarketDashboard apiBaseUrl="http://localhost:3001" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Trading pair" }), {
      target: { value: "ETH-USDT" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Timeframe" }), {
      target: { value: "15m" },
    });

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/market/candles/BINANCE_FUTURES/ETH-USDT?interval=15m",
        ),
        expect.any(Object),
      );
    });
  });

  it("applies realtime candle events to the chart", async () => {
    render(<MarketDashboard apiBaseUrl="http://localhost:3001" />);
    await screen.findByTestId("trading-chart");

    socket.handlers.get("candle")?.({
      provider: "BINANCE_FUTURES",
      symbol: "BTC-USDT",
      interval: "1h",
      openTime: "2026-08-01T01:00:00.000Z",
      open: "101",
      high: "104",
      low: "100",
      close: "103",
    });

    expect(await screen.findByText("Realtime close: 103")).toBeDefined();
  });

  it("shows a warning when the provider stream is stale", async () => {
    staleStatus = true;
    render(<MarketDashboard apiBaseUrl="http://localhost:3001" />);

    expect(await screen.findByText("Market stream is stale")).toBeDefined();
  });
});
