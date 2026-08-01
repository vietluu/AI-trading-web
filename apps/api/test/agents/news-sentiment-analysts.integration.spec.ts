import { describe, expect, it, vi } from "vitest";
import {
  NewsAgentOutputSchema,
  SentimentAgentOutputSchema,
} from "@platform/shared";
import { AgentOutputValidatorService } from "../../src/modules/agents/application/services/agent-output-validator.service";
import { AgentRunnerService } from "../../src/modules/agents/application/runners/agent-runner.service";
import { NEWS_ANALYST_DEFINITION } from "../../src/modules/agents/domain/definitions/news-analyst.definition";
import { SENTIMENT_ANALYST_DEFINITION } from "../../src/modules/agents/domain/definitions/sentiment-analyst.definition";
import {
  AgentInvocationSource,
  AgentRunState,
} from "../../src/modules/agents/domain/enums";

describe("News and Sentiment Agent runner integration", () => {
  it.each([
    {
      name: "news",
      definition: NEWS_ANALYST_DEFINITION,
      schema: NewsAgentOutputSchema,
      output: {
        summary: "ETF expansion is the principal recent narrative.",
        impact: { level: "HIGH", direction: "POSITIVE" },
        keyEvents: [
          {
            title: "ETF options expansion",
            impact: "POSITIVE",
            importance: 85,
          },
        ],
        themes: ["ETF", "institutional"],
        riskSignals: [],
        dataQuality: "GOOD",
        usedTools: ["news.articles.list", "news.high_importance.list"],
        generatedAt: new Date().toISOString(),
      },
    },
    {
      name: "sentiment",
      definition: SENTIMENT_ANALYST_DEFINITION,
      schema: SentimentAgentOutputSchema,
      output: {
        summary: "Crowd optimism is elevated but not euphoric.",
        sentiment: { overall: "BULLISH", intensity: "MEDIUM" },
        crowdBehavior: { fomo: false, panic: false, euphoria: false },
        sources: { social: "Reddit", marketSentimentIndex: "68 - Greed" },
        anomalies: [],
        dataQuality: "GOOD",
        usedTools: ["sentiment.market.get", "social.posts.list"],
        generatedAt: new Date().toISOString(),
      },
    },
  ])(
    "runs and persists structured $name output",
    async ({ definition, schema, output }) => {
      let run = {
        id: "00000000-0000-4000-8000-000000000021",
        status: AgentRunState.CREATED,
        traceId: "trace-news-sentiment",
        output: null as unknown,
        toolCallCount: 0,
        toolRoundCount: 0,
      };
      const repository = {
        createRun: vi.fn().mockResolvedValue(run),
        updateRun: vi
          .fn()
          .mockImplementation((_id: string, update: Record<string, unknown>) =>
            Promise.resolve((run = { ...run, ...update })),
          ),
        addTransition: vi.fn().mockResolvedValue({}),
        saveOutput: vi.fn().mockResolvedValue({}),
      };
      const toolLoop = {
        runStep: vi
          .fn()
          .mockImplementation((calls: Array<{ toolName: string }>) =>
            Promise.resolve({
              shouldContinue: true,
              toolResults: calls.map((call, index) => ({
                providerCallId: `planned-${index + 1}`,
                toolName: call.toolName,
                result: {
                  invocationId: `inv-${index + 1}`,
                  toolName: call.toolName,
                  toolVersion: 1,
                  status: "SUCCESS",
                  data: { symbol: "BTC" },
                  metadata: {
                    startedAt: new Date(),
                    completedAt: new Date(),
                    durationMs: 1,
                    cached: false,
                    stale: false,
                    schemaVersion: 1,
                  },
                },
              })),
            }),
          ),
      };
      const runner = new AgentRunnerService(
        {
          execute: vi
            .fn()
            .mockResolvedValue({
              text: JSON.stringify(output),
              json: output,
              usage: {
                promptTokens: 100,
                completionTokens: 50,
                estimatedCost: 0,
                totalTokens: 150,
              },
              provider: "OPENAI",
              model: "test-model",
            }),
        } as never,
        repository as never,
        {
          buildAndPersistSnapshot: vi
            .fn()
            .mockResolvedValue({
              snapshotId: "snapshot-1",
              contextString: "{}",
              tokenEstimate: 1,
            }),
        } as never,
        {
          resolve: vi
            .fn()
            .mockReturnValue({
              renderedPrompt: { systemPrompt: "system", userPrompt: "user" },
            }),
        } as never,
        {
          resolveTools: vi
            .fn()
            .mockReturnValue({
              toolCount: definition.allowedToolNames.length,
              providerSchemas: [],
              resolvedToolNames: definition.allowedToolNames,
            }),
        } as never,
        { loadMemory: vi.fn(), persistOutput: vi.fn() } as never,
        new AgentOutputValidatorService(),
        {} as never,
        {
          acquireGlobal: vi.fn().mockResolvedValue({ acquired: true }),
          acquireUser: vi.fn().mockResolvedValue({ acquired: true }),
          acquireType: vi.fn().mockResolvedValue({ acquired: true }),
          releaseGlobal: vi.fn(),
          releaseUser: vi.fn(),
          releaseType: vi.fn(),
        } as never,
        {
          checkAndLock: vi.fn().mockResolvedValue({ locked: true }),
          unlock: vi.fn(),
          setResult: vi.fn(),
        } as never,
        { recordRun: vi.fn() } as never,
        toolLoop as never,
      );

      const result = await runner.run({
        definition,
        userId: "00000000-0000-4000-8000-000000000022",
        input: { symbol: "BTC", lookbackHours: 6, maxItems: 20 },
        invocationSource: AgentInvocationSource.SYSTEM_TEST,
        correlationId: `${definition.type}-correlation`,
      });

      expect(result.status).toBe(AgentRunState.COMPLETED);
      expect(toolLoop.runStep.mock.calls[0]?.[0]).toHaveLength(2);
      expect(schema.safeParse(result.output).success).toBe(true);
      expect(repository.saveOutput).toHaveBeenCalledOnce();
    },
  );
});
