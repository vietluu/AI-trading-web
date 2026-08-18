import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ExternalHttpClient } from "../../../external-data/infrastructure/http/external-http-client";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";

interface CoinMetricsRow extends Record<string, unknown> {
  asset?: string;
  time?: string;
}

interface CoinMetricsCatalogAsset extends Record<string, unknown> {
  asset?: string;
  metrics?: Array<{
    metric?: string;
    frequencies?: Array<{ frequency?: string }>;
  }>;
}

@Injectable()
export class OnChainMetricsGetTool implements ToolDefinition<
  { symbol: string; lookbackHours?: number },
  Record<string, unknown>
> {
  constructor(private readonly http: ExternalHttpClient) {}

  readonly name = "onchain.metrics.get";
  readonly version = 1;
  readonly displayName = "Get On-chain Network Metrics";
  readonly description =
    "Fetch verified daily active-address, transaction-count and adjusted transfer-volume metrics from Coin Metrics";
  readonly category = "FUTURE_ON_CHAIN" as const;
  readonly inputSchema = z.object({
    symbol: z.string().min(1).max(32),
    lookbackHours: z.number().int().min(24).max(720).optional().default(168),
  });
  readonly outputSchema = z.object({
    provider: z.literal("COIN_METRICS"),
    asset: z.string(),
    sourceUrl: z.string().url(),
    metrics: z.array(z.record(z.unknown())),
    coverage: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    warning: z.string().optional(),
    observedAt: z.string().datetime(),
  });
  readonly executionMode = "SYNCHRONOUS" as const;
  readonly sensitivity = "PUBLIC" as const;
  readonly sideEffect = "READ_ONLY" as const;
  readonly cachePolicy = {
    type: "SOURCE_TIMESTAMP_AWARE" as const,
    ttlSeconds: 900,
  };
  readonly retryPolicy = {
    maxAttempts: 2,
    baseDelayMs: 300,
    maxDelayMs: 1500,
    retryableErrors: ["TIMEOUT"],
  };
  readonly timeoutMs = 10_000;
  readonly requiresAuthentication = false;
  readonly userScoped = false;
  readonly allowedAgentTypes = ["ON_CHAIN_ANALYST"];
  readonly requiredCapabilities = ["READ_ONCHAIN_DATA" as const];
  readonly status = "ACTIVE" as const;
  readonly schemaHash = "hash-onchain-metrics-get-v1";

  async execute(
    input: { symbol: string; lookbackHours?: number },
    _context: ToolExecutionContext,
  ): Promise<Record<string, unknown>> {
    void _context;
    const asset = input.symbol.trim().toLowerCase().split(/[-_/]/)[0];
    if (!asset) throw new Error("A canonical asset symbol is required");

    const apiKey = process.env.COINMETRICS_API_KEY?.trim();
    const baseUrl = apiKey
      ? "https://api.coinmetrics.io/v4/timeseries/asset-metrics"
      : "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics";
    const desiredMetrics = ["AdrActCnt", "TxCnt"];
    if (apiKey)
      desiredMetrics.push("TxTfrValAdjUSD", "FlowInExUSD", "FlowOutExUSD");
    const catalogUrl = `${apiKey ? "https://api.coinmetrics.io" : "https://community-api.coinmetrics.io"}/v4/catalog-v2/asset-metrics?${new URLSearchParams(
      {
        assets: asset,
        ...(apiKey ? { api_key: apiKey } : {}),
      },
    ).toString()}`;
    let metrics: string[] = [];
    try {
      const catalogResponse = await this.http.fetch({
        url: catalogUrl,
        timeoutMs: 10_000,
        maxResponseBytes: 512 * 1024,
      });
      const catalogPayload = JSON.parse(catalogResponse.body) as {
        data?: CoinMetricsCatalogAsset[];
      };
      const catalogAsset = catalogPayload.data?.find(
        (item) => item.asset === asset,
      );
      const dailyMetrics = new Set(
        (catalogAsset?.metrics ?? [])
          .filter((item) =>
            (item.frequencies ?? []).some(
              (frequency) => frequency.frequency === "1d",
            ),
          )
          .map((item) => item.metric)
          .filter((item): item is string => Boolean(item)),
      );
      metrics = desiredMetrics.filter((metric) => dailyMetrics.has(metric));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/HTTP error (400|403|404)/i.test(message)) throw error;
    }
    if (metrics.length === 0) {
      return {
        provider: "COIN_METRICS",
        asset,
        sourceUrl: catalogUrl.replace(/([?&]api_key=)[^&]+/, "$1REDACTED"),
        metrics: [],
        coverage: "UNAVAILABLE",
        warning: `Coin Metrics catalog has no supported daily network metrics for ${asset.toUpperCase()}.`,
        observedAt: new Date().toISOString(),
      };
    }
    const start = new Date(
      Date.now() - (input.lookbackHours ?? 168) * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const query = new URLSearchParams({
      assets: asset,
      metrics: metrics.join(","),
      frequency: "1d",
      start_time: start,
      sort: "time",
      page_size: "32",
      ...(apiKey ? { api_key: apiKey } : {}),
    });
    const sourceUrl = `${baseUrl}?${query.toString()}`;
    let response: { body: string };
    try {
      response = await this.http.fetch({
        url: sourceUrl,
        timeoutMs: 10_000,
        maxResponseBytes: 512 * 1024,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP error (400|403|404)/i.test(message)) {
        return {
          provider: "COIN_METRICS",
          asset,
          sourceUrl: sourceUrl.replace(/([?&]api_key=)[^&]+/, "$1REDACTED"),
          metrics: [],
          coverage: "UNAVAILABLE",
          warning: `Coin Metrics does not expose the requested on-chain metrics for ${asset.toUpperCase()}.`,
          observedAt: new Date().toISOString(),
        };
      }
      throw error;
    }
    const payload = JSON.parse(response.body) as { data?: CoinMetricsRow[] };
    const rows = Array.isArray(payload.data)
      ? payload.data.filter((row) => row && typeof row === "object")
      : [];
    if (rows.length === 0) {
      throw new Error(
        `Coin Metrics has no verified on-chain coverage for ${asset.toUpperCase()}`,
      );
    }

    return {
      provider: "COIN_METRICS",
      asset,
      sourceUrl: sourceUrl.replace(/([?&]api_key=)[^&]+/, "$1REDACTED"),
      metrics: rows,
      coverage: "AVAILABLE",
      observedAt: rows.at(-1)?.time ?? new Date().toISOString(),
    };
  }
}
