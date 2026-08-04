import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, SocialProvider } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { SessionGuard } from '../../../../session/session.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RedditAdapter } from '../../infrastructure/providers/reddit/reddit.adapter';

@ApiTags('External Data - Social')
@Controller('external-data/social')
export class SocialController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redditAdapter: RedditAdapter,
  ) {}

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

    const where: Prisma.SocialPostWhereInput = {};
    if (provider) where.provider = provider as SocialProvider;
    if (community) where.community = community;
    if (symbol) where.relatedSymbols = { has: symbol.toUpperCase() };

    let total = await this.prisma.socialPost.count({ where });

    if (total === 0) {
      try {
        const fetchedPosts = await this.redditAdapter.fetchPosts({
          community: community || 'cryptocurrency',
          limit: 25,
        });

        for (const post of fetchedPosts) {
          await this.prisma.socialPost.upsert({
            where: {
              provider_externalId: {
                provider: SocialProvider.REDDIT,
                externalId: post.externalId,
              },
            },
            create: {
              provider: SocialProvider.REDDIT,
              externalId: post.externalId,
              community: post.community,
              title: post.title,
              textExcerpt: post.textExcerpt,
              authorHash: post.authorHash,
              canonicalUrl: post.canonicalUrl,
              publishedAt: post.publishedAt,
              engagementScore: post.engagement?.score || 0,
              commentsCount: post.engagement?.comments || 0,
              upvoteRatio: post.engagement?.upvoteRatio,
              relatedSymbols: symbol ? [symbol.toUpperCase()] : ['BTC', 'ETH'],
            },
            update: {
              title: post.title,
              textExcerpt: post.textExcerpt,
              engagementScore: post.engagement?.score || 0,
              commentsCount: post.engagement?.comments || 0,
            },
          });
        }
        total = await this.prisma.socialPost.count({ where });
      } catch {
        // Continue with current total if network fetch fails
      }
    }
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
