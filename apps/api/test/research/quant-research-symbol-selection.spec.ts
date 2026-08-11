import { describe, expect, it, vi } from 'vitest';
import { QuantIntelligenceService } from '../../src/modules/research/application/quant-intelligence.service';

function serviceWith(preferredSymbols: string[], pipelineSymbols: string[]) {
  const prisma = {
    userSetting: { findUnique: vi.fn().mockResolvedValue({ preferredSymbols }) },
    pipelineRun: { findMany: vi.fn().mockResolvedValue(pipelineSymbols.map((symbol) => ({ symbol }))) },
  };
  return new QuantIntelligenceService(prisma as never, {} as never, {} as never, {} as never);
}

describe('Quant Research symbol selection', () => {
  it('combines configured symbols with recently triggered pipeline symbols without duplicates', async () => {
    const service = serviceWith(['sol_usdt', 'BTC-USDT'], ['ADA-USDT', 'BTC-USDT']);

    await expect(service.getSelectedResearchSymbols('user-1')).resolves.toEqual({
      settings: ['SOL-USDT', 'BTC-USDT'],
      pipelineTriggers: ['ADA-USDT', 'BTC-USDT'],
      symbols: ['SOL-USDT', 'BTC-USDT', 'ADA-USDT'],
    });
  });

  it('returns an explicit no-symbol state instead of defaulting to BTC', async () => {
    const service = serviceWith([], []);

    await expect(service.generateSelectedHypotheses('user-1')).resolves.toMatchObject({
      status: 'NO_SYMBOLS_SELECTED',
      symbols: [],
      hypotheses: [],
    });
  });
});
