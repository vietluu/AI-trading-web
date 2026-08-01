import { Injectable } from '@nestjs/common';
import type { DecisionOutput } from '@platform/shared';
import { PipelineConfigService } from './pipeline-config.service';

@Injectable()
export class PipelineThresholdService {
  constructor(private readonly config: PipelineConfigService) {}
  evaluate(output: DecisionOutput): { actionable: boolean; reason?: string } {
    if (output.confidence < this.config.minConfidence) return { actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' };
    if (output.dataQuality !== 'GOOD') return { actionable: false, reason: 'DATA_QUALITY_NOT_GOOD' };
    if (output.conflictLevel === 'HIGH') return { actionable: false, reason: 'HIGH_CONFLICT' };
    return { actionable: true };
  }
}
