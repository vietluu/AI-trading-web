import { Injectable, Logger } from '@nestjs/common';

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
  executionResult: string;
  durationMs: number;
  tokenUsage: number;
  apiCost: number;
  createdAt: string;
}

@Injectable()
export class PipelineAnalyticsService {
  private readonly logger = new Logger(PipelineAnalyticsService.name);

  public recordStageTelemetry(record: StageTelemetryRecord): StageTelemetryRecord {
    this.logger.debug({ event: 'pipeline_stage_telemetry', stage: record.stageName, decision: record.decision, confidence: record.confidence });
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
