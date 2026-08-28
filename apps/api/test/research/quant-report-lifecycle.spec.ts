import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QuantReportService } from '../../src/modules/research/application/quant-report.service';
import type { PrismaService } from '../../src/database/prisma.service';

describe('QuantReportService (Daily, Weekly, Monthly Performance Attribution)', () => {
  let reportService: QuantReportService;
  let prismaMock: {
    closedTrade: { findMany: ReturnType<typeof vi.fn> };
    performanceRecord: { findMany: ReturnType<typeof vi.fn> };
    quantHypothesis: { count: ReturnType<typeof vi.fn> };
    factorEvaluation: { findMany: ReturnType<typeof vi.fn> };
    researchValidationRun: { findFirst: ReturnType<typeof vi.fn> };
    quantReportRecord: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prismaMock = {
      closedTrade: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 't1',
            clientOrderId: 't1-cloid',
            symbol: 'BTC-USDT',
            side: 'BUY',
            entryPrice: 50000,
            exitPrice: 51000,
            size: 1,
            netPnl: 1000,
            grossPnl: 1010,
            fee: 10,
            closedAt: new Date(),
          },
          {
            id: 't2',
            clientOrderId: 't2-cloid',
            symbol: 'ETH-USDT',
            side: 'SELL',
            entryPrice: 3000,
            exitPrice: 3100,
            size: 2,
            netPnl: -200,
            grossPnl: -190,
            fee: 10,
            closedAt: new Date(),
          },
        ]),
      },
      performanceRecord: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', decision: 'LONG', outcome: 'CORRECT' },
          { id: 'p2', decision: 'SHORT', outcome: 'INCORRECT' },
        ]),
      },
      quantHypothesis: { count: vi.fn().mockResolvedValue(5) },
      factorEvaluation: {
        findMany: vi.fn().mockResolvedValue([{ factorName: 'momentum_rsi_14', predictivePower: 0.72 }]),
      },
      researchValidationRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'val-run-1' }),
      },
      quantReportRecord: {
        create: vi.fn().mockResolvedValue({ id: 'report-1' }),
      },
    };

    reportService = new QuantReportService(prismaMock as unknown as PrismaService);
  });

  it('generates a DAILY quantitative intelligence report with accurate attribution metrics', async () => {
    const report = await reportService.generateReport('DAILY', 'user-1');

    expect(report.reportType).toBe('DAILY');
    expect(report.title).toBe('DAILY Quantitative Intelligence Report');
    expect(report.metrics).toBeDefined();
    expect(report.metrics.closedTrades).toBe(2);
    expect(report.metrics.netPnl).toBe(800);
    expect(report.metrics.winRatePct).toBe(50);
    expect(report.metrics.profitFactor).toBe(5); // 1000 / 200 = 5
    expect(report.metrics.hypothesesTested).toBe(5);
    expect(report.metrics.topFactor).toBe('momentum_rsi_14');
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('generates a WEEKLY quantitative intelligence report', async () => {
    const report = await reportService.generateReport('WEEKLY', 'user-1');

    expect(report.reportType).toBe('WEEKLY');
    expect(report.title).toBe('WEEKLY Quantitative Intelligence Report');
    expect(report.metrics.closedTrades).toBe(2);
  });
});
