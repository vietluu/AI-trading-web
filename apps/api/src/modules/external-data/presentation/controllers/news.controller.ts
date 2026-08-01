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
import { PrismaService } from '../../../../database/prisma.service';
import { SessionGuard } from '../../../../session/session.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { UserNewsStateService } from '../../application/services/user-news-state.service';
import { queryNewsFilterSchema } from '@platform/shared';

@ApiTags('External Data - News')
@Controller('external-data/news')
export class NewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userNewsStateService: UserNewsStateService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated news articles with filtering' })
  async getNews(
    @Query() rawQuery: any,
    @CurrentUser() user?: { id: string },
  ) {
    const query = queryNewsFilterSchema.parse(rawQuery);
    const { page, limit, sort, sourceId, symbol, topic, category, language, minImportance, minReliability, status, saved, unread, search } = query;

    const where: any = {};

    if (sourceId) where.sourceId = sourceId;
    if (language) where.language = language;
    if (minImportance != null) where.importanceScore = { gte: minImportance };
    if (minReliability != null) where.reliabilityScore = { gte: minReliability };
    if (status) where.status = status;

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

    // Filter by user saved / unread state if user authenticated
    if (user && (saved || unread)) {
      where.userStates = {
        some: {
          userId: user.id,
          ...(saved ? { isSaved: true } : {}),
          ...(unread ? { isRead: false } : {}),
        },
      };
    }

    const orderBy: any = {};
    if (sort === 'importance_desc') {
      orderBy.importanceScore = 'desc';
    } else if (sort === 'published_asc') {
      orderBy.publishedAt = 'asc';
    } else {
      orderBy.publishedAt = 'desc';
    }

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

    const articles = await this.prisma.newsArticle.findMany({
      where: {
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
    const articles = await this.prisma.newsArticle.findMany({
      where: {
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
    const article = await this.prisma.newsArticle.findUnique({
      where: { id },
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
}
