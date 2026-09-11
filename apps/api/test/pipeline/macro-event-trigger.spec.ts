import { describe, expect, it, vi } from "vitest";
import { ExternalDataEventBus } from "../../src/modules/external-data/application/services/external-data-event-bus.service";
import { MacroEventTriggerService } from "../../src/modules/pipeline/application/macro-event-trigger.service";

describe("MacroEventTriggerService", () => {
  it("triggers pipeline runs across schedule symbols on HIGH importance macro release with bypassCooldown", async () => {
    const events = new ExternalDataEventBus();
    const prisma = {
      pipelineSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "schedule-macro-1",
            userId: "user-1",
            pipelineId: "FULL_ANALYSIS_DECISION",
            symbols: ["BTC-USDT", "ETH-USDT", "ARB-USDT"],
            strategyIds: ["ai-core"],
            provider: "BINANCE_FUTURES",
            maxRunsPerHour: 60,
            user: {
              exchangeConnections: [{ provider: "BINANCE_FUTURES" }],
            },
          },
        ]),
      },
    };
    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = { trigger: vi.fn().mockResolvedValue({ id: "run-macro-1" }) };

    const service = new MacroEventTriggerService(
      events,
      prisma as never,
      redis as never,
      pipeline as never,
    );
    service.onModuleInit();

    events.emitMacroRelease({
      id: "macro-cpi-event",
      name: "Consumer Price Index",
      category: "CPI",
      importance: "HIGH",
      actual: "3.2",
      forecast: "3.4",
      scheduledAt: new Date().toISOString(),
      releasedAt: new Date().toISOString(),
      macroTrend: "RISK_ON",
      surprise: -0.2,
    });

    await vi.waitFor(() => expect(pipeline.trigger).toHaveBeenCalledTimes(3));
    expect(pipeline.trigger).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        symbol: "BTC-USDT",
        provider: "BINANCE_FUTURES",
      }),
      "EVENT",
      expect.objectContaining({
        scheduleId: "schedule-macro-1",
        bypassCooldown: true,
      }),
    );

    const firstCall = vi.mocked(pipeline.trigger).mock.calls[0];
    const callOptions = firstCall?.[1] as {
      params?: {
        macroRelease?: {
          id?: string;
          macroTrend?: string;
          actual?: string;
        };
      };
    };
    expect(callOptions?.params?.macroRelease?.id).toBe("macro-cpi-event");
    expect(callOptions?.params?.macroRelease?.macroTrend).toBe("RISK_ON");
    expect(callOptions?.params?.macroRelease?.actual).toBe("3.2");

    service.onModuleDestroy();
  });

  it("does not trigger pipeline runs for LOW or MEDIUM importance events", async () => {
    const events = new ExternalDataEventBus();
    const prisma = { pipelineSchedule: { findMany: vi.fn() } };
    const redis = { setNx: vi.fn() };
    const pipeline = { trigger: vi.fn() };

    const service = new MacroEventTriggerService(
      events,
      prisma as never,
      redis as never,
      pipeline as never,
    );
    service.onModuleInit();

    events.emitMacroRelease({
      id: "macro-retail-event",
      name: "Retail Sales",
      category: "RETAIL_SALES",
      importance: "MEDIUM",
      actual: "0.1",
      forecast: "0.2",
      scheduledAt: new Date().toISOString(),
      releasedAt: new Date().toISOString(),
      macroTrend: "NEUTRAL",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(prisma.pipelineSchedule.findMany).not.toHaveBeenCalled();
    expect(pipeline.trigger).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });
});
