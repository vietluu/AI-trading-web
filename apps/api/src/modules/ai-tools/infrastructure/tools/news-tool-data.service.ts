import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import { ExternalDataIngestionProcessor } from "../../../external-data/application/jobs/external-data-ingestion.processor";

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly ingestion?: ExternalDataIngestionProcessor,
  ) {}

  public async list(input: NewsToolQuery): Promise<Record<string, unknown>[]> {
    await this.ingestion?.refreshNewsIfStale().catch(() => undefined);
    const limit = input.limit ?? 10;
    const lookbackHours = input.lookbackHours ?? 6;
    const publishedAfter = new Date(
      Date.now() - lookbackHours * 60 * 60 * 1000,
    );
    const trustedSources = await this.trustedSources();
    const trustedById = new Map(
      trustedSources.map((source) => [source.sourceId, source]),
    );
    const symbol = this.symbolVariants(input.symbol);

    const sourceFilters: Prisma.NewsArticleWhereInput[] = trustedSources.map(
      (source) => ({
        sourceId: source.sourceId,
        canonicalUrl: { contains: source.baseDomain, mode: "insensitive" },
      }),
    );
    const where: Prisma.NewsArticleWhereInput = {
      status: "ACTIVE",
      publishedAt: { gte: publishedAfter },
      ...(input.minimumImportance != null
        ? { importanceScore: { gte: input.minimumImportance } }
        : {}),
      ...(sourceFilters.length
        ? { OR: sourceFilters }
        : { id: "__no_trusted_sources__" }),
      ...(symbol
        ? {
            symbols: {
              some: {
                symbol: {
                  in: symbol,
                },
              },
            },
          }
        : {}),
    };

    const [articles, announcements, marketWideArticles] = await Promise.all([
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
      symbol
        ? this.prisma.newsArticle.findMany({
            where: {
              status: "ACTIVE",
              publishedAt: { gte: publishedAfter },
              // Read enough recent candidates to re-evaluate articles stored
              // by older scoring versions; filtering uses effective importance below.
              importanceScore: { gte: 35 },
              ...(sourceFilters.length
                ? { AND: [{ OR: sourceFilters }] }
                : { id: "__no_trusted_sources__" }),
            },
            orderBy: [{ importanceScore: "desc" }, { publishedAt: "desc" }],
            take: limit,
            include: { symbols: true, topics: true, sourceReferences: true },
          })
        : Promise.resolve([]),
    ]);

    const normalizedArticles = articles
      .filter((article) => {
        const source = trustedById.get(article.sourceId);
        return source
          ? this.matchesDomain(article.canonicalUrl, source.baseDomain)
          : false;
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
        symbol
          ? announcement.relatedSymbols.some((relatedSymbol) =>
              (this.symbolVariants(relatedSymbol) ?? []).some((candidate) =>
                symbol.includes(candidate),
              ),
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

    // Systemic crypto events must accompany symbol-specific news instead of
    // appearing only as a fallback when the symbol has no direct coverage.
    const systemicTopics = new Set([
      "regulation", "macro", "institutional_adoption", "governance", "derivatives", "stablecoin",
    ]);
    const normalizedMarketWide = marketWideArticles
        .filter((article) => {
          const text = `${article.title} ${article.summary ?? article.excerpt ?? ""}`;
          const systemic = article.topics.some((item) => systemicTopics.has(item.topic.toLowerCase())) ||
            /white house|congress|senate|treasury|cftc|sec\b|fomc|interest rate|systemic|market-wide/i.test(text);
          const symbols = article.symbols.map((item) => item.symbol.toUpperCase());
          return systemic && (symbols.length === 0 || symbols.some((item) => item === "BTC" || item === "BTC-USDT"));
        })
        .filter((article) => {
          const source = trustedById.get(article.sourceId);
          return source
            ? this.matchesDomain(article.canonicalUrl, source.baseDomain)
            : false;
        })
        .map((article) => {
          const text = `${article.title} ${article.summary ?? article.excerpt ?? ""}`;
          const systemicPolicy = /crypto|bitcoin|digital asset|clarity act|stablecoin|cftc|sec\b/i.test(text) &&
            /president|white house|congress|senate|treasury|cftc|sec\b|regulat/i.test(text);
          const effectiveImportance = Math.min(100, Math.max(
            article.importanceScore,
            systemicPolicy ? 70 : article.importanceScore,
          ));
          return {
          id: article.id,
          kind: "MARKET_WIDE_NEWS",
          title: article.title,
          summary: article.summary ?? article.excerpt,
          url: article.canonicalUrl,
          source: trustedById.get(article.sourceId)!.displayName,
          sourceId: article.sourceId,
          publishedAt: article.publishedAt.toISOString(),
          importance: effectiveImportance,
          reliability: article.reliabilityScore,
          symbols: article.symbols.map((item) => item.symbol),
          topics: article.topics.map((item) => item.topic),
          duplicateCount: article.sourceReferences.length,
          relevance: "MARKET_WIDE_CONTEXT",
          };
        })
        .filter((article) => article.importance >= (input.minimumImportance ?? 0));
    const combined = [
      ...new Map(
        [...normalizedArticles, ...normalizedMarketWide, ...normalizedAnnouncements]
          .map((item) => [item.id, item]),
      ).values(),
    ];

    return combined
      .sort((left, right) => {
        const importanceDiff =
          Number(right.importance) - Number(left.importance);
        if (importanceDiff !== 0) return importanceDiff;
        return String(right.publishedAt).localeCompare(
          String(left.publishedAt),
        );
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
      if (
        source &&
        this.matchesDomain(article.canonicalUrl, source.baseDomain)
      ) {
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
      where: { isEnabled: true },
      select: { sourceId: true, displayName: true, baseDomain: true },
    });
  }

  private symbolVariants(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    const normalized = raw.trim().toUpperCase().replace(/[_/]/g, "-");
    const base = normalized.split("-")[0];
    if (!base) return undefined;
    return [...new Set([base, `${base}-USDT`, normalized])];
  }

  private matchesDomain(rawUrl: string, baseDomain: string): boolean {
    try {
      const hostname = new URL(rawUrl).hostname.toLowerCase();
      const normalizedDomain = baseDomain.toLowerCase();
      return (
        hostname === normalizedDomain ||
        hostname.endsWith(`.${normalizedDomain}`)
      );
    } catch {
      return false;
    }
  }
}
