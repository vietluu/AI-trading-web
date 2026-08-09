import { describe, expect, it } from "vitest";

import { buildMarketResearchSummary } from "@/components/dashboard/market-research-report";
import type { PipelineRun } from "@/services/ai-feature.service";

function run(
  id: string,
  symbol: string,
  decision: "LONG" | "SHORT" | "WAIT",
  confidence: number,
  createdAt: string,
): PipelineRun {
  return {
    id,
    symbol,
    provider: "OKX_FUTURES",
    status: "COMPLETED",
    decision,
    confidence,
    dataQuality: "GOOD",
    trigger: "SCHEDULE",
    createdAt,
    steps: [],
    alerts: [],
    result: {
      decision,
      confidence,
      reasoning: `${symbol} agent conclusion`,
      regime: { type: "TRENDING", confidence: 80 },
      risks: ["Volatility can invalidate the setup"],
      opportunityScore: 75,
      riskScore: 35,
    },
  };
}

describe("market research report", () => {
  it("creates a bullish bias only from completed agent evidence", () => {
    const summary = buildMarketResearchSummary([
      run("1", "BTC-USDT", "LONG", 76, "2026-08-09T03:00:00.000Z"),
      run("2", "ETH-USDT", "LONG", 72, "2026-08-09T02:00:00.000Z"),
      run("3", "SOL-USDT", "WAIT", 64, "2026-08-09T01:00:00.000Z"),
    ]);

    expect(summary.conclusion).toBe("BULLISH_BIAS");
    expect(summary.longCount).toBe(2);
    expect(summary.waitCount).toBe(1);
    expect(summary.dominantRegime).toBe("TRENDING");
  });

  it("keeps a cautious conclusion when agent directions conflict", () => {
    const summary = buildMarketResearchSummary([
      run("1", "BTC-USDT", "LONG", 70, "2026-08-09T03:00:00.000Z"),
      run("2", "ETH-USDT", "SHORT", 72, "2026-08-09T02:00:00.000Z"),
    ]);

    expect(summary.conclusion).toBe("CAUTIOUS");
  });

  it("does not invent a market conclusion without completed reasoning", () => {
    const summary = buildMarketResearchSummary([]);

    expect(summary.conclusion).toBe("INSUFFICIENT_DATA");
    expect(summary.research).toEqual([]);
  });
});
