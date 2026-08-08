import { Injectable } from '@nestjs/common';
import type { DecisionOutput, FusionInput } from '@platform/shared';

export interface JudgeDecision {
  verdict: 'APPROVE' | 'REJECT' | 'REQUEST_MORE_DATA';
  approved: boolean;
  reasons: string[];
}

/** Deterministic final validation gate. It never creates a trading signal. */
@Injectable()
export class DecisionJudgeService {
  evaluate(decision: DecisionOutput, analyses: FusionInput, now = Date.now()): JudgeDecision {
    const reasons: string[] = [];
    const usable = Object.values(analyses).filter((analysis) => analysis.dataQuality !== 'INSUFFICIENT');
    if (usable.length < 4) reasons.push('FEWER_THAN_FOUR_USABLE_ANALYSTS');
    if (decision.dataQuality === 'INSUFFICIENT') reasons.push('INSUFFICIENT_DECISION_DATA');
    if (decision.conflictLevel === 'HIGH') reasons.push('HIGH_SIGNAL_CONFLICT');

    const stale = usable.some((analysis) => {
      const generatedAt = Date.parse(analysis.generatedAt);
      return !Number.isFinite(generatedAt) || now - generatedAt > 10 * 60_000;
    });
    if (stale) reasons.push('STALE_ANALYSIS');

    if (decision.decision !== 'WAIT' && decision.expectedValue <= 0.1) reasons.push('EXPECTED_VALUE_TOO_LOW');
    if (decision.decision !== 'WAIT' && decision.profitFactorEstimate < 1.2) reasons.push('PROFIT_FACTOR_TOO_LOW');
    if (decision.riskScore >= 85) reasons.push('DECISION_RISK_TOO_HIGH');

    if (reasons.some((reason) => reason.includes('DATA') || reason.includes('STALE') || reason.includes('USABLE'))) {
      return { verdict: 'REQUEST_MORE_DATA', approved: false, reasons };
    }
    if (reasons.length > 0) return { verdict: 'REJECT', approved: false, reasons };
    return { verdict: 'APPROVE', approved: true, reasons: [] };
  }
}
