import { describe, expect, it, vi } from "vitest";
import { OnChainMetricsGetTool } from "../../src/modules/ai-tools/infrastructure/tools/onchain-tools";

describe("OnChainMetricsGetTool", () => {
  it("requests only daily metrics confirmed by the Coin Metrics catalog", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        body: JSON.stringify({
          data: [
            {
              asset: "btc",
              metrics: [
                { metric: "AdrActCnt", frequencies: [{ frequency: "1d" }] },
                { metric: "TxCnt", frequencies: [{ frequency: "1h" }] },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        body: JSON.stringify({
          data: [
            {
              asset: "btc",
              time: "2026-08-17T00:00:00.000Z",
              AdrActCnt: "100",
            },
          ],
        }),
      });
    const tool = new OnChainMetricsGetTool({ fetch } as never);

    const result = await tool.execute(
      { symbol: "BTC-USDT", lookbackHours: 168 },
      {} as never,
    );

    expect(result.coverage).toBe("AVAILABLE");
    expect(result.metrics).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const timeseriesRequest = fetch.mock.calls[1]?.[0] as { url: string };
    expect(timeseriesRequest.url).toContain("metrics=AdrActCnt");
    expect(timeseriesRequest.url).not.toContain("TxCnt");
  });

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
