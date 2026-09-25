import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsAgentOutputSchema } from "@platform/shared";
import { AgentRunnerService } from "../../src/modules/agents/application/runners/agent-runner.service";
import { AgentOutputValidatorService } from "../../src/modules/agents/application/services/agent-output-validator.service";
import { NEWS_ANALYST_DEFINITION } from "../../src/modules/agents/domain/definitions/news-analyst.definition";
import { evaluateNewsProbeAuthority } from "../../src/modules/agents/domain/news-probe-authority";
import { AgentInvocationSource, AgentRunState } from "../../src/modules/agents/domain/enums";

const fresh = "2026-09-22T10:00:00.000Z";
const stale = "2026-09-22T09:00:00.000Z";
const article = (publishedAt: unknown, importance = 90) => ({
  id: `article-${importance}`, kind: "NEWS_ARTICLE", title: "Protocol upgrade drives adoption",
  summary: "Asset-specific network upgrade supports adoption.", importance,
  symbols: ["BTC"], sourceId: "source-1", corroboratingSourceIds: ["source-1", "source-2", "source-3"],
  publishedAt,
});

async function runNews(articles: Record<string, unknown>[], mode = "llm-json") {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("USE_DETERMINISTIC_ANALYSTS", mode === "deterministic" ? "true" : "false");
  let run = {
    id: "00000000-0000-4000-8000-000000000021", status: AgentRunState.CREATED,
    traceId: "trace-news", output: null as unknown, toolCallCount: 0, toolRoundCount: 0,
  };
  // Persist in memory; keep runner transitions, schema validation and evidence handling real.
  const repository = {
    createRun: vi.fn().mockResolvedValue(run),
    updateRun: vi.fn().mockImplementation((_id: string, update: Record<string, unknown>) =>
      Promise.resolve((run = { ...run, ...update }))),
    addTransition: vi.fn().mockResolvedValue({}), saveOutput: vi.fn().mockResolvedValue({}),
  };
  const modelOutput = {
    summary: "Model claims a fresh major upgrade.", impact: { level: "HIGH", direction: "POSITIVE" },
    keyEvents: [{ title: "Upgrade", impact: "POSITIVE", importance: 100 }],
    themes: [], riskSignals: [], dataQuality: "GOOD", usedTools: [],
    latestPublishedAt: fresh, generatedAt: fresh,
    // Even a schema-valid, wholly invented evidence item is untrusted.
    probeEvidence: { direction: "POSITIVE", importance: 100, publishedAt: fresh },
  };
  const runner = new AgentRunnerService(
    { execute: mode === "fallback"
      ? vi.fn().mockRejectedValue(new Error("Provider unavailable"))
      : vi.fn().mockResolvedValue({
        json: mode === "llm-text" ? undefined : modelOutput,
        text: JSON.stringify(modelOutput), provider: "OPENAI", model: "test-model",
        usage: { promptTokens: 100, completionTokens: 50, estimatedCost: 0 },
      }) } as never,
    repository as never,
    { buildAndPersistSnapshot: vi.fn().mockResolvedValue({ snapshotId: "snapshot-1", contextString: "{}" }) } as never,
    { resolve: vi.fn().mockReturnValue({ renderedPrompt: { systemPrompt: "system", userPrompt: "user" } }) } as never,
    { resolveTools: vi.fn().mockReturnValue({ resolvedToolNames: NEWS_ANALYST_DEFINITION.allowedToolNames }) } as never,
    { loadMemory: vi.fn(), persistOutput: vi.fn() } as never,
    new AgentOutputValidatorService(),
    {} as never,
    {
      acquireGlobal: vi.fn().mockResolvedValue({ acquired: true }),
      acquireType: vi.fn().mockResolvedValue({ acquired: true }),
      releaseGlobal: vi.fn(), releaseType: vi.fn(),
    } as never,
    { checkAndLock: vi.fn().mockResolvedValue({ locked: true }), unlock: vi.fn(), setResult: vi.fn() } as never,
    {} as never,
    {
      runStep: vi.fn().mockImplementation((calls: { toolName: string }[]) => Promise.resolve({
        shouldContinue: true,
        toolResults: calls.map((call, index) => ({
          providerCallId: `planned-${index + 1}`, toolName: call.toolName,
          result: {
            invocationId: `inv-${index + 1}`, toolName: call.toolName, toolVersion: 1,
            status: "SUCCESS", data: { articles: index === 0 ? articles : [] },
            metadata: { startedAt: new Date(), completedAt: new Date(), durationMs: 1, cached: false, stale: false, schemaVersion: 1 },
          },
        })),
      })),
    } as never,
  );
  return runner.run({
    definition: NEWS_ANALYST_DEFINITION, input: { symbol: "BTC" },
    invocationSource: AgentInvocationSource.FUTURE_SCHEDULED, correlationId: "news-provenance",
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("news probe provenance across runner modes", () => {
  it.each(["llm-json", "llm-text"])("overwrites invented %s publication time with the actual stale article time", async (mode) => {
    const result = await runNews([article(stale)], mode);

    expect(result.status).toBe(AgentRunState.COMPLETED);
    expect(NewsAgentOutputSchema.parse(result.output).latestPublishedAt).toBe(stale);
    expect(result.output).toMatchObject({
      probeEvidence: { direction: "POSITIVE", importance: 90, publishedAt: stale },
    });
  });

  it.each([undefined, "invalid"])("discards invented publication time when tool record has %s timestamp", async (publishedAt) => {
    const result = await runNews([article(publishedAt)]);

    expect(result.status).toBe(AgentRunState.COMPLETED);
    expect(NewsAgentOutputSchema.parse(result.output).latestPublishedAt).toBeNull();
    expect(result.output).toMatchObject({ probeEvidence: null });
  });

  it.each([
    { name: "no articles", articles: [] },
    { name: "low importance", articles: [article(fresh, 40)] },
    { name: "opposite direction", articles: [{ ...article(fresh), title: "Protocol suffers security breach" }] },
    { name: "neutral headline", articles: [{ ...article(fresh), title: "Protocol publishes routine weekly summary", summary: "Routine maintenance metrics." }] },
  ])("discards invented evidence when actual records contain $name", async ({ articles }) => {
    const result = await runNews(articles);

    expect(result.status).toBe(AgentRunState.COMPLETED);
    expect(result.output).toMatchObject({ latestPublishedAt: null, probeEvidence: null });
  });

  it.each(["llm-json", "llm-text", "deterministic", "fallback"])("preserves one fresh high-importance evidence item in %s mode", async (mode) => {
    const result = await runNews([article(fresh, 85), article(stale, 95)], mode);

    expect(result.status).toBe(AgentRunState.COMPLETED);
    expect(result.output).toMatchObject({
      latestPublishedAt: fresh,
      probeEvidence: { direction: "POSITIVE", importance: 85, publishedAt: fresh },
    });
    const news = NewsAgentOutputSchema.parse(result.output);
    expect(evaluateNewsProbeAuthority({
      news: { ...news.probeEvidence!, confidence: 90, sourceIds: [] },
      causality: { priceChangePercent: 2, volumeRatio: 1.6, deltaOiPercent: 1.2 },
      now: new Date(fresh),
    }).allowed).toBe(true);
  });

  it.each(["llm-json", "deterministic", "fallback"])("cannot combine stale high importance with fresh low importance in %s mode", async (mode) => {
    const result = await runNews([article(stale, 95), article(fresh, 40)], mode);

    expect(result.status).toBe(AgentRunState.COMPLETED);
    expect(NewsAgentOutputSchema.parse(result.output).latestPublishedAt).toBe(stale);
    expect(result.output).toMatchObject({
      probeEvidence: { direction: "POSITIVE", importance: 95, publishedAt: stale },
    });
    const news = NewsAgentOutputSchema.parse(result.output);
    expect(evaluateNewsProbeAuthority({
      news: { ...news.probeEvidence!, confidence: 90, sourceIds: [] },
      causality: { priceChangePercent: 2, volumeRatio: 1.6, deltaOiPercent: 1.2 },
      now: new Date(fresh),
    })).toEqual({ allowed: false, reason: "NEWS_NOT_FRESH", corroborationCount: 0 });
  });
});
