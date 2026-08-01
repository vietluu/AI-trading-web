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

      let parsed: any;
      try {
        parsed = JSON.parse(response.body);
      } catch (err: any) {
        throw new ExternalDataError({
          message: `Failed to parse Reddit JSON response: ${err.message}`,
          code: ExternalDataErrorCode.SOURCE_PARSE_FAILED,
          provider: this.provider,
          retryable: false,
          statusCode: 422,
        });
      }

      if (!parsed?.data?.children || !Array.isArray(parsed.data.children)) {
        return [];
      }

      const results: RawSocialPost[] = [];
      for (const child of parsed.data.children) {
        const post = child.data;
        if (!post || !post.id || !post.title) continue;

        const publishedAt = new Date(post.created_utc * 1000);
        const authorHash = post.author ? this.hashAuthor(post.author) : undefined;
        const textExcerpt = (post.selftext || '').slice(0, 500);
        const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : undefined;

        results.push({
          externalId: post.id,
          community: post.subreddit,
          title: post.title,
          textExcerpt,
          authorHash,
          canonicalUrl: permalink,
          publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
          engagement: {
            score: post.score,
            comments: post.num_comments,
            upvoteRatio: post.upvote_ratio,
          },
        });
      }

      return results;
    } catch (err: any) {
      if (err instanceof ExternalDataError) throw err;
      this.logger.warn(`Reddit fetch error for r/${community}: ${err.message}`);
      return [];
    }
  }

  private hashAuthor(authorName: string): string {
    return crypto.createHash('sha256').update(authorName).digest('hex').substring(0, 16);
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.provider,
      status: 'HEALTHY',
      latencyMs: 0,
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
    };
  }
}
