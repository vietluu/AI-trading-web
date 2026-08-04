import { Injectable } from '@nestjs/common';
import type { DecisionOutput } from '@platform/shared';
import { PipelineConfigService } from './pipeline-config.service';

@Injectable()
export class PipelineThresholdService {
  constructor(private readonly config: PipelineConfigService) {}
  evaluate(output: DecisionOutput): { actionable: boolean; reason?: string } {
    if (output.decision === 'WAIT') return { actionable: false, reason: 'DECISION_IS_WAIT' };
    if (output.confidence < this.config.minConfidence) return { actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' };
    if (output.dataQuality === 'INSUFFICIENT') return { actionable: false, reason: 'DATA_QUALITY_INSUFFICIENT' };
    if (output.conflictLevel === 'HIGH') return { actionable: false, reason: 'HIGH_CONFLICT' };
    if (output.confidence < 75) return { actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' };
    return { actionable: true };
  }
}
