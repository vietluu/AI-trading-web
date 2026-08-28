import {
  OnChainAgentInputSchema,
  OnChainAgentOutputSchema,
  type OnChainAgentInput,
  type OnChainAgentOutput,
} from "@platform/shared";
import type { AgentDefinition } from "../models/agent-definition.model";
import {
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from "../enums";

export const ON_CHAIN_ANALYST_DEFINITION: AgentDefinition<
  OnChainAgentInput,
  OnChainAgentOutput
> = {
  type: AgentType.ON_CHAIN_ANALYST,
  version: 1,
  displayName: "On-chain Analyst Agent",
  description:
    "Analyzes verified network activity and exchange-flow metrics from Coin Metrics.",
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: OnChainAgentInputSchema,
  outputSchema: OnChainAgentOutputSchema,
  promptId: "on_chain_analyst_v1",
  promptVersion: 1,
  allowedToolNames: ["onchain.metrics.get"],
  requiredCapabilities: ["READ_ONCHAIN_DATA"],
  memoryPolicy: {
    mode: AgentMemoryMode.NONE,
    readTypes: [],
    writeTypes: [],
    maxItems: 0,
    persistFinalOutput: false,
  },
  contextPolicy: {
    allowedSections: [],
    requiredSections: [],
    maximumAgeSecondsBySection: {},
    maxItemsBySection: {},
    includeUserSettings: false,
    includeOpenPositions: false,
    includeMemory: false,
    includePreviousAgentResults: false,
  },
  modelPolicy: {
    requiresToolCalling: true,
    requiresStructuredOutput: true,
    defaultTemperature: 0,
    maximumTemperature: 0,
    fallbackProviders: ["ANTHROPIC", "GEMINI", "OLLAMA"],
    supportsStreaming: false,
  },
  retryPolicy: {
    maxRetries: 1,
    baseDelayMs: 500,
    maxDelayMs: 2_000,
    retryableErrorCodes: ["AGENT_PROVIDER_UNAVAILABLE", "AGENT_TIMEOUT"],
  },
  timeoutMs: 30_000,
  maxToolRounds: 1,
  maxToolCalls: 1,
  maxInputTokens: 2_000,
  maxOutputTokens: 1_000,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  buildToolCalls: (input) =>
    input.symbol
      ? [
          {
            toolName: "onchain.metrics.get",
            arguments: {
              symbol: input.symbol,
              lookbackHours: input.lookbackHours,
            },
          },
        ]
      : [],
  buildDeterministicOutput: (toolData) => {
    const observation = toolData["onchain.metrics.get"] as
      Record<string, unknown> | undefined;
    const rows = Array.isArray(observation?.metrics)
      ? observation.metrics.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
        )
      : [];
    if (observation?.coverage !== "AVAILABLE" || rows.length === 0) {
      return {
        summary: "Verified on-chain coverage is not applicable to this asset.",
        activity: "NORMAL",
        flows: {},
        signals: ["Coin Metrics returned no verified coverage for this asset."],
        dataQuality: "INSUFFICIENT",
        provenance: {
          provider: "COIN_METRICS",
          coverage: "EMPTY",
          unavailableFields: ["exchangeInflow", "exchangeOutflow", "activeAddresses"],
          dataQualityReason: "ASSET_NOT_SUPPORTED_BY_ONCHAIN_PROVIDER",
        },
        generatedAt: new Date().toISOString(),
      };
    }
    const latest = rows.at(-1)!;
    const previous = rows.at(-2);
    const latestActivity = Number(latest.AdrActCnt ?? latest.TxCnt);
    const previousActivity = Number(previous?.AdrActCnt ?? previous?.TxCnt);
    const change =
      Number.isFinite(latestActivity) &&
      Number.isFinite(previousActivity) &&
      previousActivity > 0
        ? (latestActivity - previousActivity) / previousActivity
        : 0;
    const inflow = latest.FlowInExUSD;
    const outflow = latest.FlowOutExUSD;
    const hasFlows = inflow != null || outflow != null;
    const safeText = (value: unknown, fallback: string) =>
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : fallback;
    return {
      summary: `${safeText(observation.asset, "Asset").toUpperCase()} has ${rows.length} verified daily network observation(s).`,
      activity: change > 0.1 ? "HIGH" : change < -0.1 ? "LOW" : "NORMAL",
      flows: {
        ...(inflow != null
          ? { exchangeInflow: safeText(inflow, "unavailable") }
          : {}),
        ...(outflow != null
          ? { exchangeOutflow: safeText(outflow, "unavailable") }
          : {}),
      },
      signals: [
        `Active network metric: ${Number.isFinite(latestActivity) ? latestActivity : "unavailable"}.`,
        !hasFlows
          ? "Verified exchange-flow metrics are unavailable; network activity only."
          : "Verified exchange-flow metrics are available.",
      ],
      dataQuality: hasFlows ? "GOOD" : "PARTIAL",
      provenance: {
        provider: "COIN_METRICS",
        sourceTimestamp: typeof latest.time === "string" ? latest.time : undefined,
        coverage: hasFlows ? "FULL" : "PARTIAL",
        unavailableFields: hasFlows ? [] : ["exchangeInflow", "exchangeOutflow"],
        dataQualityReason: hasFlows
          ? "VERIFIED_ONCHAIN_EXCHANGE_FLOWS_AVAILABLE"
          : "COMMUNITY_TIER_NETWORK_ACTIVITY_ONLY",
      },
      generatedAt: new Date().toISOString(),
    };
  },
  buildInsufficientOutput: (_usedTools, reason) => ({
    summary: `Verified on-chain data is unavailable for this asset: ${reason}`,
    activity: "NORMAL",
    flows: {},
    signals: [
      "Coin Metrics returned no verified coverage for this asset or was unavailable.",
    ],
    dataQuality: "INSUFFICIENT",
    provenance: {
      provider: "COIN_METRICS",
      coverage: "EMPTY",
      unavailableFields: ["exchangeInflow", "exchangeOutflow", "activeAddresses"],
      dataQualityReason: reason ?? "ONCHAIN_DATA_UNAVAILABLE",
    },
    generatedAt: new Date().toISOString(),
  }),
};
