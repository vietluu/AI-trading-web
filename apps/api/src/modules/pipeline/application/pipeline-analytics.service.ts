import { Injectable, Logger } from '@nestjs/common';
import type { GateStage } from '../domain/gate-decision';

export interface StageTelemetryRecord {
  pipelineId: string;
  runId: string;
  symbol: string;
  exchange: string;
  timeframe: string;
  stageName: string;
  inputSummary: string;
  outputSummary: string;
  confidence: number;
  opportunityScore: number;
  riskScore: number;
  decision: string;
  rejectReason?: string;
  blockingStage?: GateStage;
  executionResult: string;
  durationMs: number;
  tokenUsage: number;
  apiCost: number;
  cacheHits?: Record<string, boolean>;
  sourceDataAgeMs?: number;
  decisionToExecutionMs?: number;
  submissionLatencyMs?: number;
  slippageBps?: number;
  createdAt: string;
  regime?: string;
  setup?: string;
  rangePercentile?: number;
  triggerDistance?: number;
  consumedMove?: number;
  candleFinality?: 'CLOSED' | 'INTRABAR';
  action?: 'ENTER' | 'PROBE' | 'WAIT';
  riskTier?: 'NORMAL' | 'PROBE' | 'BLOCKED';
  judgeVerdict?: string;
  quantReason?: string;
  approvedOrderType?: 'MARKET' | 'LIMIT';
  submittedOrderType?: 'MARKET' | 'LIMIT';
  planDrift?: boolean;
  lifecycleNetR?: number;
}

export interface AdaptiveRolloutMetrics {
  totalRecords: number;
  rangeOpportunitiesCount: number;
  rangeParticipationsCount: number;
  rangeParticipationRate: number;
  probeCount: number;
  chaseCount: number;
  chaseRate: number;
  planDriftCount: number;
  postCostExpectancy: number;
  profitFactor: number;
  maxDrawdownR: number;
}

@Injectable()
export class PipelineAnalyticsService {
  private readonly logger = new Logger(PipelineAnalyticsService.name);

  public recordStageTelemetry(record: StageTelemetryRecord): StageTelemetryRecord {
    this.logger.debug({ event: 'pipeline_stage_telemetry', ...record });
    return record;
  }

  public buildStageStatistics(records: StageTelemetryRecord[]) {
    const byStage = new Map<string, StageTelemetryRecord[]>();
    for (const record of records) {
      const bucket = byStage.get(record.stageName) ?? [];
      bucket.push(record);
      byStage.set(record.stageName, bucket);
    }

    return Array.from(byStage.entries()).map(([stageName, entries]) => {
      const accepted = entries.filter((record) => this.isAccepted(record)).length;
      const rejected = entries.length - accepted;
      return {
        stageName,
        signalsEntered: entries.length,
        signalsLeaving: entries.length,
        acceptanceRate: entries.length ? accepted / entries.length : 0,
        rejectionRate: entries.length ? rejected / entries.length : 0,
        averageConfidence: entries.reduce((sum, entry) => sum + entry.confidence, 0) / Math.max(entries.length, 1),
        averageOpportunityScore: entries.reduce((sum, entry) => sum + entry.opportunityScore, 0) / Math.max(entries.length, 1),
        topRejectionReasons: this.topReasons(entries.filter((entry) => !this.isAccepted(entry))),
      };
    });
  }

  public buildRejectionAnalytics(records: StageTelemetryRecord[]) {
    const reasons = records
      .filter((record) => !this.isAccepted(record))
      .map((record) => record.rejectReason ?? 'UNKNOWN');

    return {
      totalSignals: records.length,
      acceptedSignals: records.filter((record) => this.isAccepted(record)).length,
      rejectedSignals: reasons.length,
      acceptanceRate: records.length ? records.filter((record) => this.isAccepted(record)).length / records.length : 0,
      rejectionRate: records.length ? reasons.length / records.length : 0,
      averageConfidence: records.reduce((sum, entry) => sum + entry.confidence, 0) / Math.max(records.length, 1),
      averageOpportunityScore: records.reduce((sum, entry) => sum + entry.opportunityScore, 0) / Math.max(records.length, 1),
      topRejectionReasons: this.topReasons(records.filter((entry) => !this.isAccepted(entry))),
    };
  }

  public buildAdaptiveRolloutMetrics(records: StageTelemetryRecord[]): AdaptiveRolloutMetrics {
    const rangeOpportunities = records.filter(
      (r) => r.regime === 'RANGING' || r.setup === 'RANGE_REVERSION',
    );
    const rangeParticipations = rangeOpportunities.filter(
      (r) => r.executionResult === 'EXECUTED' || r.action === 'ENTER' || r.action === 'PROBE',
    );
    const rangeParticipationRate =
      rangeOpportunities.length > 0
        ? rangeParticipations.length / rangeOpportunities.length
        : 0;

    const probeCount = records.filter(
      (r) => r.riskTier === 'PROBE' || r.action === 'PROBE',
    ).length;

    const chaseCount = records.filter(
      (r) =>
        r.rejectReason === 'ENTRY_CHASE_DISTANCE_EXCEEDED' ||
        r.quantReason === 'ENTRY_CHASE_DISTANCE_EXCEEDED' ||
        (typeof r.triggerDistance === 'number' && r.triggerDistance > 0.8),
    ).length;
    const chaseRate = records.length > 0 ? chaseCount / records.length : 0;

    const planDriftCount = records.filter(
      (r) =>
        r.planDrift === true ||
        (r.approvedOrderType !== undefined &&
          r.submittedOrderType !== undefined &&
          r.approvedOrderType !== r.submittedOrderType),
    ).length;

    const netRs = records
      .map((r) => r.lifecycleNetR)
      .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));

    let postCostExpectancy = 0;
    let profitFactor = 0;
    let maxDrawdownR = 0;

    if (netRs.length > 0) {
      const sum = netRs.reduce((acc, r) => acc + r, 0);
      postCostExpectancy = sum / netRs.length;

      const grossGains = netRs.filter((r) => r > 0).reduce((acc, r) => acc + r, 0);
      const grossLosses = Math.abs(netRs.filter((r) => r < 0).reduce((acc, r) => acc + r, 0));
      profitFactor = grossLosses > 0 ? grossGains / grossLosses : grossGains > 0 ? Infinity : 0;

      let peak = 0;
      let cumulative = 0;
      for (const r of netRs) {
        cumulative += r;
        if (cumulative > peak) peak = cumulative;
        const dd = peak - cumulative;
        if (dd > maxDrawdownR) maxDrawdownR = dd;
      }
    }

    return {
      totalRecords: records.length,
      rangeOpportunitiesCount: rangeOpportunities.length,
      rangeParticipationsCount: rangeParticipations.length,
      rangeParticipationRate,
      probeCount,
      chaseCount,
      chaseRate,
      planDriftCount,
      postCostExpectancy,
      profitFactor,
      maxDrawdownR,
    };
  }

  private isAccepted(record: StageTelemetryRecord): boolean {
    return record.executionResult === 'EXECUTED' || record.executionResult === 'APPROVED';
  }

  private topReasons(records: StageTelemetryRecord[]) {
    const counts = new Map<string, number>();
    for (const record of records) {
      const reason = record.rejectReason ?? 'UNKNOWN';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).slice(0, 5);
  }
}
