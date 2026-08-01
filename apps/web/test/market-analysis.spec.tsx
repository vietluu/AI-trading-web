import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MarketAnalysisPage from '@/app/ai/market-analysis/page';
import { apiRequest } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiRequest: vi.fn() }));

describe('MarketAnalysisPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the market agent and displays every analysis section', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      id: 'run-1',
      status: 'COMPLETED',
      durationMs: 25,
      toolCallCount: 6,
      output: {
        summary: 'Market structure is orderly.',
        trend: { direction: 'UP', strength: 'MODERATE' },
        volatility: { level: 'MEDIUM', atr: '100' },
        liquidity: { bidAskSpread: '0.50', depthImbalance: 'BALANCED' },
        derivatives: {
          fundingRate: '0.0001',
          fundingTrend: 'STABLE',
          openInterest: '1000',
          oiTrend: 'INCREASING',
        },
        anomalies: ['Price/OI divergence'],
        dataQuality: 'GOOD',
        usedTools: ['market.ticker.get'],
        generatedAt: new Date().toISOString(),
      },
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MarketAnalysisPage />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run market analysis' }));

    await waitFor(() => expect(screen.getByText('Market structure is orderly.')).toBeInTheDocument());
    expect(screen.getByText('Trend')).toBeInTheDocument();
    expect(screen.getByText('Volatility')).toBeInTheDocument();
    expect(screen.getByText('Liquidity')).toBeInTheDocument();
    expect(screen.getByText('Derivatives')).toBeInTheDocument();
    expect(screen.getByText('Anomalies')).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith('/agents/MARKET_ANALYST/runs', expect.objectContaining({ method: 'POST' }));
  });
});
