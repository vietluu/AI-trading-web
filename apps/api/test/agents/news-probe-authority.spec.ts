import { describe, expect, it } from 'vitest';

import { evaluateNewsProbeAuthority } from '../../src/modules/agents/domain/news-probe-authority';

const now = new Date('2026-09-21T12:00:00.000Z');
const freshHighQualityNews = {
  importance: 90,
  confidence: 90,
  direction: 'POSITIVE' as const,
  sourceIds: ['coindesk'],
  publishedAt: '2026-09-21T11:55:00.000Z',
};
const priceVolumeExpansion = {
  priceChangePercent: 1.4,
  volumeRatio: 1.6,
  missingEvidence: ['LIQUIDATION_DATA_UNAVAILABLE'],
};

describe('evaluateNewsProbeAuthority', () => {
  it('rejects a single-source shock even when price and volume expand', () => {
    expect(evaluateNewsProbeAuthority({
      news: freshHighQualityNews,
      causality: priceVolumeExpansion,
      now,
    })).toEqual({
      allowed: false,
      reason: 'NEWS_CORROBORATION_INSUFFICIENT',
      corroborationCount: 0,
    });
  });

  it('authorizes a fresh two-source shock with price and volume confirmation', () => {
    expect(evaluateNewsProbeAuthority({
      news: { ...freshHighQualityNews, sourceIds: ['coindesk', 'reuters'] },
      causality: priceVolumeExpansion,
      now,
    })).toMatchObject({ allowed: true, corroborationCount: 1 });
  });

  it('authorizes a fresh single-source shock corroborated by usable open interest', () => {
    expect(evaluateNewsProbeAuthority({
      news: freshHighQualityNews,
      causality: { ...priceVolumeExpansion, deltaOiPercent: 1.2 },
      now,
    })).toMatchObject({ allowed: true, corroborationCount: 1 });
  });

  it('rejects stale news before it can accelerate a probe', () => {
    expect(evaluateNewsProbeAuthority({
      news: { ...freshHighQualityNews, publishedAt: '2026-09-21T11:20:00.000Z' },
      causality: { ...priceVolumeExpansion, deltaOiPercent: 1.2 },
      now,
    })).toMatchObject({ allowed: false, reason: 'NEWS_NOT_FRESH' });
  });

  it('rejects news when price and volume confirmation are unavailable', () => {
    expect(evaluateNewsProbeAuthority({
      news: freshHighQualityNews,
      causality: { deltaOiPercent: 1.2, missingEvidence: ['LIQUIDATION_DATA_UNAVAILABLE'] },
      now,
    })).toMatchObject({ allowed: false, reason: 'PRICE_VOLUME_CONFIRMATION_MISSING' });
  });

  it('rejects price expansion that contradicts the news direction', () => {
    expect(evaluateNewsProbeAuthority({
      news: {
        ...freshHighQualityNews,
        direction: 'NEGATIVE',
        sourceIds: ['coindesk', 'reuters'],
      },
      causality: priceVolumeExpansion,
      now,
    })).toMatchObject({ allowed: false, reason: 'PRICE_VOLUME_CONFIRMATION_MISSING' });
  });
});
