import { describe, expect, it } from 'vitest';
import { DeduplicationService } from '../../src/modules/external-data/application/services/deduplication.service';

describe('DeduplicationService', () => {
  const service = new DeduplicationService();

  it('detects high Jaccard and Cosine similarity for near-duplicate titles', () => {
    const titleA = 'bitcoin reaches new all time high above 100000 dollars';
    const titleB = 'bitcoin reaches new all time high above 100k dollars';

    const result = service.isNearDuplicate(titleA, titleB, 0.70);

    expect(result.jaccardScore).toBeGreaterThan(0.70);
    expect(result.cosineScore).toBeGreaterThan(0.70);
    expect(result.isDuplicate).toBe(true);
  });

  it('distinguishes distinct titles as non-duplicates', () => {
    const titleA = 'bitcoin surges following fed interest rate cut';
    const titleB = 'solana ecosystem volume reaches record high in defi';

    const result = service.isNearDuplicate(titleA, titleB, 0.85);

    expect(result.isDuplicate).toBe(false);
  });
});
