import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface GeneratedReport {
  id?: string;
  reportType: ReportType;
  title: string;
  summary: string;
  metrics: Record<string, unknown>;
  recommendations: string[];
  generatedAt: string;
}

@Injectable()
export class QuantReportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateReport(reportType: ReportType, userId: string): Promise<GeneratedReport> {
    const title = `${reportType} Quantitative Intelligence Report`;
    const cutoff = new Date(Date.now() - (reportType === 'DAILY' ? 1 : reportType === 'WEEKLY' ? 7 : 30) * 24 * 60 * 60_000);
    const [trades, evaluations, hypotheses, factors, validation] = await Promise.all([
      this.prisma.closedTrade.findMany({ where: { userId, closedAt: { gte: cutoff } }, orderBy: { closedAt: 'asc' } }),
      this.prisma.performanceRecord.findMany({ where: { userId, evaluatedAt: { gte: cutoff }, decision: { in: ['LONG', 'SHORT'] } } }),
      this.prisma.quantHypothesis.count({ where: { userId, createdAt: { gte: cutoff } } }),
      this.prisma.factorEvaluation.findMany({ where: { userId }, orderBy: { predictivePower: 'desc' }, take: 1 }),
      this.prisma.researchValidationRun.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const returns = trades.flatMap((trade) => trade.returnPct === null ? [] : [trade.returnPct]);
    const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null;
    const variance = mean !== null && returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : null;
    const grossProfit = trades.filter((trade) => Number(trade.netPnl) > 0).reduce((sum, trade) => sum + Number(trade.netPnl), 0);
    const grossLoss = Math.abs(trades.filter((trade) => Number(trade.netPnl) < 0).reduce((sum, trade) => sum + Number(trade.netPnl), 0));
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    for (const value of returns) {
      equity *= 1 + value;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
    const metrics = {
      source: 'EXCHANGE_CLOSED_TRADES_AND_PIPELINE_EVALUATIONS',
      expectedValuePct: mean === null ? null : Number((mean * 100).toFixed(4)),
      profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(4)) : grossProfit > 0 ? null : 0,
      sharpeRatio: mean !== null && variance !== null && variance > 0 ? Number((mean / Math.sqrt(variance) * Math.sqrt(returns.length)).toFixed(4)) : null,
      maxDrawdownPct: returns.length ? Number((maxDrawdown * 100).toFixed(4)) : null,
      winRatePct: trades.length ? Number((trades.filter((trade) => Number(trade.netPnl) > 0).length / trades.length * 100).toFixed(2)) : null,
      netPnl: Number(trades.reduce((sum, trade) => sum + Number(trade.netPnl), 0).toFixed(8)),
      closedTrades: trades.length,
      pipelineEvaluations: evaluations.length,
      hypothesesTested: hypotheses,
      topFactor: factors[0]?.factorName ?? null,
      latestValidationRunId: validation?.id ?? null,
    };
    const recommendations: string[] = [];
    if (!trades.length) recommendations.push('Collect verified closed trades before changing live allocation.');
    if (metrics.profitFactor !== null && metrics.profitFactor < 1) recommendations.push('Do not increase risk: verified profit factor is below 1.');
    if (validation === null) recommendations.push('Run walk-forward and out-of-sample validation before deploying research changes.');
    if (!recommendations.length) recommendations.push('Keep the current governed configuration and continue collecting verified evidence.');
    const summary = `${trades.length} verified closed trades and ${evaluations.length} evaluated pipeline decisions are available for this ${reportType.toLowerCase()} window.`;

    const generatedAt = new Date().toISOString();
    const record = await this.prisma.quantReportRecord.create({
      data: {
        userId,
        reportType,
        title,
        summary,
        metricsJson: metrics,
        recommendations,
        generatedAt: new Date(),
      },
    });

    return {
      id: record.id,
      reportType,
      title,
      summary,
      metrics,
      recommendations,
      generatedAt,
    };
  }
}
