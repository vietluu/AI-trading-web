import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PerformancePage from '@/app/ai/performance/page';
import { apiRequest } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiRequest: vi.fn() }));

describe('PerformancePage - Recovery Cohort Comparison', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders recovery cohort comparison, labels shadow as simulated, and renders NO mutation controls', async () => {
    const recoveryCohortResponse = {
      cohortKey: 'BINANCE_FUTURES:BTC-USDT:15m:RECOVERY_RECLAIM:IMMATURE',
      control: {
        type: 'CONTROL_REALIZED',
        metrics: {
          sampleSize: 150,
          winCount: 85,
          lossCount: 65,
          scratchCount: 0,
          winRate: 0.567,
          meanNetR: 0.25,
          lowerConfidenceBoundNetR: 0.08,
          profitFactor: 1.35,
          grossProfit: 4500,
          grossLoss: 3333,
          maxDrawdown: 350,
          averageMfe: 180,
          averageMae: -75,
          stopBeforeTargetRate: 0.42,
          exclusions: { duplicateCount: 2, incompleteCount: 1, supersededCount: 0, corruptedCount: 0, totalExcluded: 3 },
          sensitivity: { doubledCostProfitFactor: 1.10, doubledCostMeanNetR: 0.05, doubledCostResilient: true },
        },
      },
      candidate: {
        type: 'CANDIDATE_SHADOW',
        isSimulated: true,
        metrics: {
          sampleSize: 120,
          winCount: 75,
          lossCount: 45,
          scratchCount: 0,
          winRate: 0.625,
          meanNetR: 0.38,
          lowerConfidenceBoundNetR: 0.15,
          profitFactor: 1.55,
          grossProfit: 5200,
          grossLoss: 3350,
          maxDrawdown: 280,
          averageMfe: 220,
          averageMae: -65,
          stopBeforeTargetRate: 0.36,
          exclusions: { duplicateCount: 0, incompleteCount: 2, supersededCount: 0, corruptedCount: 0, totalExcluded: 2 },
          sensitivity: { doubledCostProfitFactor: 1.25, doubledCostMeanNetR: 0.12, doubledCostResilient: true },
        },
        walkForwardFolds: [
          { foldIndex: 1, sampleSize: 40, meanNetR: 0.35, profitFactor: 1.45 },
          { foldIndex: 2, sampleSize: 40, meanNetR: 0.42, profitFactor: 1.65 },
          { foldIndex: 3, sampleSize: 40, meanNetR: 0.37, profitFactor: 1.55 },
        ],
        calibrationQuality: 'GOOD',
        promotionEligibility: {
          eligible: true,
          reasons: [],
        },
      },
      generatedAt: '2026-09-14T12:00:00.000Z',
    };

    vi.mocked(apiRequest).mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('/ai/reflection/recovery-cohorts')) {
        return Promise.resolve(recoveryCohortResponse);
      }
      if (typeof path === 'string' && path.includes('/ai/performance/metrics')) {
        return Promise.resolve({
          accuracy: 60,
          winRate: 58,
          averageReturn: 1.2,
          maxDrawdown: 4.5,
          decisionDistribution: { LONG: 10, SHORT: 5, WAIT: 2 },
          confidenceAccuracyCorrelation: '0.45',
        });
      }
      if (typeof path === 'string' && path.includes('/ai/performance')) {
        return Promise.resolve([]);
      }
      return Promise.resolve({});
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PerformancePage />
      </QueryClientProvider>,
    );

    // Await async query resolution
    await screen.findByText('Control (Realized)', {}, { timeout: 4000 });

    expect(screen.getByText('Recovery Cohort Comparison')).toBeInTheDocument();
    // Verify Simulated Shadow badge is rendered
    expect(screen.getByText('Simulated Shadow Evidence')).toBeInTheDocument();

    // Verify Control and Candidate sections are present
    expect(screen.getByText('Control (Realized)')).toBeInTheDocument();
    expect(screen.getByText('Candidate (Shadow)')).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();

    // Verify promotion eligibility badge
    expect(screen.getByText('ELIGIBLE')).toBeInTheDocument();

    // Assert NO mutation or enable/promote controls exist anywhere in the component
    expect(screen.queryByRole('button', { name: /enable/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /promote/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /activate/i })).not.toBeInTheDocument();
  });
});
