import type { DecisionOutput } from '@platform/shared';

export type DecisionRiskPolicyReason =
  | 'DATA_QUALITY_INSUFFICIENT'
  | 'HIGH_CONFLICT'
  | 'CONFIDENCE_BELOW_THRESHOLD'
  | 'EXPECTED_VALUE_NEGATIVE'
  | 'OPPORTUNITY_BELOW_THRESHOLD'
  | 'RISK_SCORE_TOO_HIGH'
  | 'EXTREME_VOLATILITY'
  | 'DECISION_IS_WAIT';

export interface DecisionRiskPolicyResult {
  actionable: boolean;
  decision: DecisionOutput['decision'];
  reason?: DecisionRiskPolicyReason;
}

export class DecisionRiskPolicyService {
  evaluate(output: Pick<DecisionOutput, 'decision' | 'confidence' | 'dataQuality' | 'conflictLevel' | 'opportunityScore' | 'expectedValue' | 'adaptiveThreshold' | 'riskScore' | 'volatilityAdjustment' | 'agreementScore'>): DecisionRiskPolicyResult {
    if (output.decision === 'WAIT') {
      return { actionable: false, decision: 'WAIT', reason: 'DECISION_IS_WAIT' };
    }
    if (output.dataQuality === 'INSUFFICIENT') {
      return { actionable: false, decision: 'WAIT', reason: 'DATA_QUALITY_INSUFFICIENT' };
    }
    if (output.conflictLevel === 'HIGH') {
      return { actionable: false, decision: 'WAIT', reason: 'HIGH_CONFLICT' };
    }
    const strongConviction = output.agreementScore >= 80 && output.opportunityScore >= 68 && output.expectedValue > 0.2;
    if (output.volatilityAdjustment <= -30 || output.riskScore >= 90) {
      return { actionable: false, decision: 'WAIT', reason: 'EXTREME_VOLATILITY' };
    }
    const thresholdFloor = Math.max(55, output.adaptiveThreshold - 5);
    if (output.confidence < output.adaptiveThreshold && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'CONFIDENCE_BELOW_THRESHOLD' };
    }
    if (output.expectedValue <= 0 && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'EXPECTED_VALUE_NEGATIVE' };
    }
    if (output.opportunityScore < thresholdFloor && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'OPPORTUNITY_BELOW_THRESHOLD' };
    }
    if (output.riskScore > 80 && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'RISK_SCORE_TOO_HIGH' };
    }
    return { actionable: true, decision: output.decision };
  }
}
