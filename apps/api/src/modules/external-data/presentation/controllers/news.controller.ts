import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NewsArticleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { SessionGuard } from '../../../../session/session.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { UserNewsStateService } from '../../application/services/user-news-state.service';
import { queryNewsFilterSchema } from '@platform/shared';

@ApiTags('External Data - Cryptocurrency News')
@Controller('external-data/news')
export class NewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userNewsStateService: UserNewsStateService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search and filter normalized cryptocurrency news articles' })
  async getNewsArticles(
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() user?: { id: string },
  ) {
    const query = queryNewsFilterSchema.parse(rawQuery);
    const { page, limit, symbol, topic, sourceId, language, minImportance, minReliability, status, saved, unread, search, sort } = query;

    const where: Prisma.NewsArticleWhereInput = await this.trustedArticleScope();

    if (sourceId) where.sourceId = sourceId;
    if (language) where.language = language;
    if (minImportance != null) where.importanceScore = { gte: minImportance };
    if (minReliability != null) where.reliabilityScore = { gte: minReliability };
    where.status = status ? (status as NewsArticleStatus) : NewsArticleStatus.ACTIVE;

    if (symbol) {
      where.symbols = { some: { symbol: symbol.toUpperCase() } };
    }
    if (topic) {
      where.topics = { some: { topic: topic.toLowerCase() } };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { summary: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (user && (saved || unread)) {
      where.userStates = {
        some: {
          userId: user.id,
          ...(saved ? { isSaved: true } : {}),
          ...(unread ? { isRead: false } : {}),
        },
      };
    }

    const orderBy: Prisma.NewsArticleOrderByWithRelationInput =
      sort === 'importance_desc'
        ? { importanceScore: 'desc' }
        : sort === 'published_asc'
        ? { publishedAt: 'asc' }
        : { publishedAt: 'desc' };

    const total = await this.prisma.newsArticle.count({ where });
    const articles = await this.prisma.newsArticle.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy,
      include: {
        symbols: true,
        topics: true,
        entities: true,
        sourceReferences: true,
        userStates: user ? { where: { userId: user.id } } : false,
      },
    });

    const items = articles.map((article) => {
      const userState = article.userStates?.[0];
      return {
        id: article.id,
        sourceId: article.sourceId,
        externalId: article.externalId,
        sourceType: article.sourceType,
        title: article.title,
        normalizedTitle: article.normalizedTitle,
        summary: article.summary,
        excerpt: article.excerpt,
        canonicalUrl: article.canonicalUrl,
        originalUrl: article.originalUrl,
        author: article.author,
        language: article.language,
        imageUrl: article.imageUrl,
        publishedAt: article.publishedAt.toISOString(),
        receivedAt: article.receivedAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
        reliabilityScore: article.reliabilityScore,
        importanceScore: article.importanceScore,
        duplicateGroupId: article.duplicateGroupId,
        duplicateCount: article.sourceReferences.length,
        status: article.status,
        symbols: article.symbols.map((s) => s.symbol),
        topics: article.topics.map((t) => t.topic),
        entities: article.entities.map((e) => e.entity),
        userState: userState
          ? {
              articleId: article.id,
              isRead: userState.isRead,
              isSaved: userState.isSaved,
              isHidden: userState.isHidden,
              readAt: userState.readAt?.toISOString(),
              savedAt: userState.savedAt?.toISOString(),
            }
          : undefined,
      };
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('high-importance')
  @ApiOperation({ summary: 'Get high-importance news articles (score >= 70)' })
  async getHighImportanceNews(@Query('limit') limitStr?: string) {
    const limit = Math.min(parseInt(limitStr || '10', 10), 50);
    const trustedScope = await this.trustedArticleScope();

    const articles = await this.prisma.newsArticle.findMany({
      where: {
        AND: [trustedScope],
        importanceScore: { gte: 70 },
        status: 'ACTIVE',
      },
      take: limit,
      orderBy: { publishedAt: 'desc' },
      include: { symbols: true, topics: true },
    });

    return articles.map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary,
      canonicalUrl: article.canonicalUrl,
      sourceId: article.sourceId,
      publishedAt: article.publishedAt.toISOString(),
      importanceScore: article.importanceScore,
      symbols: article.symbols.map((s) => s.symbol),
      topics: article.topics.map((t) => t.topic),
    }));
  }

  @Get('sources')
  @ApiOperation({ summary: 'Get all configured news sources' })
  async getNewsSources() {
    return this.prisma.externalDataSource.findMany({
      where: { isEnabled: true },
      orderBy: { displayName: 'asc' },
    });
  }

  @Get('topics')
  @ApiOperation({ summary: 'Get list of active topics' })
  async getNewsTopics() {
    const topics = await this.prisma.articleTopic.groupBy({
      by: ['topic'],
      _count: { articleId: true },
      orderBy: { _count: { articleId: 'desc' } },
      take: 50,
    });
    return topics.map((t) => ({ topic: t.topic, count: t._count.articleId }));
  }

  @Get('symbols/:symbol')
  @ApiOperation({ summary: 'Get news articles for a specific trading symbol' })
  async getNewsBySymbol(@Param('symbol') symbol: string) {
    const normSymbol = symbol.toUpperCase();
    const trustedScope = await this.trustedArticleScope();
    const articles = await this.prisma.newsArticle.findMany({
      where: {
        AND: [trustedScope],
        status: NewsArticleStatus.ACTIVE,
        symbols: { some: { symbol: normSymbol } },
      },
      take: 20,
      orderBy: { publishedAt: 'desc' },
      include: { symbols: true, topics: true },
    });

    return articles.map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary,
      canonicalUrl: article.canonicalUrl,
      publishedAt: article.publishedAt.toISOString(),
      importanceScore: article.importanceScore,
      symbols: article.symbols.map((s) => s.symbol),
      topics: article.topics.map((t) => t.topic),
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get detailed news article by ID' })
  async getNewsById(@Param('id') id: string, @CurrentUser() user?: { id: string }) {
    const trustedScope = await this.trustedArticleScope();
    const article = await this.prisma.newsArticle.findFirst({
      where: { AND: [{ id }, trustedScope], status: NewsArticleStatus.ACTIVE },
      include: {
        symbols: true,
        topics: true,
        entities: true,
        sourceReferences: { include: { source: true } },
        userStates: user ? { where: { userId: user.id } } : false,
      },
    });

    if (!article) {
      throw new NotFoundException(`Article ${id} not found`);
    }

    const userState = article.userStates?.[0];

    return {
      id: article.id,
      sourceId: article.sourceId,
      externalId: article.externalId,
      sourceType: article.sourceType,
      title: article.title,
      normalizedTitle: article.normalizedTitle,
      summary: article.summary,
      excerpt: article.excerpt,
      canonicalUrl: article.canonicalUrl,
      originalUrl: article.originalUrl,
      author: article.author,
      language: article.language,
      imageUrl: article.imageUrl,
      publishedAt: article.publishedAt.toISOString(),
      receivedAt: article.receivedAt.toISOString(),
      updatedAt: article.updatedAt.toISOString(),
      reliabilityScore: article.reliabilityScore,
      importanceScore: article.importanceScore,
      duplicateGroupId: article.duplicateGroupId,
      duplicateCount: article.sourceReferences.length,
      status: article.status,
      symbols: article.symbols.map((s) => s.symbol),
      topics: article.topics.map((t) => t.topic),
      entities: article.entities.map((e) => e.entity),
      sourceReferences: article.sourceReferences.map((ref) => ({
        id: ref.id,
        sourceId: ref.sourceId,
        sourceName: ref.source?.displayName || ref.sourceId,
        publishedAt: ref.publishedAt.toISOString(),
        canonicalUrl: ref.canonicalUrl,
      })),
      importanceReasons: [
        `Source reliability: ${article.reliabilityScore}/100`,
        `Extracted assets: ${article.symbols.length}`,
        `Duplicate source references: ${article.sourceReferences.length}`,
      ],
      userState: userState
        ? {
            articleId: article.id,
            isRead: userState.isRead,
            isSaved: userState.isSaved,
            isHidden: userState.isHidden,
          }
        : undefined,
    };
  }

  @Patch(':id/read')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Mark news article as read or unread' })
  async markRead(
    @Param('id') id: string,
    @Body('isRead') isRead: boolean = true,
    @CurrentUser() user: { id: string },
  ) {
    return this.userNewsStateService.markRead(user.id, id, isRead);
  }

  @Patch(':id/save')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Bookmark or unsave news article' })
  async markSaved(
    @Param('id') id: string,
    @Body('isSaved') isSaved: boolean = true,
    @CurrentUser() user: { id: string },
  ) {
    return this.userNewsStateService.markSaved(user.id, id, isSaved);
  }

  @Patch(':id/hide')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Hide news article for current user' })
  async markHidden(
    @Param('id') id: string,
    @Body('isHidden') isHidden: boolean = true,
    @CurrentUser() user: { id: string },
  ) {
    return this.userNewsStateService.markHidden(user.id, id, isHidden);
  }

  /**
   * Only expose articles whose hostname belongs to an enabled configured source.
   * The sourceId check alone is insufficient because test fixtures can reuse a
   * production sourceId while pointing canonicalUrl at example.com.
   */
  private async trustedArticleScope(): Promise<Prisma.NewsArticleWhereInput> {
    const sources = await this.prisma.externalDataSource.findMany({
      where: { isEnabled: true },
      select: { sourceId: true, baseDomain: true, isCustom: true },
    });

    const sourceScopes: Prisma.NewsArticleWhereInput[] = sources.map((source) => {
      if (source.isCustom) {
        return { sourceId: source.sourceId };
      }
      const domain = source.baseDomain.trim().toLowerCase();
      const rootDomain = domain.split('.').slice(-2).join('.');
      return {
        AND: [
          { sourceId: source.sourceId },
          {
            OR: [
              { canonicalUrl: { contains: domain, mode: 'insensitive' as const } },
              { canonicalUrl: { contains: rootDomain, mode: 'insensitive' as const } },
            ],
          },
        ],
      };
    });

    return sourceScopes.length > 0
      ? { OR: sourceScopes }
      : { id: '__no_enabled_trusted_news_sources__' };
  }
}
