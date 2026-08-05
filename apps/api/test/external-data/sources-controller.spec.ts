import { describe, expect, it, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { SourcesController } from '../../src/modules/external-data/presentation/controllers/sources.controller';

describe('SourcesController', () => {
  it('rejects a feed that does not return RSS/Atom items', async () => {
    const prisma = {
      externalDataSource: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };

    const httpClient = {
      validateSsrfTarget: vi.fn().mockResolvedValue(undefined),
    };

    const rssAdapter = {
      fetchLatest: vi.fn().mockResolvedValue({ items: [] }),
    };

    const controller = new SourcesController(
      prisma as never,
      httpClient as never,
      rssAdapter as never,
      { triggerManualRun: vi.fn() } as never,
    );

    await expect(
      controller.createSource({
        sourceId: 'valid-feed',
        displayName: 'Valid Feed',
        feedUrl: 'https://example.com/rss',
        language: 'en',
        categories: ['news'],
        reliabilityScore: 70,
        pollIntervalSeconds: 300,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
