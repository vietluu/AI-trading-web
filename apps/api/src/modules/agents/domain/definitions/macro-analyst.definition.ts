import {
  MacroAgentInputSchema,
  MacroAgentOutputSchema,
  type MacroAgentInput,
  type MacroAgentOutput,
} from "@platform/shared";
import type { AgentDefinition } from "../models/agent-definition.model";
import {
  AgentContextSection,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentStatus,
  AgentType,
} from "../enums";

export const MACRO_ANALYST_ALLOWED_TOOLS = ["macro.events.list"] as const;

function deterministicMacro(
  toolData: Readonly<Record<string, unknown>>,
): MacroAgentOutput {
  const observation = toolData["macro.events.list"] as
    Record<string, unknown> | undefined;
  const events = Array.isArray(observation?.events)
    ? observation.events.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
  if (events.length === 0) {
    return {
      summary:
        "No scheduled high-impact macro event falls inside the active window.",
      macroTrend: "NEUTRAL",
      keyEvents: [],
      riskFactors: [],
      dataQuality: "PARTIAL",
      generatedAt: new Date().toISOString(),
    };
  }
  const highImpact = events.filter((event) => event.importance === "HIGH");
  const safeText = (value: unknown, fallback: string) =>
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : fallback;
  return {
    summary: `${events.length} official macro calendar event(s) fall inside the active window; ${highImpact.length} are high impact.`,
    macroTrend: "NEUTRAL",
    keyEvents: events
      .slice(0, 10)
      .map(
        (event) =>
          `${safeText(event.name, "Macro event")} at ${safeText(event.scheduledAt, "unknown time")}`,
      ),
    riskFactors: highImpact.map(
      (event) =>
        `High-impact event risk: ${safeText(event.name, "macro release")}`,
    ),
    dataQuality: "GOOD",
    generatedAt: new Date().toISOString(),
  };
}

export const MACRO_ANALYST_DEFINITION: AgentDefinition<
  MacroAgentInput,
  MacroAgentOutput
> = {
  type: AgentType.MACRO_ANALYST,
  version: 1,
  displayName: "Macro Analyst Agent",
  description:
    "Analyzes macroeconomic events, monetary policy, inflation, and global liquidity conditions.",
  status: AgentStatus.ACTIVE,
  executionMode: AgentExecutionMode.SYNCHRONOUS,
  inputSchema: MacroAgentInputSchema,
  outputSchema: MacroAgentOutputSchema,
  promptId: "macro_analyst_v1",
  promptVersion: 1,
  allowedToolNames: [...MACRO_ANALYST_ALLOWED_TOOLS],
  requiredCapabilities: ["READ_MACRO"],
  memoryPolicy: {
    mode: AgentMemoryMode.NONE,
    readTypes: [],
    writeTypes: [],
    maxItems: 0,
    persistFinalOutput: false,
  },
  contextPolicy: {
    allowedSections: [AgentContextSection.MACRO],
    requiredSections: [],
    maximumAgeSecondsBySection: { [AgentContextSection.MACRO]: 24 * 60 * 60 },
    maxItemsBySection: { [AgentContextSection.MACRO]: 50 },
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
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    retryableErrorCodes: ["AGENT_PROVIDER_UNAVAILABLE", "AGENT_TIMEOUT"],
  },
  timeoutMs: 60_000,
  maxToolRounds: 1,
  maxToolCalls: 1,
  maxInputTokens: 8_000,
  maxOutputTokens: 1_500,
  requiresUserContext: false,
  allowsPublicSystemRun: true,
  buildToolCalls: (input) => [
    {
      toolName: "macro.events.list",
      arguments: { lookbackHours: input.lookbackHours, limit: 50 },
    },
  ],
  buildDeterministicOutput: deterministicMacro,
  buildInsufficientOutput: (_usedTools, reason) => ({
    summary: `Macro analysis could not be completed reliably: ${reason}`,
    macroTrend: "NEUTRAL",
    keyEvents: [],
    riskFactors: ["Insufficient current macroeconomic event data."],
    dataQuality: "INSUFFICIENT",
    generatedAt: new Date().toISOString(),
  }),
};
