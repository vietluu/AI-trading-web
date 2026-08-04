import { Injectable } from '@nestjs/common';
import type { DecisionOutput } from '@platform/shared';
import { PipelineConfigService } from './pipeline-config.service';

@Injectable()
export class PipelineThresholdService {
  constructor(private readonly config: PipelineConfigService) {}
  evaluate(output: DecisionOutput): { actionable: boolean; reason?: string } {
    if (output.decision === 'WAIT') return { actionable: false, reason: 'DECISION_IS_WAIT' };
    if (output.dataQuality === 'INSUFFICIENT') return { actionable: false, reason: 'DATA_QUALITY_INSUFFICIENT' };
    if (output.conflictLevel === 'HIGH') return { actionable: false, reason: 'HIGH_CONFLICT' };
    const thresholdFloor = Math.max(this.config.minConfidence - 10, output.adaptiveThreshold - 5);
    if (output.confidence < thresholdFloor) return { actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' };
    if (output.expectedValue <= 0) return { actionable: false, reason: 'EXPECTED_VALUE_NEGATIVE' };
    if (output.opportunityScore < Math.max(55, output.adaptiveThreshold)) return { actionable: false, reason: 'OPPORTUNITY_BELOW_THRESHOLD' };
    if (output.riskScore > 80) return { actionable: false, reason: 'RISK_SCORE_TOO_HIGH' };
    return { actionable: true };
  }
}
