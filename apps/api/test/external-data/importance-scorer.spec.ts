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
});
