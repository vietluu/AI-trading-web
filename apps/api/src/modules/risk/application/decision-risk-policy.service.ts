import type { DecisionOutput } from '@platform/shared';
import { adaptiveTradingPolicy, type AdaptivePolicyContext } from '../../pipeline/domain/adaptive-trading-policy';

export type DecisionRiskPolicyReason =
  | 'DATA_QUALITY_INSUFFICIENT'
  | 'PARTIAL_DATA_CONVICTION_TOO_LOW'
  | 'HIGH_CONFLICT'
  | 'CONFIDENCE_BELOW_THRESHOLD'
  | 'EXPECTED_VALUE_NEGATIVE'
  | 'OPPORTUNITY_BELOW_THRESHOLD'
  | 'RISK_SCORE_TOO_HIGH'
  | 'EXTREME_VOLATILITY'
  | 'SYMBOL_REQUIRED'
  | 'DECISION_IS_WAIT';

export interface DecisionRiskPolicyResult {
  actionable: boolean;
  decision: DecisionOutput['decision'];
  reason?: DecisionRiskPolicyReason;
}

export class DecisionRiskPolicyService {
  evaluate(output: Pick<DecisionOutput, 'decision' | 'confidence' | 'dataQuality' | 'conflictLevel' | 'opportunityScore' | 'expectedValue' | 'adaptiveThreshold' | 'riskScore' | 'volatilityAdjustment' | 'agreementScore' | 'regime'>, context?: AdaptivePolicyContext): DecisionRiskPolicyResult {
    if (!context?.symbol) return { actionable: false, decision: 'WAIT', reason: 'SYMBOL_REQUIRED' };
    const policy = adaptiveTradingPolicy({ ...context, symbol: context.symbol, regime: output.regime?.type ?? context.regime ?? 'RANGING' });
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
    if (
      output.dataQuality === 'PARTIAL' &&
      (
        output.confidence < output.adaptiveThreshold + 5 ||
        output.agreementScore < 75 ||
        output.expectedValue <= policy.minExpectedValue + 0.1
      )
    ) {
      return { actionable: false, decision: 'WAIT', reason: 'PARTIAL_DATA_CONVICTION_TOO_LOW' };
    }
    if (output.confidence < output.adaptiveThreshold && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'CONFIDENCE_BELOW_THRESHOLD' };
    }
    if (output.expectedValue <= policy.minExpectedValue && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'EXPECTED_VALUE_NEGATIVE' };
    }
    if (output.opportunityScore < thresholdFloor && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'OPPORTUNITY_BELOW_THRESHOLD' };
    }
    if (output.riskScore > policy.maxRiskScore && !strongConviction) {
      return { actionable: false, decision: 'WAIT', reason: 'RISK_SCORE_TOO_HIGH' };
    }
    return { actionable: true, decision: output.decision };
  }
}
