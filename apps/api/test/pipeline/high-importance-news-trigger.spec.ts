import { describe, expect, it, vi } from "vitest";
import { ExternalDataEventBus } from "../../src/modules/external-data/application/services/external-data-event-bus.service";
import { HighImportanceNewsTriggerService } from "../../src/modules/pipeline/application/high-importance-news-trigger.service";

describe("high importance news pipeline trigger", () => {
  it("triggers only related schedule symbols and bypasses cooldown without bypassing quota", async () => {
    const events = new ExternalDataEventBus();
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([{
          id: "schedule-1",
          userId: "user-1",
          pipelineId: "FULL_ANALYSIS_DECISION",
          symbols: ["BTC-USDT", "ETH-USDT"],
          strategyIds: ["ai-core"],
          provider: "OKX_FUTURES",
          maxRunsPerHour: 60,
          user: {
            exchangeConnections: [{ provider: "OKX_FUTURES" }],
          },
        }]),
      },
    };
    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = { trigger: vi.fn().mockResolvedValue({ id: "run-1" }) };
    const service = new HighImportanceNewsTriggerService(
      events,
      prisma as never,
      redis as never,
      pipeline as never,
    );
    service.onModuleInit();

    events.emitHighImportanceNews({
      id: "article-1",
      title: "BTC ETF event",
      importanceScore: 90,
      symbols: ["BTC"],
      publishedAt: new Date().toISOString(),
    });

    await vi.waitFor(() => expect(pipeline.trigger).toHaveBeenCalledTimes(1));
    expect(pipeline.trigger).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ symbol: "BTC-USDT" }),
      "EVENT",
      expect.objectContaining({
        scheduleId: "schedule-1",
        maxRunsPerHour: 60,
        bypassCooldown: true,
      }),
    );
    service.onModuleDestroy();
  });
});
