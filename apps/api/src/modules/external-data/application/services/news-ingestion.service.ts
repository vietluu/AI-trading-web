import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { NewsArticleStatus, NewsSourceType } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { RawNewsItem } from '../../domain/adapters/source-adapter.contracts';
import { UrlCanonicalizer } from './url-canonicalizer.service';
import { DeduplicationService } from './deduplication.service';
import { MetadataExtractor } from './metadata-extractor.service';
import { DeterministicImportanceScorer } from './deterministic-importance-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { ExternalDataEventPublisher } from './external-data-event-publisher.service';

export interface IngestionResult {
  totalFetched: number;
  accepted: number;
  duplicates: number;
  rejected: number;
}

@Injectable()
export class NewsIngestionService {
  private readonly logger = new Logger(NewsIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly canonicalizer: UrlCanonicalizer,
    private readonly deduplication: DeduplicationService,
    private readonly metadataExtractor: MetadataExtractor,
    private readonly scorer: DeterministicImportanceScorer,
    private readonly providerHealth: ProviderHealthService,
    private readonly eventPublisher: ExternalDataEventPublisher,
  ) {}

  async processRawNewsItems(
    sourceId: string,
    sourceType: NewsSourceType,
    reliabilityScore: number,
    isOfficialSource: boolean,
    rawItems: RawNewsItem[],
  ): Promise<IngestionResult> {
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const rawItem of rawItems) {
      try {
        if (!rawItem.title || !rawItem.url) {
          rejected++;
          continue;
        }

        // 1. Canonicalization
        const { canonicalUrl } = this.canonicalizer.canonicalize(rawItem.url);
        const { normalizedTitle } = this.canonicalizer.normalizeTitle(rawItem.title);

        // 2. Exact Deduplication Check (by canonical URL)
        const existingByUrl = await this.prisma.newsArticle.findUnique({
          where: { canonicalUrl },
          include: { sourceReferences: true },
        });

        if (existingByUrl) {
          duplicates++;
          await this.addSourceReferenceToArticle(existingByUrl.id, sourceId, rawItem);
          continue;
        }

        // 3. Near-Duplicate Check (recent articles with high title similarity)
        const recentArticles = await this.prisma.newsArticle.findMany({
          where: {
            publishedAt: {
              gte: new Date(Date.now() - 72 * 60 * 60 * 1000), // last 72 hours
            },
            status: NewsArticleStatus.ACTIVE,
          },
          select: { id: true, title: true, normalizedTitle: true, duplicateGroupId: true },
          take: 100,
          orderBy: { publishedAt: 'desc' },
        });

        let duplicateMatchId: string | null = null;
        for (const recent of recentArticles) {
          const { isDuplicate } = this.deduplication.isNearDuplicate(
            normalizedTitle,
            recent.normalizedTitle,
            0.85,
          );
          if (isDuplicate) {
            duplicateMatchId = recent.id;
            break;
          }
        }

        if (duplicateMatchId) {
          duplicates++;
          await this.handleNearDuplicate(duplicateMatchId, sourceId, rawItem);
          continue;
        }

        // 4. Metadata Extraction
        const { symbols, topics, entities } = this.metadataExtractor.extractMetadata(
          rawItem.title,
          rawItem.summary || rawItem.excerpt || '',
        );

        // 5. Deterministic Importance Scoring
        const assessment = this.scorer.calculateScore({
          sourceReliabilityScore: reliabilityScore,
          isOfficialSource,
          category: rawItem.categories?.[0],
          relatedSymbolsCount: symbols.length,
          duplicateCount: 1,
          publishedAt: rawItem.publishedAt,
          title: rawItem.title,
          summary: rawItem.summary,
        });

        // Compute Content Hash
        const contentHash = crypto
          .createHash('sha256')
          .update(`${normalizedTitle}:${canonicalUrl}`)
          .digest('hex');

        // 6. Persistence
        const createdArticle = await this.prisma.newsArticle.create({
          data: {
            sourceId,
            externalId: rawItem.externalId || null,
            sourceType,
            title: rawItem.title,
            normalizedTitle,
            summary: rawItem.summary || null,
            excerpt: rawItem.excerpt || null,
            canonicalUrl,
            originalUrl: rawItem.url,
            author: rawItem.author || null,
            language: rawItem.language || 'en',
            imageUrl: rawItem.imageUrl || null,
            publishedAt: rawItem.publishedAt,
            reliabilityScore,
            importanceScore: assessment.score,
            contentHash,
            status: NewsArticleStatus.ACTIVE,
            symbols: {
              create: symbols.map((symbol) => ({ symbol, confidence: 1.0 })),
            },
            topics: {
              create: topics.map((topic) => ({ topic, confidence: 1.0 })),
            },
            entities: {
              create: entities.map((e) => ({ entity: e.entity, entityType: e.entityType, confidence: 1.0 })),
            },
            sourceReferences: {
              create: {
                sourceId,
                externalId: rawItem.externalId || null,
                publishedAt: rawItem.publishedAt,
                canonicalUrl,
              },
            },
          },
        });

        accepted++;

        // 7. Event Bus & WebSocket Broadcast
        await this.eventPublisher.publishNewsArticleCreated(createdArticle, assessment, symbols, topics);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.logger.error(`Error processing raw news item "${rawItem.title}": ${msg}`, stack);
        rejected++;
      }
    }

    return {
      totalFetched: rawItems.length,
      accepted,
      duplicates,
      rejected,
    };
  }

  private async addSourceReferenceToArticle(articleId: string, sourceId: string, item: RawNewsItem) {
    const existingRef = await this.prisma.newsSourceReference.findFirst({
      where: { articleId, sourceId },
    });
    if (!existingRef) {
      const { canonicalUrl } = this.canonicalizer.canonicalize(item.url);
      await this.prisma.newsSourceReference.create({
        data: {
          articleId,
          sourceId,
          externalId: item.externalId || null,
          publishedAt: item.publishedAt,
          canonicalUrl,
        },
      });
    }
  }

  private async handleNearDuplicate(
    primaryArticleId: string,
    sourceId: string,
    item: RawNewsItem,
  ) {
    const primary = await this.prisma.newsArticle.findUnique({
      where: { id: primaryArticleId },
    });
    if (!primary) return;

    let groupId = primary.duplicateGroupId;
    if (!groupId) {
      const newGroup = await this.prisma.newsDuplicateGroup.create({
        data: { primaryArticleId },
      });
      groupId = newGroup.id;

      await this.prisma.newsArticle.update({
        where: { id: primaryArticleId },
        data: { duplicateGroupId: groupId },
      });
    }

    // Add source reference to primary article
    await this.addSourceReferenceToArticle(primaryArticleId, sourceId, item);
  }
}
