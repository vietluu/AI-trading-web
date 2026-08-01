import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TechnicalAnalysisPage from "@/app/ai/technical-analysis/page";
import { apiRequest } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));

describe("TechnicalAnalysisPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs and displays structured technical conditions", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      id: "run-1",
      status: "COMPLETED",
      output: {
        summary: "Momentum is neutral with higher highs and higher lows.",
        trend: { direction: "UP", strength: "MODERATE" },
        momentum: {
          rsi: "58.2",
          rsiState: "NEUTRAL",
          macd: { trend: "BULLISH", crossover: "NONE" },
        },
        movingAverages: { alignment: "BULLISH", pricePosition: "ABOVE" },
        volatility: {
          atr: "1200",
          bollinger: { position: "MIDDLE", squeeze: false },
        },
        structure: { marketStructure: "HH_HL", breakout: false },
        divergence: { rsiDivergence: "NONE", macdDivergence: "NONE" },
        signals: ["EMA20 is above EMA50."],
        dataQuality: "GOOD",
        usedTools: ["market.indicators.get", "market.candles.list"],
        generatedAt: new Date().toISOString(),
      },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TechnicalAnalysisPage />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run technical analysis" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "Momentum is neutral with higher highs and higher lows.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "RSI" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MACD" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Moving averages" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Divergence" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Structure" }),
    ).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith(
      "/agents/TECHNICAL_ANALYST/runs",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
