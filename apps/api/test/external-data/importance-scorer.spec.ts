import { describe, expect, it } from 'vitest';
import { DeterministicImportanceScorer } from '../../src/modules/external-data/application/services/deterministic-importance-scorer.service';

describe('DeterministicImportanceScorer', () => {
  const scorer = new DeterministicImportanceScorer();

  it('assigns high score (>= 70) for official exchange listings and security events', () => {
    const result = scorer.calculateScore({
      sourceReliabilityScore: 100,
      isOfficialSource: true,
      category: 'LISTING',
      relatedSymbolsCount: 2,
      duplicateCount: 1,
      publishedAt: new Date(),
      title: 'Binance Will List New Futures Contract',
    });

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(['HIGH', 'CRITICAL']).toContain(result.level);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('decays score for older articles', () => {
    const freshResult = scorer.calculateScore({
      sourceReliabilityScore: 80,
      isOfficialSource: false,
      category: 'GENERAL',
      relatedSymbolsCount: 1,
      duplicateCount: 1,
      publishedAt: new Date(),
      title: 'Crypto Market Update',
    });

    const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const oldResult = scorer.calculateScore({
      sourceReliabilityScore: 80,
      isOfficialSource: false,
      category: 'GENERAL',
      relatedSymbolsCount: 1,
      duplicateCount: 1,
      publishedAt: oldDate,
      title: 'Crypto Market Update',
    });

    expect(oldResult.score).toBeLessThan(freshResult.score);
  });

  it('promotes systemic crypto policy from extracted topics when RSS categories are absent', () => {
    const result = scorer.calculateScore({
      sourceReliabilityScore: 70,
      isOfficialSource: false,
      relatedSymbolsCount: 0,
      duplicateCount: 1,
      publishedAt: new Date(),
      title: 'President urges Senate to pass crypto market legislation',
      topics: ['regulation'],
      entities: [{ entity: 'White House', entityType: 'ORGANIZATION' }],
    });

    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(result.reasons).toContain('Systemic crypto-policy event: +15 pts');
  });
});
