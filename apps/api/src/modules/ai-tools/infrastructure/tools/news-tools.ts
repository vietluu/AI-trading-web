import { Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { PrismaService } from "../../../../database/prisma.service";
import { NewsToolDataService } from "./news-tool-data.service";
import { ExternalDataIngestionProcessor } from "../../../external-data/application/jobs/external-data-ingestion.processor";

@Injectable()
export class NewsArticlesListTool implements ToolDefinition<{ symbol?: string; lookbackHours?: number; limit?: number }, Record<string, unknown>> {
  constructor(private readonly newsData: NewsToolDataService) {}

  public readonly name = "news.articles.list";
  public readonly version = 1;
  public readonly displayName = "List News Articles";
  public readonly description = "List deduplicated cryptocurrency news articles with importance scores";
  public readonly category = "NEWS" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().min(1).max(32).optional(),
    lookbackHours: z.number().int().min(1).max(24).optional().default(6),
    limit: z.number().int().min(1).max(50).optional().default(10),
  });

  public readonly outputSchema = z.object({
    articles: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 60 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_NEWS" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-news-articles-list-v1";

  public async execute(input: { symbol?: string; lookbackHours?: number; limit?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    return {
      limit: input.limit || 10,
      symbol: input.symbol,
      lookbackHours: input.lookbackHours || 6,
      articles: await this.newsData.list(input),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class NewsArticleGetTool implements ToolDefinition<{ articleId: string }, Record<string, unknown>> {
  constructor(private readonly newsData: NewsToolDataService) {}

  public readonly name = "news.article.get";
  public readonly version = 1;
  public readonly displayName = "Get News Article";
  public readonly description = "Fetch single crypto news article detail by article ID";
  public readonly category = "NEWS" as const;

  public readonly inputSchema = z.object({
    articleId: z.string().describe("News article unique ID"),
  });

  public readonly outputSchema = z.object({
    article: z.record(z.unknown()),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 300 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_NEWS" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-news-article-get-v1";

  public async execute(input: { articleId: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    return {
      article: await this.newsData.get(input.articleId),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class NewsHighImportanceListTool implements ToolDefinition<{ symbol?: string; lookbackHours?: number; limit?: number; minimumImportance?: number }, Record<string, unknown>> {
  constructor(private readonly newsData: NewsToolDataService) {}

  public readonly name = "news.high_importance.list";
  public readonly version = 1;
  public readonly displayName = "List High Importance News";
  public readonly description = "Fetch high impact crypto market news articles filtered by minimum importance score";
  public readonly category = "NEWS" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().min(1).max(32).optional(),
    lookbackHours: z.number().int().min(1).max(24).optional().default(6),
    limit: z.number().int().min(1).max(50).optional().default(20),
    minimumImportance: z.number().int().min(50).max(100).optional().default(70),
  });

  public readonly outputSchema = z.object({
    articles: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 60 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_NEWS" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-news-high-importance-list-v1";

  public async execute(input: { symbol?: string; lookbackHours?: number; limit?: number; minimumImportance?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    return {
      symbol: input.symbol,
      lookbackHours: input.lookbackHours || 6,
      limit: input.limit || 20,
      articles: await this.newsData.list({
        ...input,
        minimumImportance: input.minimumImportance ?? 70,
      }),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class SentimentMarketGetTool implements ToolDefinition<{ symbol?: string; lookbackHours?: number }, Record<string, unknown>> {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly ingestion?: ExternalDataIngestionProcessor,
  ) {}

  public readonly name = "sentiment.market.get";
  public readonly version = 1;
  public readonly displayName = "Get Market Sentiment";
  public readonly description = "Fetch Crypto Fear and Greed Index score and classification";
  public readonly category = "SENTIMENT" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().min(1).max(32).optional(),
    lookbackHours: z.number().int().min(1).max(24).optional().default(6),
  });

  public readonly outputSchema = z.object({
    score: z.number(),
    classification: z.string(),
    timestamp: z.string(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "NONE" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 300 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_SENTIMENT" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-sentiment-market-get-v1";

  public async execute(input: { symbol?: string; lookbackHours?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    await this.ingestion?.refreshSentimentIfStale().catch(() => undefined);
    const latest = await this.prisma.marketSentimentObservation.findFirst({
      orderBy: { observedAt: "desc" },
    });

    if (latest) {
      return {
        score: latest.value,
        classification: latest.classification,
        timestamp: latest.observedAt.toISOString(),
        provider: latest.provider,
        indexType: latest.indexType,
        symbol: input.symbol,
        lookbackHours: input.lookbackHours || 6,
        invocationId: context.invocationId,
      };
    }

    return {
      score: 50,
      classification: "Neutral",
      timestamp: new Date().toISOString(),
      symbol: input.symbol,
      lookbackHours: input.lookbackHours || 6,
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class MacroEventsListTool implements ToolDefinition<{ lookbackHours?: number; limit?: number }, Record<string, unknown>> {
  constructor(private readonly prisma: PrismaService) {}

  public readonly name = "macro.events.list";
  public readonly version = 1;
  public readonly displayName = "List Macroeconomic Events";
  public readonly description = "Fetch macroeconomic calendar events (CPI, FOMC, NFP, GDP, Interest Rates)";
  public readonly category = "MACRO" as const;

  public readonly inputSchema = z.object({
    lookbackHours: z.number().int().min(1).max(720).optional().default(24),
    limit: z.number().int().min(1).max(50).optional().default(10),
  });

  public readonly outputSchema = z.object({
    events: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 300 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_MACRO" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-macro-events-list-v1";

  public async execute(input: { lookbackHours?: number; limit?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    const lookbackHours = input.lookbackHours || 24;
    const limit = input.limit || 10;
    const now = new Date();
    const windowMs = lookbackHours * 60 * 60_000;
    const events = await this.prisma.macroEconomicEvent.findMany({
      where: {
        scheduledAt: {
          gte: new Date(now.getTime() - windowMs),
          lte: new Date(now.getTime() + windowMs),
        },
      },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
    return {
      limit,
      lookbackHours,
      sourceCoverage: 'MANUAL_IMPORT_ONLY',
      dataAvailable: events.length > 0,
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        provider: event.provider,
        category: event.category,
        importance: event.importance,
        country: event.country,
        currency: event.currency,
        scheduledAt: event.scheduledAt.toISOString(),
        actual: event.actual,
        forecast: event.forecast,
        previous: event.previous,
        unit: event.unit,
        status: event.status,
      })),
      invocationId: context.invocationId,
    };
  }
}

@Injectable()
export class SocialPostsListTool implements ToolDefinition<{ symbol?: string; lookbackHours?: number; limit?: number }, Record<string, unknown>> {
  constructor(private readonly prisma: PrismaService) {}

  public readonly name = "social.posts.list";
  public readonly version = 1;
  public readonly displayName = "List Social Posts";
  public readonly description = "Fetch crypto community social posts (Reddit, Telegram, Twitter)";
  public readonly category = "SOCIAL" as const;

  public readonly inputSchema = z.object({
    symbol: z.string().min(1).max(32).optional().describe("Crypto symbol filter"),
    lookbackHours: z.number().int().min(1).max(24).optional().default(6),
    limit: z.number().int().min(1).max(50).optional().default(10),
  });

  public readonly outputSchema = z.object({
    posts: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "PUBLIC" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 60 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = false;
  public readonly userScoped = false;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_SOCIAL" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-social-posts-list-v1";

  public async execute(input: { symbol?: string; lookbackHours?: number; limit?: number }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    const limit = input.limit || 10;
    const lookbackHours = input.lookbackHours || 6;
    const baseSymbol = input.symbol?.toUpperCase().split("-")[0];
    const publishedAfter = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    let posts = await this.prisma.socialPost.findMany({
      where: {
        publishedAt: { gte: publishedAfter },
        ...(baseSymbol ? { relatedSymbols: { has: baseSymbol } } : {}),
      },
      take: limit,
      orderBy: { publishedAt: "desc" },
    });

    if (posts.length === 0) {
      posts = await this.prisma.socialPost.findMany({
        where: baseSymbol ? { relatedSymbols: { has: baseSymbol } } : {},
        take: limit,
        orderBy: { publishedAt: "desc" },
      });
    }

    return {
      symbol: input.symbol ?? null,
      lookbackHours,
      posts: posts.map((p) => ({
        id: p.id,
        platform: p.provider,
        community: p.community,
        title: p.title,
        textExcerpt: p.textExcerpt,
        canonicalUrl: p.canonicalUrl,
        engagementScore: p.engagementScore,
        publishedAt: p.publishedAt.toISOString(),
      })),
      invocationId: context.invocationId,
    };
  }
}
