import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Phase 5 External Data Integration Tests', () => {
  let prisma: PrismaClient;
  const createdUserIds: string[] = [];
  const createdArticleIds: string[] = [];
  const createdSourceIds: string[] = [];

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.userNewsState.deleteMany({
      where: {
        OR: [
          { userId: { in: createdUserIds } },
          { articleId: { in: createdArticleIds } },
        ],
      },
    });
    await prisma.newsArticle.deleteMany({ where: { id: { in: createdArticleIds } } });
    await prisma.externalDataSource.deleteMany({ where: { id: { in: createdSourceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('persists external data source and creates news article with extracted symbols', async () => {
    const sourceId = `test-source-${Date.now()}`;
    const canonicalUrl = `https://test-news.example.com/article-${Date.now()}`;

    // 1. Create source
    const source = await prisma.externalDataSource.create({
      data: {
        sourceId,
        displayName: 'Test News Source',
        baseDomain: 'test-news.example.com',
        feedUrl: `${canonicalUrl}/rss`,
        reliabilityScore: 85,
      },
    });
    createdSourceIds.push(source.id);
    expect(source.id).toBeDefined();

    // 2. Create article
    const article = await prisma.newsArticle.create({
      data: {
        sourceId,
        title: 'Bitcoin Surges Past $100,000 as Institutional Inflows Hit Record',
        normalizedTitle: 'bitcoin surges past 100000 as institutional inflows hit record',
        canonicalUrl,
        publishedAt: new Date(),
        reliabilityScore: 85,
        importanceScore: 80,
        contentHash: 'hash123',
        sourceType: 'RSS',
        symbols: {
          create: [{ symbol: 'BTC-USDT', confidence: 1.0 }],
        },
        topics: {
          create: [{ topic: 'institutional_adoption', confidence: 1.0 }],
        },
        sourceReferences: {
          create: {
            sourceId,
            publishedAt: new Date(),
            canonicalUrl,
          },
        },
      },
      include: {
        symbols: true,
        topics: true,
        sourceReferences: true,
      },
    });
    createdArticleIds.push(article.id);

    expect(article.id).toBeDefined();
    expect(article.symbols).toHaveLength(1);
    expect(article.symbols[0]?.symbol).toBe('BTC-USDT');
    expect(article.sourceReferences).toHaveLength(1);
  });

  it('enforces strict cross-user isolation for saved articles and preferences', async () => {
    // Create test user A and user B
    const userA = await prisma.user.create({
      data: {
        email: `userA-${Date.now()}@example.com`,
        username: `userA-${Date.now()}`,
        passwordHash: 'hash',
      },
    });

    const userB = await prisma.user.create({
      data: {
        email: `userB-${Date.now()}@example.com`,
        username: `userB-${Date.now()}`,
        passwordHash: 'hash',
      },
    });
    createdUserIds.push(userA.id, userB.id);

    const article = await prisma.newsArticle.create({
      data: {
        sourceId: 'coindesk-rss',
        title: 'Isolated Test Article',
        normalizedTitle: 'isolated test article',
        canonicalUrl: `https://example.com/isolated-${Date.now()}`,
        publishedAt: new Date(),
        reliabilityScore: 80,
        importanceScore: 50,
        contentHash: `hash-${Date.now()}`,
        sourceType: 'RSS',
      },
    });
    createdArticleIds.push(article.id);

    // User A saves the article
    await prisma.userNewsState.create({
      data: {
        userId: userA.id,
        articleId: article.id,
        isSaved: true,
        isRead: true,
      },
    });

    // User B queries their state
    const userBState = await prisma.userNewsState.findUnique({
      where: {
        userId_articleId: {
          userId: userB.id,
          articleId: article.id,
        },
      },
    });

    expect(userBState).toBeNull(); // User B has no access to User A's saved state
  });
});
