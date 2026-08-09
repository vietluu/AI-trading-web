import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { QuantIntelligenceController } from '../../src/modules/research/presentation/quant-intelligence.controller';

describe('QuantIntelligenceController identity boundary', () => {
  it('returns 401 instead of dereferencing an absent portfolio user', () => {
    const service = { getPortfolioIntelligence: vi.fn() };
    const controller = new QuantIntelligenceController(service as never);

    expect(() => controller.getPortfolio(undefined)).toThrow(UnauthorizedException);
    expect(service.getPortfolioIntelligence).not.toHaveBeenCalled();
  });

  it('passes the authenticated user id to portfolio intelligence', async () => {
    const service = { getPortfolioIntelligence: vi.fn().mockReturnValue({}) };
    const controller = new QuantIntelligenceController(service as never);

    await controller.getPortfolio({ id: 'user-1' });

    expect(service.getPortfolioIntelligence).toHaveBeenCalledWith('user-1');
  });
});
