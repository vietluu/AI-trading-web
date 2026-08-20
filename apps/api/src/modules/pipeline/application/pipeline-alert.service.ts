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
    const alert = await this.prisma.pipelineAlert.create({ data: { runId, kind: 'ACTIONABLE_DECISION', symbol, decision: output.decision, confidence: output.confidence, reasoningSummary: output.reasoning, delivered: true } });
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
    for (const item of alerts) {
      await this.prisma.pipelineAlert.create({ data: { runId, symbol, ...item, delivered: true } });
      this.logger.warn({ event: 'pipeline_context_alert', channel: 'CONSOLE', symbol, kind: item.kind });
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
  }): Promise<void> {
    if (!['LONG', 'SHORT'].includes(input.decision)) return;
    const direction = input.decision === 'LONG' ? 'UP' : 'DOWN';
    const aligned = input.analyses.market.trend.direction === direction &&
      input.analyses.technical.trend.direction === direction &&
      input.multiTimeframeConfirmation >= 80;
    const quantEvidenceUnavailable = input.blockedReasons.some((reason) =>
      reason === 'QUANT_VALIDATION_STALE' || reason === 'QUANT_VALIDATION_MISSING');
    if (!aligned || !quantEvidenceUnavailable) return;

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
    await this.prisma.pipelineAlert.create({
      data: {
        runId: input.runId,
        kind: 'MISSED_OPPORTUNITY',
        symbol: input.symbol,
        decision: input.decision,
        confidence: input.confidence,
        reasoningSummary: `${blockedCount} aligned directional signals were blocked by stale or missing Quant evidence during the last hour.`,
        delivered: true,
      },
    });
    this.logger.error({
      event: 'pipeline_missed_opportunity', userId: input.userId,
      blockedSignals: blockedCount, windowMinutes: 60,
    });
  }
}
