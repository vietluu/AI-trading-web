import { describe, expect, it, vi } from 'vitest';
import { QuantIntelligenceService } from '../../src/modules/research/application/quant-intelligence.service';

type EvidenceReader = {
  multiSymbolValidationEvidence(userId: string, symbols: string[]): Promise<{
    requiredPairs: number;
    availablePairs: number;
    passingPairs: number;
    coveragePct: number;
    everySymbolCovered: boolean;
    passed: boolean;
  }>;
};

function createService(validationRows: Array<Record<string, unknown>>) {
  const prisma = {
    userSetting: {
      findUnique: vi.fn().mockImplementation(({ select }: { select: Record<string, boolean> }) =>
        Promise.resolve(select.preferredSymbols
          ? { preferredSymbols: ['ALGO-USDT', 'ARB-USDT'] }
          : { preferredTimeframes: ['15m', '1h'] }),
      ),
    },
    pipelineRun: { findMany: vi.fn().mockResolvedValue([]) },
    researchValidationRun: { findMany: vi.fn().mockResolvedValue(validationRows) },
  };
  return new QuantIntelligenceService(prisma as never, {} as never, {} as never, {} as never) as unknown as EvidenceReader;
}

describe('multi-symbol validation evidence', () => {
  it('requires evidence across every configured symbol and timeframe', async () => {
    const service = createService([
      { id: '1', symbol: 'ALGO-USDT', interval: '15m', walkForwardStable: true, outOfSampleSharpe: 1.1 },
      { id: '2', symbol: 'ALGO-USDT', interval: '1h', walkForwardStable: false, outOfSampleSharpe: -0.2 },
      { id: '3', symbol: 'ARB-USDT', interval: '15m', walkForwardStable: true, outOfSampleSharpe: 0.8 },
      { id: '4', symbol: 'ARB-USDT', interval: '1h', walkForwardStable: true, outOfSampleSharpe: 0.7 },
    ]);

    await expect(service.multiSymbolValidationEvidence('user-1', [])).resolves.toMatchObject({
      requiredPairs: 4,
      availablePairs: 4,
      passingPairs: 3,
      coveragePct: 100,
      everySymbolCovered: true,
      passed: true,
    });
  });

  it('does not let BTC or one covered symbol stand in for a missing configured symbol', async () => {
    const service = createService([
      { id: 'btc', symbol: 'BTC-USDT', interval: '15m', walkForwardStable: true, outOfSampleSharpe: 4 },
      { id: '1', symbol: 'ALGO-USDT', interval: '15m', walkForwardStable: true, outOfSampleSharpe: 1.1 },
      { id: '2', symbol: 'ALGO-USDT', interval: '1h', walkForwardStable: true, outOfSampleSharpe: 0.9 },
    ]);

    await expect(service.multiSymbolValidationEvidence('user-1', [])).resolves.toMatchObject({
      requiredPairs: 4,
      availablePairs: 3,
      coveragePct: 75,
      everySymbolCovered: false,
      passed: false,
    });
  });
});
