import { Injectable } from '@nestjs/common';
import type { DecisionOutput, FusionInput } from '@platform/shared';
import {
  adaptiveTradingPolicy,
  parseSpreadBps,
  timeframeMilliseconds,
} from '../domain/adaptive-trading-policy';

export interface JudgeDecision {
  verdict: 'APPROVE' | 'REJECT' | 'REQUEST_MORE_DATA';
  approved: boolean;
  reasons: string[];
}

export interface JudgeContext {
  symbol: string;
  provider?: 'BINANCE_FUTURES' | 'OKX_FUTURES';
  timeframe?: string;
  referencePrice?: number;
  sourceTimestamp?: Date | string;
  /** Set for any decision that can reach automatic exchange execution. */
  requireCalibratedConfidence?: boolean;
}

/** Deterministic final validation gate. It never creates a trading signal. */
@Injectable()
export class DecisionJudgeService {
  evaluate(decision: DecisionOutput, analyses: FusionInput, context?: JudgeContext, now = Date.now()): JudgeDecision {
    const reasons: string[] = [];
    if (!context?.symbol) {
      return { verdict: 'REQUEST_MORE_DATA', approved: false, reasons: ['SYMBOL_REQUIRED'] };
    }
    const spreadBps = parseSpreadBps(
      analyses.market?.liquidity?.bidAskSpread ?? analyses.market?.liquidity?.spread,
      context?.referencePrice,
    );
    const policy = adaptiveTradingPolicy({
      symbol: context.symbol,
      provider: context?.provider,
      timeframe: context?.timeframe,
      regime: decision.regime?.type ?? 'RANGING',
      spreadBps,
    });
    const configured = Object.entries(analyses).filter(([name, analysis]) =>
      (name !== 'onchain' || !(
          'signals' in analysis &&
          analysis.signals.some((signal: string) =>
            /no verified on-chain (?:provider|analysis)|coin metrics returned no verified coverage/i.test(signal),
          )
        )) &&
      (name !== 'macro' || !/no imported macro data/i.test(analysis.summary)),
    );
    const usable = configured.filter(([, analysis]) => analysis.dataQuality !== 'INSUFFICIENT');
    const coreTechnicalEvidence =
      analyses.market.dataQuality !== 'INSUFFICIENT' &&
      analyses.technical.dataQuality !== 'INSUFFICIENT';
    const shortTerm = timeframeMilliseconds(context.timeframe) <= 60 * 60_000;
    // For short-term trades, fresh Market + Technical evidence plus one valid
    // auxiliary observation is a sufficient quorum. Missing Macro/Social data
    // still lowers confidence, but no longer has an unconditional veto.
    const minimumUsable = Math.min(
      coreTechnicalEvidence && shortTerm ? 3 : 4,
      configured.length,
    );
    const freshUsable = usable.filter(([, analysis]) => {
      const generatedAt = Date.parse(analysis.generatedAt);
      return Number.isFinite(generatedAt) && now - generatedAt <= policy.staleAfterMs;
    });
    const staleCoreAnalysis = usable.some(([name, analysis]) => {
      if (name !== 'market' && name !== 'technical') return false;
      const generatedAt = Date.parse(analysis.generatedAt);
      return !Number.isFinite(generatedAt) || now - generatedAt > policy.staleAfterMs;
    });
    // Optional observations age at different cadences. Exclude stale optional
    // evidence from the quorum instead of letting one old social/macro/on-chain
    // result veto otherwise fresh Market + Technical evidence.
    if (freshUsable.length < minimumUsable) reasons.push('INSUFFICIENT_USABLE_ANALYSTS');
    if (decision.dataQuality === 'INSUFFICIENT') reasons.push('INSUFFICIENT_DECISION_DATA');
    if (decision.conflictLevel === 'HIGH') reasons.push('HIGH_SIGNAL_CONFLICT');
    if (staleCoreAnalysis) reasons.push('STALE_ANALYSIS');

    if (context?.sourceTimestamp) {
      const sourceTime = context.sourceTimestamp instanceof Date
        ? context.sourceTimestamp.getTime()
        : Date.parse(context.sourceTimestamp);
      if (!Number.isFinite(sourceTime) || now - sourceTime > policy.staleAfterMs) {
        reasons.push('STALE_SOURCE_DATA');
      }
    }

    if (decision.decision !== 'WAIT' && decision.expectedValue <= policy.minExpectedValue) reasons.push('EXPECTED_VALUE_TOO_LOW');
    if (decision.decision !== 'WAIT' && decision.profitFactorEstimate < policy.minProfitFactor) reasons.push('PROFIT_FACTOR_TOO_LOW');
    if (decision.riskScore >= policy.maxRiskScore) reasons.push('DECISION_RISK_TOO_HIGH');
    if (spreadBps !== undefined && spreadBps > policy.maxSpreadBps) reasons.push('SPREAD_TOO_WIDE');
    // Automatic exchange execution must respect reliable negative evidence
    // even when the calibration falls back to the user's global history. Exact
    // calibration remains the only hard gate for non-execution callers.
    const calibration = decision.confidenceCalibration;
    const exactCalibration =
      calibration?.status === 'CALIBRATED' &&
      calibration.scope === 'EXACT' &&
      calibration.fallbackUsed !== true
        ? calibration
        : undefined;
    const hardGateCalibration =
      calibration?.status === 'CALIBRATED' &&
      (calibration.scope === 'EXACT' || calibration.scope === 'BLENDED') &&
      calibration.hardGateEligible !== false
        ? calibration
        : exactCalibration;
    if (
      context?.requireCalibratedConfidence &&
      decision.decision !== 'WAIT' &&
      (!calibration || calibration.status !== 'CALIBRATED' || !hardGateCalibration) &&
      decision.dataQuality === 'PARTIAL'
    ) reasons.push('PARTIAL_DATA_UNCALIBRATED');
    if (
      context?.requireCalibratedConfidence &&
      decision.decision !== 'WAIT' &&
      (!calibration || calibration.status !== 'CALIBRATED' || !hardGateCalibration) &&
      decision.confidence < 80
    ) reasons.push('UNCALIBRATED_CONFIDENCE_TOO_LOW');
    if (
      decision.decision !== 'WAIT' &&
      hardGateCalibration &&
      (hardGateCalibration.empiricalProbability ?? 0) < policy.minCalibratedProbability
    ) reasons.push('CALIBRATED_PROBABILITY_TOO_LOW');
    if (
      hardGateCalibration &&
      (hardGateCalibration.brierScore ?? 0) > 0.35
    ) reasons.push('CALIBRATION_UNRELIABLE');

    if (reasons.some((reason) => reason.includes('DATA') || reason.includes('STALE') || reason.includes('USABLE') || reason.includes('CALIBRAT'))) {
      return { verdict: 'REQUEST_MORE_DATA', approved: false, reasons };
    }
    if (reasons.length > 0) return { verdict: 'REJECT', approved: false, reasons };
    return { verdict: 'APPROVE', approved: true, reasons: [] };
  }
}
