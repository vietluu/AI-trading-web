import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { ExternalDataProvider, NewsSourceType } from '@prisma/client';
import {
  ProviderHealth,
  RawSocialPost,
  SocialFetchContext,
  SocialSourceAdapter,
} from '../../../domain/adapters/source-adapter.contracts';
import { ExternalDataError, ExternalDataErrorCode } from '../../../domain/errors/external-data.error';
import { ExternalHttpClient } from '../../http/external-http-client';

@Injectable()
export class RedditAdapter implements SocialSourceAdapter {
  readonly sourceId: string = 'reddit-adapter';
  readonly sourceType: NewsSourceType = NewsSourceType.REDDIT;
  readonly provider: ExternalDataProvider = ExternalDataProvider.REDDIT;

  private readonly logger = new Logger(RedditAdapter.name);

  constructor(private readonly httpClient: ExternalHttpClient) {}

  async fetchPosts(context: SocialFetchContext): Promise<RawSocialPost[]> {
    const community = context.community || 'cryptocurrency';
    const limit = Math.min(context.limit || 25, 100);

    // Standard Reddit JSON endpoint (public endpoint rate-limited or OAuth if client id/secret provided)
    const url = `https://www.reddit.com/r/${encodeURIComponent(community)}/hot.json?limit=${limit}`;

    try {
      const response = await this.httpClient.fetch({
        url,
        headers: {
          'User-Agent': 'web:crypto-research-platform:v1.0 (by /u/cryptobot)',
        },
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(response.body) as Record<string, unknown>;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new ExternalDataError({
          message: `Failed to parse Reddit JSON response: ${errorMsg}`,
          code: ExternalDataErrorCode.SOURCE_PARSE_FAILED,
          provider: this.provider,
          retryable: false,
          statusCode: 422,
        });
      }

      const dataObj = parsed.data as Record<string, unknown> | undefined;
      const children = dataObj?.children;
      if (!Array.isArray(children)) {
        return [];
      }

      const results: RawSocialPost[] = [];
      for (const child of children) {
        if (!child || typeof child !== 'object') continue;
        const post = (child as Record<string, unknown>).data as Record<string, unknown> | undefined;
        if (!post || typeof post.id !== 'string' || typeof post.title !== 'string') continue;

        const createdUtc = typeof post.created_utc === 'number' ? post.created_utc : 0;
        const publishedAt = new Date(createdUtc * 1000);
        const author = typeof post.author === 'string' ? post.author : '';
        const authorHash = author ? this.hashAuthor(author) : undefined;
        const selftext = typeof post.selftext === 'string' ? post.selftext : '';
        const textExcerpt = selftext.slice(0, 500);
        const permalink = typeof post.permalink === 'string' ? `https://www.reddit.com${post.permalink}` : undefined;

        results.push({
          externalId: post.id,
          community: typeof post.subreddit === 'string' ? post.subreddit : community,
          title: post.title,
          textExcerpt,
          authorHash,
          canonicalUrl: permalink,
          publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
          engagement: {
            score: typeof post.score === 'number' ? post.score : 0,
            comments: typeof post.num_comments === 'number' ? post.num_comments : 0,
            upvoteRatio: typeof post.upvote_ratio === 'number' ? post.upvote_ratio : undefined,
          },
        });
      }

      return results;
    } catch (err: unknown) {
      if (err instanceof ExternalDataError) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Reddit fetch error for r/${community}: ${errorMsg}`);
      return [];
    }
  }

  private hashAuthor(authorName: string): string {
    return crypto.createHash('sha256').update(authorName).digest('hex').substring(0, 16);
  }

  async getHealth(): Promise<ProviderHealth> {
    return Promise.resolve({
      provider: this.provider,
      status: 'HEALTHY',
      latencyMs: 0,
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
    });
  }
}
