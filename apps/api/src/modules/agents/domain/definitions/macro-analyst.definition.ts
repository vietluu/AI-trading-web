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

function scoreMacroTrend(
  events: Record<string, unknown>[],
): "RISK_ON" | "RISK_OFF" | "NEUTRAL" {
  let riskOffScore = 0;
  let riskOnScore = 0;
  const safe = (v: unknown): number => {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const parsed = parseFloat(v);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  };

  for (const event of events) {
    if (event.importance !== "HIGH") continue;
    const name = typeof event.name === "string" ? event.name.toLowerCase() : "";
    const actual = safe(event.actual);
    const forecast = safe(event.forecast);
    const isComparable = Number.isFinite(actual) && Number.isFinite(forecast);

    // CPI / PCE / Inflation: beat = hawkish = RISK_OFF
    if (
      name.includes("cpi") ||
      name.includes("pce") ||
      name.includes("inflation")
    ) {
      if (isComparable) {
        if (actual > forecast + 0.1) {
          riskOffScore += 2;
        } else if (actual < forecast - 0.1) {
          riskOnScore += 2;
        }
      }
    }
    // FOMC / Fed / Interest Rate: hike surprise = RISK_OFF, cut/pause = RISK_ON
    if (
      name.includes("fomc") ||
      name.includes("interest rate") ||
      name.includes("fed funds")
    ) {
      if (isComparable) {
        if (actual > forecast) {
          riskOffScore += 3;
        } else if (actual < forecast) {
          riskOnScore += 3;
        }
      }
    }
    // GDP: miss = RISK_OFF, beat = RISK_ON
    if (name.includes("gdp") || name.includes("gross domestic")) {
      if (isComparable) {
        if (actual < forecast - 0.2) {
          riskOffScore += 1;
        } else if (actual > forecast + 0.2) {
          riskOnScore += 1;
        }
      }
    }
    // Nonfarm Payrolls: miss = RISK_OFF
    if (name.includes("nonfarm") || name.includes("payroll")) {
      if (isComparable && forecast !== 0) {
        if (actual < forecast * 0.8) {
          riskOffScore += 1;
        } else if (actual > forecast * 1.2) {
          riskOnScore += 1;
        }
      }
    }
  }

  if (riskOffScore > riskOnScore + 1) return "RISK_OFF";
  if (riskOnScore > riskOffScore + 1) return "RISK_ON";
  return "NEUTRAL";
}

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
      summary: "No scheduled macro event falls inside the active window.",
      macroTrend: "NEUTRAL",
      keyEvents: [],
      riskFactors: [],
      dataQuality: "PARTIAL",
      generatedAt: new Date().toISOString(),
    };
  }

  const highImpact = events.filter((e) => e.importance === "HIGH");
  const macroTrend = scoreMacroTrend(events);
  const safeText = (v: unknown, fb: string) =>
    typeof v === "string" || typeof v === "number" ? String(v) : fb;

  return {
    summary: `${events.length} macro event(s) in window; ${highImpact.length} high-impact. Macro regime: ${macroTrend}.`,
    macroTrend,
    keyEvents: events
      .slice(0, 10)
      .map(
        (e) =>
          `${safeText(e.name, "Macro event")} at ${safeText(e.scheduledAt, "unknown time")} (actual: ${safeText(e.actual, "N/A")}, forecast: ${safeText(e.forecast, "N/A")})`,
      ),
    riskFactors: highImpact.map(
      (e) =>
        `High-impact: ${safeText(e.name, "macro release")} actual=${safeText(e.actual, "N/A")} vs forecast=${safeText(e.forecast, "N/A")}`,
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
