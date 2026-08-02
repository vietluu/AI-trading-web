import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";

export interface NewsToolQuery {
  symbol?: string;
  lookbackHours?: number;
  limit?: number;
  minimumImportance?: number;
}

interface TrustedSource {
  sourceId: string;
  displayName: string;
  baseDomain: string;
}

@Injectable()
export class NewsToolDataService {
  constructor(private readonly prisma: PrismaService) {}

  public async list(input: NewsToolQuery): Promise<Record<string, unknown>[]> {
    const limit = input.limit ?? 10;
    const lookbackHours = input.lookbackHours ?? 6;
    const publishedAfter = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    const trustedSources = await this.trustedSources();
    const trustedById = new Map(trustedSources.map((source) => [source.sourceId, source]));

    const sourceFilters: Prisma.NewsArticleWhereInput[] = trustedSources.map((source) => ({
      sourceId: source.sourceId,
      canonicalUrl: { contains: source.baseDomain, mode: "insensitive" },
    }));
    const where: Prisma.NewsArticleWhereInput = {
      status: "ACTIVE",
      publishedAt: { gte: publishedAfter },
      ...(input.minimumImportance != null
        ? { importanceScore: { gte: input.minimumImportance } }
        : {}),
      ...(sourceFilters.length ? { OR: sourceFilters } : { id: "__no_trusted_sources__" }),
      ...(input.symbol
        ? {
            symbols: {
              some: {
                symbol: {
                  in: [
                    input.symbol.toUpperCase(),
                    `${input.symbol.toUpperCase()}-USDT`,
                  ],
                },
              },
            },
          }
        : {}),
    };

    const [articles, announcements] = await Promise.all([
      this.prisma.newsArticle.findMany({
        where,
        orderBy: [{ importanceScore: "desc" }, { publishedAt: "desc" }],
        take: Math.min(limit * 5, 250),
        include: { symbols: true, topics: true, sourceReferences: true },
      }),
      this.prisma.exchangeAnnouncement.findMany({
        where: {
          publishedAt: { gte: publishedAfter },
          ...(input.minimumImportance != null
            ? { importanceScore: { gte: input.minimumImportance } }
            : {}),
        },
        orderBy: [{ importanceScore: "desc" }, { publishedAt: "desc" }],
        take: Math.min(limit * 3, 150),
      }),
    ]);

    const normalizedArticles = articles
      .filter((article) => {
        const source = trustedById.get(article.sourceId);
        return source ? this.matchesDomain(article.canonicalUrl, source.baseDomain) : false;
      })
      .map((article) => {
        const source = trustedById.get(article.sourceId)!;
        return {
          id: article.id,
          kind: "NEWS_ARTICLE",
          title: article.title,
          summary: article.summary ?? article.excerpt,
          url: article.canonicalUrl,
          source: source.displayName,
          sourceId: article.sourceId,
          publishedAt: article.publishedAt.toISOString(),
          importance: article.importanceScore,
          reliability: article.reliabilityScore,
          symbols: article.symbols.map((item) => item.symbol),
          topics: article.topics.map((item) => item.topic),
          duplicateCount: article.sourceReferences.length,
        };
      });

    const normalizedAnnouncements = announcements
      .filter((announcement) =>
        input.symbol
          ? announcement.relatedSymbols.some((symbol) =>
              symbol.toUpperCase().includes(input.symbol!.toUpperCase()),
            )
          : true,
      )
      .map((announcement) => ({
        id: announcement.id,
        kind: "EXCHANGE_ANNOUNCEMENT",
        title: announcement.title,
        summary: announcement.summary,
        url: announcement.canonicalUrl,
        source: announcement.provider,
        sourceId: announcement.provider,
        publishedAt: announcement.publishedAt.toISOString(),
        importance: announcement.importanceScore,
        reliability: announcement.sourceReliabilityScore,
        symbols: announcement.relatedSymbols,
        topics: [announcement.category],
        duplicateCount: 1,
      }));

    return [...normalizedArticles, ...normalizedAnnouncements]
      .sort((left, right) => {
        const importanceDiff = Number(right.importance) - Number(left.importance);
        if (importanceDiff !== 0) return importanceDiff;
        return String(right.publishedAt).localeCompare(String(left.publishedAt));
      })
      .slice(0, limit);
  }

  public async get(articleId: string): Promise<Record<string, unknown>> {
    const article = await this.prisma.newsArticle.findUnique({
      where: { id: articleId },
      include: {
        symbols: true,
        topics: true,
        entities: true,
        sourceReferences: true,
      },
    });
    if (article) {
      const source = (await this.trustedSources()).find(
        (candidate) => candidate.sourceId === article.sourceId,
      );
      if (source && this.matchesDomain(article.canonicalUrl, source.baseDomain)) {
        return {
          id: article.id,
          kind: "NEWS_ARTICLE",
          title: article.title,
          summary: article.summary,
          excerpt: article.excerpt,
          url: article.canonicalUrl,
          source: source.displayName,
          sourceId: article.sourceId,
          author: article.author,
          publishedAt: article.publishedAt.toISOString(),
          importance: article.importanceScore,
          reliability: article.reliabilityScore,
          symbols: article.symbols.map((item) => item.symbol),
          topics: article.topics.map((item) => item.topic),
          entities: article.entities.map((item) => item.entity),
          duplicateCount: article.sourceReferences.length,
        };
      }
    }

    const announcement = await this.prisma.exchangeAnnouncement.findUnique({
      where: { id: articleId },
    });
    if (announcement) {
      return {
        id: announcement.id,
        kind: "EXCHANGE_ANNOUNCEMENT",
        title: announcement.title,
        summary: announcement.summary,
        url: announcement.canonicalUrl,
        source: announcement.provider,
        sourceId: announcement.provider,
        publishedAt: announcement.publishedAt.toISOString(),
        importance: announcement.importanceScore,
        reliability: announcement.sourceReliabilityScore,
        symbols: announcement.relatedSymbols,
        topics: [announcement.category],
      };
    }

    throw new Error(`Trusted news article ${articleId} was not found`);
  }

  private trustedSources(): Promise<TrustedSource[]> {
    return this.prisma.externalDataSource.findMany({
      where: { isEnabled: true, isCustom: false },
      select: { sourceId: true, displayName: true, baseDomain: true },
    });
  }

  private matchesDomain(rawUrl: string, baseDomain: string): boolean {
    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase();
      const normalizedDomain = baseDomain.toLowerCase();
      return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
    } catch {
      return false;
    }
  }
}
