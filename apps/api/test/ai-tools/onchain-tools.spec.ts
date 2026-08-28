import { describe, expect, it, vi } from "vitest";
import { OnChainMetricsGetTool } from "../../src/modules/ai-tools/infrastructure/tools/onchain-tools";
import { ON_CHAIN_ANALYST_DEFINITION } from "../../src/modules/agents/domain/definitions/on-chain-analyst.definition";
import type { ExternalHttpClient } from "../../src/modules/external-data/infrastructure/http/external-http-client";

describe("OnChainMetricsGetTool & OnChain Analyst provenance and fallback", () => {
  it("returns UNAVAILABLE coverage without throwing when asset has no catalog metrics", async () => {
    const http = {
      fetch: vi.fn().mockResolvedValue({
        body: JSON.stringify({ data: [] }),
      }),
    } as unknown as ExternalHttpClient;

    const tool = new OnChainMetricsGetTool(http);
    const result = await tool.execute({ symbol: "UNSUPPORTED-COIN" }, {} as never);

    expect(result.coverage).toBe("UNAVAILABLE");
    expect(result.metrics).toEqual([]);
    expect(result.warning).toContain("no supported daily network metrics");
  });

  it("returns UNAVAILABLE coverage without throwing when timeseries rows are empty", async () => {
    const http = {
      fetch: vi.fn()
        // Catalog response: has asset with AdrActCnt
        .mockResolvedValueOnce({
          body: JSON.stringify({
            data: [
              {
                asset: "emptyasset",
                metrics: [{ metric: "AdrActCnt", frequencies: [{ frequency: "1d" }] }],
              },
            ],
          }),
        })
        // Timeseries response: empty array
        .mockResolvedValueOnce({
          body: JSON.stringify({ data: [] }),
        }),
    } as unknown as ExternalHttpClient;

    const tool = new OnChainMetricsGetTool(http);
    const result = await tool.execute({ symbol: "EMPTYASSET-USDT" }, {} as never);

    expect(result.coverage).toBe("UNAVAILABLE");
    expect(result.metrics).toEqual([]);
  });

  it("builds INSUFFICIENT deterministic output with EMPTY provenance for unavailable asset", () => {
    const output = ON_CHAIN_ANALYST_DEFINITION.buildDeterministicOutput?.({
      "onchain.metrics.get": {
        provider: "COIN_METRICS",
        asset: "unknown",
        metrics: [],
        coverage: "UNAVAILABLE",
      },
    }, ["onchain.metrics.get"]);
    expect(output).toBeDefined();

    expect(output?.dataQuality).toBe("INSUFFICIENT");
    expect(output?.activity).toBe("NORMAL");
    expect(output?.flows).toEqual({});
    expect(output?.provenance?.coverage).toBe("EMPTY");
    expect(output?.provenance?.dataQualityReason).toBe("ASSET_NOT_SUPPORTED_BY_ONCHAIN_PROVIDER");
  });

  it("builds PARTIAL deterministic output when only network activity is present", () => {
    const output = ON_CHAIN_ANALYST_DEFINITION.buildDeterministicOutput?.({
      "onchain.metrics.get": {
        provider: "COIN_METRICS",
        asset: "btc",
        metrics: [
          { time: "2026-08-27T00:00:00Z", AdrActCnt: 900000 },
          { time: "2026-08-28T00:00:00Z", AdrActCnt: 950000 },
        ],
        coverage: "AVAILABLE",
      },
    }, ["onchain.metrics.get"]);
    expect(output).toBeDefined();

    expect(output?.dataQuality).toBe("PARTIAL");
    expect(output?.provenance?.coverage).toBe("PARTIAL");
    expect(output?.provenance?.unavailableFields).toEqual(["exchangeInflow", "exchangeOutflow"]);
  });

  it("builds GOOD deterministic output with FULL provenance when exchange flows are present", () => {
    const output = ON_CHAIN_ANALYST_DEFINITION.buildDeterministicOutput?.({
      "onchain.metrics.get": {
        provider: "COIN_METRICS",
        asset: "btc",
        metrics: [
          {
            time: "2026-08-27T00:00:00Z",
            AdrActCnt: 900000,
            FlowInExUSD: "500000000",
            FlowOutExUSD: "450000000",
          },
          {
            time: "2026-08-28T00:00:00Z",
            AdrActCnt: 950000,
            FlowInExUSD: "600000000",
            FlowOutExUSD: "400000000",
          },
        ],
        coverage: "AVAILABLE",
      },
    }, ["onchain.metrics.get"]);
    expect(output).toBeDefined();

    expect(output?.dataQuality).toBe("GOOD");
    expect(output?.provenance?.coverage).toBe("FULL");
    expect(output?.provenance?.unavailableFields).toEqual([]);
    expect(output?.flows.exchangeInflow).toBe("600000000");
  });
});
