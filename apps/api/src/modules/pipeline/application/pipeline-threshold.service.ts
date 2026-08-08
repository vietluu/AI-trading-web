import { Injectable } from '@nestjs/common';
import type { DecisionOutput } from '@platform/shared';
import { PipelineConfigService } from './pipeline-config.service';
import { adaptiveTradingPolicy, type AdaptivePolicyContext } from '../domain/adaptive-trading-policy';

@Injectable()
export class PipelineThresholdService {
  constructor(private readonly config: PipelineConfigService) {}
  evaluate(output: DecisionOutput, context?: AdaptivePolicyContext): { actionable: boolean; reason?: string } {
    const policy = adaptiveTradingPolicy({ symbol: context?.symbol ?? 'BTC-USDT', ...context, regime: output.regime?.type ?? context?.regime ?? 'RANGING' });
    if (output.decision === 'WAIT') return { actionable: false, reason: 'DECISION_IS_WAIT' };
    if (output.dataQuality === 'INSUFFICIENT') return { actionable: false, reason: 'DATA_QUALITY_INSUFFICIENT' };
    if (output.conflictLevel === 'HIGH') return { actionable: false, reason: 'HIGH_CONFLICT' };
    const thresholdFloor = Math.max(this.config.minConfidence - 10, output.adaptiveThreshold - 5);
    if (output.confidence < thresholdFloor) return { actionable: false, reason: 'CONFIDENCE_BELOW_THRESHOLD' };
    if (output.expectedValue <= policy.minExpectedValue) return { actionable: false, reason: 'EXPECTED_VALUE_NEGATIVE' };
    if (output.opportunityScore < Math.max(55, output.adaptiveThreshold)) return { actionable: false, reason: 'OPPORTUNITY_BELOW_THRESHOLD' };
    if (output.riskScore > policy.maxRiskScore) return { actionable: false, reason: 'RISK_SCORE_TOO_HIGH' };
    return { actionable: true };
  }
}
