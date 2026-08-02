import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../src/database/prisma.service";
import { NewsToolDataService } from "../../src/modules/ai-tools/infrastructure/tools/news-tool-data.service";

function createPrismaMock() {
  return {
    externalDataSource: {
      findMany: vi.fn().mockResolvedValue([
        {
          sourceId: "coindesk-rss",
          displayName: "CoinDesk Main Feed",
          baseDomain: "coindesk.com",
        },
      ]),
    },
    newsArticle: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "real-article",
          sourceId: "coindesk-rss",
          title: "Real market report",
          summary: "A real summary",
          excerpt: null,
          canonicalUrl: "https://www.coindesk.com/markets/real-report",
          publishedAt: new Date("2026-08-02T04:00:00.000Z"),
          importanceScore: 80,
          reliabilityScore: 85,
          symbols: [{ symbol: "BTC" }],
          topics: [{ topic: "market" }],
          sourceReferences: [{ id: "reference-1" }],
        },
        {
          id: "test-article",
          sourceId: "coindesk-rss",
          title: "Synthetic test article",
          summary: "Must never reach an agent",
          excerpt: null,
          canonicalUrl: "https://example.com/test",
          publishedAt: new Date("2026-08-02T04:01:00.000Z"),
          importanceScore: 99,
          reliabilityScore: 85,
          symbols: [{ symbol: "BTC" }],
          topics: [],
          sourceReferences: [],
        },
      ]),
      findUnique: vi.fn(),
    },
    exchangeAnnouncement: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
    },
  };
}

describe("NewsToolDataService", () => {
  it("returns real trusted-domain articles and excludes test URLs", async () => {
    const prisma = createPrismaMock();
    const service = new NewsToolDataService(prisma as unknown as PrismaService);

    const result = await service.list({ symbol: "BTC", lookbackHours: 6, limit: 20 });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: "real-article",
        source: "CoinDesk Main Feed",
        url: "https://www.coindesk.com/markets/real-report",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("Synthetic test article");
    expect(prisma.newsArticle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          symbols: { some: { symbol: { in: ["BTC", "BTC-USDT"] } } },
        }),
      }),
    );
  });

  it("rejects article details whose URL does not match the configured source domain", async () => {
    const prisma = createPrismaMock();
    prisma.newsArticle.findUnique.mockResolvedValue({
      id: "test-article",
      sourceId: "coindesk-rss",
      canonicalUrl: "https://example.com/test",
      symbols: [],
      topics: [],
      entities: [],
      sourceReferences: [],
    });
    prisma.exchangeAnnouncement.findUnique.mockResolvedValue(null);
    const service = new NewsToolDataService(prisma as unknown as PrismaService);

    await expect(service.get("test-article")).rejects.toThrow(
      "Trusted news article test-article was not found",
    );
  });
});
