import { describe, expect, it, vi } from "vitest";
import { OnChainMetricsGetTool } from "../../src/modules/ai-tools/infrastructure/tools/onchain-tools";

describe("OnChainMetricsGetTool", () => {
  it("degrades unsupported Coin Metrics coverage instead of failing the agent run", async () => {
    const tool = new OnChainMetricsGetTool({
      fetch: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "HTTP error 400 when fetching community-api.coinmetrics.io",
          ),
        ),
    } as never);

    const result = await tool.execute(
      { symbol: "LINK-USDT", lookbackHours: 168 },
      {} as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        provider: "COIN_METRICS",
        asset: "link",
        coverage: "UNAVAILABLE",
        metrics: [],
      }),
    );
  });

  it("continues to surface transient provider failures", async () => {
    const tool = new OnChainMetricsGetTool({
      fetch: vi.fn().mockRejectedValue(new Error("request timeout")),
    } as never);
    await expect(
      tool.execute({ symbol: "BTC-USDT" }, {} as never),
    ).rejects.toThrow("request timeout");
  });
});
