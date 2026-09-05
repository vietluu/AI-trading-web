import { Injectable, Logger } from '@nestjs/common';
import type { DecisionOutput, FusionInput } from '@platform/shared';
import { PrismaService } from '../../../database/prisma.service';
import { PipelineConfigService } from './pipeline-config.service';

@Injectable()
export class PipelineAlertService {
  private readonly logger = new Logger(PipelineAlertService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: PipelineConfigService) {}
  async decision(runId: string, symbol: string, output: DecisionOutput): Promise<void> {
    if (output.decision === 'WAIT' || output.confidence < this.config.minConfidence) return;
    const alert = await this.prisma.pipelineAlert.create({ data: { runId, kind: 'ACTIONABLE_DECISION', symbol, decision: output.decision, confidence: output.confidence, reasoningSummary: output.reasoning, delivered: false } });
    this.logger.warn({ event: 'pipeline_alert', channel: 'CONSOLE', alert: { id: alert.id, symbol, decision: output.decision, confidence: output.confidence, timestamp: alert.createdAt } });
  }
  async repeatedFailure(runId: string, symbol: string): Promise<void> {
    const failures = await this.prisma.pipelineRun.count({ where: { symbol, status: { in: ['FAILED', 'TIMEOUT'] }, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
    if (failures < 3) return;
    await this.prisma.pipelineAlert.create({ data: { runId, kind: 'REPEATED_FAILURE', symbol, reasoningSummary: `${failures} failures occurred during the last hour.`, delivered: true } });
    this.logger.error({ event: 'pipeline_repeated_failures', symbol, failures });
  }
  async contextual(runId: string, symbol: string, analyses: FusionInput): Promise<void> {
    const alerts: Array<{ kind: string; reasoningSummary: string }> = [];
    if (analyses.market.volatility.level === 'HIGH') alerts.push({ kind: 'ABNORMAL_VOLATILITY', reasoningSummary: analyses.market.summary });
    if (analyses.news.impact.level === 'HIGH') alerts.push({ kind: 'MAJOR_NEWS', reasoningSummary: analyses.news.summary });
    if (alerts.length === 0) return;
    const cooldownSince = new Date(Date.now() - 60 * 60_000);
    for (const item of alerts) {
      const recentAlert = await this.prisma.pipelineAlert.findFirst({
        where: { symbol, kind: item.kind, createdAt: { gte: cooldownSince } },
      });
      if (!recentAlert) {
        await this.prisma.pipelineAlert.create({ data: { runId, symbol, ...item, delivered: true } });
        this.logger.warn({ event: 'pipeline_context_alert', channel: 'CONSOLE', symbol, kind: item.kind });
      }
    }
  }
  async blockedOpportunity(input: {
    runId: string;
    userId: string;
    symbol: string;
    decision: string;
    confidence: number;
    blockedReasons: string[];
    analyses: FusionInput;
    multiTimeframeConfirmation: number;
    priceChangePercent?: number;
  }): Promise<void> {
    if (!['LONG', 'SHORT'].includes(input.decision)) return;
    const direction = input.decision === 'LONG' ? 'UP' : 'DOWN';
    const aligned = input.analyses.market.trend.direction === direction &&
      input.analyses.technical.trend.direction === direction &&
      input.multiTimeframeConfirmation >= 80;
    const systematicExecutionBlock = input.blockedReasons.some((reason) =>
      reason.startsWith('QUANT_') ||
      reason.includes('CALIBRAT') ||
      reason === 'PARTIAL_DATA_CONVICTION_TOO_LOW' ||
      reason === 'CONFIDENCE_BELOW_THRESHOLD');
    const hasNegativeExpectancy = input.blockedReasons.some((reason) =>
      reason === 'EXPECTED_VALUE_NEGATIVE' ||
      reason === 'EXPECTED_VALUE_TOO_LOW' ||
      reason === 'PROFIT_FACTOR_TOO_LOW');
    if (!aligned || !systematicExecutionBlock || hasNegativeExpectancy) return;

    const since = new Date(Date.now() - 60 * 60_000);
    await this.prisma.pipelineAlert.create({
      data: {
        runId: input.runId,
        kind: 'BLOCKED_DIRECTIONAL_SIGNAL',
        symbol: input.symbol,
        decision: input.decision,
        confidence: input.confidence,
        reasoningSummary: `Aligned directional signal blocked by ${input.blockedReasons.join(', ')}.`,
        delivered: false,
      },
    });
    const [blockedCount, existingIncident] = await Promise.all([
      this.prisma.pipelineAlert.count({
        where: { kind: 'BLOCKED_DIRECTIONAL_SIGNAL', createdAt: { gte: since }, run: { userId: input.userId } },
      }),
      this.prisma.pipelineAlert.findFirst({
        where: { kind: 'MISSED_OPPORTUNITY', createdAt: { gte: since }, run: { userId: input.userId } },
      }),
    ]);
    if (blockedCount < 5 || existingIncident) return;
    const observedMove = typeof input.priceChangePercent === 'number' &&
      Number.isFinite(input.priceChangePercent)
        ? input.priceChangePercent
        : undefined;
    await this.prisma.pipelineAlert.create({
      data: {
        runId: input.runId,
        kind: 'MISSED_OPPORTUNITY',
        symbol: input.symbol,
        decision: input.decision,
        confidence: input.confidence,
        reasoningSummary: `${blockedCount} aligned directional signals were blocked by execution gates during the last hour. Top current reasons: ${input.blockedReasons.join(', ')}.${observedMove !== undefined ? ` Observed market move: ${observedMove.toFixed(2)}%.` : ''}`,
        delivered: true,
      },
    });
    this.logger.error({
      event: 'pipeline_missed_opportunity', userId: input.userId,
      symbol: input.symbol, blockedSignals: blockedCount,
      blockedReasons: input.blockedReasons,
      priceChangePercent: input.priceChangePercent,
      windowMinutes: 60,
    });
  }
  confluenceEvaluation(params: {
    batchId: string;
    userId: string;
    selectedSymbol: string;
    selectedScore: number;
    concordanceCount: number;
    totalSymbols: number;
    sizeFactor: number;
    rejectedSymbols: string[];
  }): void {
    this.logger.log({
      event: 'pipeline_confluence_evaluated',
      batchId: params.batchId,
      userId: params.userId,
      selectedSymbol: params.selectedSymbol,
      selectedScore: params.selectedScore,
      concordanceCount: params.concordanceCount,
      totalSymbols: params.totalSymbols,
      sizeFactor: params.sizeFactor,
      rejectedSymbols: params.rejectedSymbols,
    });
  }
}
