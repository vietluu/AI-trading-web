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
    exchangeConnection: {
      findMany: vi.fn().mockResolvedValue([{ provider: 'OKX_FUTURES' }]),
    },
    researchValidationRun: { findMany: vi.fn().mockResolvedValue(validationRows) },
  };
  return new QuantIntelligenceService(prisma as never, {} as never, {} as never, {} as never) as unknown as EvidenceReader;
}

describe('multi-symbol validation evidence', () => {
  it('requires evidence across every configured symbol and timeframe', async () => {
    const service = createService([
      { id: '1', symbol: 'ALGO-USDT', provider: 'OKX_FUTURES', interval: '15m', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 1.1 },
      { id: '2', symbol: 'ALGO-USDT', provider: 'OKX_FUTURES', interval: '1h', createdAt: new Date(), walkForwardStable: false, outOfSampleSharpe: -0.2 },
      { id: '3', symbol: 'ARB-USDT', provider: 'OKX_FUTURES', interval: '15m', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 0.8 },
      { id: '4', symbol: 'ARB-USDT', provider: 'OKX_FUTURES', interval: '1h', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 0.7 },
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
      { id: 'btc', symbol: 'BTC-USDT', provider: 'OKX_FUTURES', interval: '15m', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 4 },
      { id: '1', symbol: 'ALGO-USDT', provider: 'OKX_FUTURES', interval: '15m', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 1.1 },
      { id: '2', symbol: 'ALGO-USDT', provider: 'OKX_FUTURES', interval: '1h', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 0.9 },
    ]);

    await expect(service.multiSymbolValidationEvidence('user-1', [])).resolves.toMatchObject({
      requiredPairs: 4,
      availablePairs: 2,
      coveragePct: 50,
      everySymbolCovered: false,
      passed: false,
    });
  });

  it('does not authorize stale or wrong-provider validation evidence', async () => {
    const stale = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const service = createService([
      { id: 'wrong', symbol: 'ALGO-USDT', provider: 'BINANCE_FUTURES', interval: '15m', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 3 },
      { id: 'stale', symbol: 'ALGO-USDT', provider: 'OKX_FUTURES', interval: '15m', createdAt: stale, walkForwardStable: true, outOfSampleSharpe: 2 },
    ]);

    await expect(service.multiSymbolValidationEvidence('user-1', ['ALGO-USDT'])).resolves.toMatchObject({
      requiredPairs: 2,
      availablePairs: 0,
      passingPairs: 0,
      passed: false,
    });
  });

  it('uses the requested strategy symbols even when they are outside preferred scope', async () => {
    const service = createService([
      { id: 'sol-15', symbol: 'SOL-USDT', provider: 'OKX_FUTURES', interval: '15m', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 1 },
      { id: 'sol-1h', symbol: 'SOL-USDT', provider: 'OKX_FUTURES', interval: '1h', createdAt: new Date(), walkForwardStable: true, outOfSampleSharpe: 1 },
    ]);

    await expect(service.multiSymbolValidationEvidence('user-1', ['SOL-USDT'])).resolves.toMatchObject({
      requiredPairs: 2,
      availablePairs: 2,
      passed: true,
    });
  });
});
