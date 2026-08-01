import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../database/prisma.service';
import { SessionGuard } from '../../../../session/session.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';

@ApiTags('External Data - Social')
@Controller('external-data/social')
export class SocialController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get ingested social posts' })
  async getSocialPosts(
    @Query('provider') provider?: string,
    @Query('community') community?: string,
    @Query('symbol') symbol?: string,
    @Query('page') pageStr: string = '1',
    @Query('limit') limitStr: string = '20',
  ) {
    const page = Math.max(parseInt(pageStr, 10), 1);
    const limit = Math.min(Math.max(parseInt(limitStr, 10), 1), 100);

    const where: any = {};
    if (provider) where.provider = provider;
    if (community) where.community = community;
    if (symbol) where.relatedSymbols = { has: symbol.toUpperCase() };

    const total = await this.prisma.socialPost.count({ where });
    const items = await this.prisma.socialPost.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { publishedAt: 'desc' },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        provider: item.provider,
        externalId: item.externalId,
        community: item.community,
        title: item.title,
        textExcerpt: item.textExcerpt,
        canonicalUrl: item.canonicalUrl,
        publishedAt: item.publishedAt.toISOString(),
        engagement: {
          score: item.engagementScore,
          comments: item.commentsCount,
          upvoteRatio: item.upvoteRatio,
        },
        relatedSymbols: item.relatedSymbols,
        topics: item.topics,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('providers')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Get social providers status and user credential state' })
  async getSocialProviders(@CurrentUser() user: { id: string }) {
    const redditCred = await this.prisma.encryptedCredential.findFirst({
      where: { userId: user.id, provider: 'REDDIT' },
    });

    return [
      {
        provider: 'REDDIT',
        displayName: 'Reddit API',
        status: redditCred ? 'AVAILABLE' : 'NOT_CONFIGURED',
        isConfigured: !!redditCred,
        maskedKey: redditCred?.lastFour ? `••••${redditCred.lastFour}` : null,
      },
      {
        provider: 'X',
        displayName: 'X (formerly Twitter)',
        status: 'UNSUPPORTED',
        isConfigured: false,
        notes: 'X integration foundation prepared; API credentials disabled.',
      },
      {
        provider: 'TELEGRAM',
        displayName: 'Telegram Channel Ingestion',
        status: 'UNSUPPORTED',
        isConfigured: false,
        notes: 'Telegram integration foundation prepared; API credentials disabled.',
      },
      {
        provider: 'DISCORD',
        displayName: 'Discord Announcement Bot',
        status: 'UNSUPPORTED',
        isConfigured: false,
        notes: 'Discord integration foundation prepared; API credentials disabled.',
      },
    ];
  }
}
