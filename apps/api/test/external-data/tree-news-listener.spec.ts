import { describe, expect, it, vi } from "vitest";
import { TreeNewsListenerService } from "../../src/modules/external-data/application/services/tree-news-listener.service";
import type { ExternalDataEventBus } from "../../src/modules/external-data/application/services/external-data-event-bus.service";

describe("TreeNewsListenerService", () => {
  it("processes CPI news, updates event, scores macroTrend, and emits macro release event", async () => {
    const emitMacroRelease = vi.fn();
    const eventBus = { emitMacroRelease } as unknown as ExternalDataEventBus;

    const existingEvent = {
      id: "macro-event-1",
      name: "Consumer Price Index",
      category: "CPI",
      importance: "HIGH",
      scheduledAt: new Date("2026-09-11T12:30:00.000Z"),
      actual: null,
      forecast: "3.4%",
      previous: "3.5%",
      unit: "%",
      country: "US",
      currency: "USD",
      sourceUrl: null,
    };

    const prisma = {
      macroEconomicEvent: {
        findFirst: vi.fn().mockResolvedValue(existingEvent),
        update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => ({
          ...existingEvent,
          ...args.data,
        })),
        create: vi.fn(),
      },
    };

    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
    };

    const adapter = {
      connectStream: vi.fn().mockReturnValue(() => undefined),
      fetchLatestNews: vi.fn().mockResolvedValue([]),
    };

    const service = new TreeNewsListenerService(
      adapter as never,
      prisma as never,
      redis as never,
      eventBus,
    );

    const time = Date.parse("2026-09-11T12:30:05.000Z");
    const handled = await service.handleIncomingNews({
      _id: "news-123",
      source: "Twitter",
      title: "US CPI (YOY) AUG: 3.2% (EXP 3.4%; PREV 3.4%)",
      time,
      url: "https://x.com/WalterBloomberg/status/123",
    });

    expect(handled).toBe(true);
    expect(redis.setNx).toHaveBeenCalledWith("macro:treenews:news-123", String(time), 86400);
    expect(prisma.macroEconomicEvent.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(prisma.macroEconomicEvent.update).mock.calls[0];
    const updateArgs = updateCall?.[0] as {
      where: { id: string };
      data: { actual: string; status: string };
    };
    expect(updateArgs.where.id).toBe("macro-event-1");
    expect(updateArgs.data.actual).toBe("3.2%");
    expect(updateArgs.data.status).toBe("RELEASED");
    expect(emitMacroRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "macro-event-1",
        name: "Consumer Price Index",
        actual: "3.2%",
        macroTrend: "RISK_ON",
      }),
    );
  });

  it("deduplicates already processed news IDs", async () => {
    const redis = {
      setNx: vi.fn().mockResolvedValue(false), // already exists
    };
    const prisma = {
      macroEconomicEvent: {
        findFirst: vi.fn(),
      },
    };
    const eventBus = { emitMacroRelease: vi.fn() };
    const adapter = {
      connectStream: vi.fn(),
      fetchLatestNews: vi.fn(),
    };

    const service = new TreeNewsListenerService(
      adapter as never,
      prisma as never,
      redis as never,
      eventBus as never,
    );

    const handled = await service.handleIncomingNews({
      _id: "news-already-seen",
      source: "Twitter",
      title: "US CPI (YOY) AUG: 3.2% (EXP 3.4%; PREV 3.4%)",
      time: Date.now(),
    });

    expect(handled).toBe(false);
    expect(prisma.macroEconomicEvent.findFirst).not.toHaveBeenCalled();
    expect(eventBus.emitMacroRelease).not.toHaveBeenCalled();
  });
});
