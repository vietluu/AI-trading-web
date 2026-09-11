import { evaluateEvidenceGate } from '../domain/evidence-gate';
import { Injectable } from '@nestjs/common';
import type { DecisionOutput, FusionInput } from '@platform/shared';
import {
  adaptiveTradingPolicy,
  parseSpreadBps,
  timeframeMilliseconds,
} from '../domain/adaptive-trading-policy';

export interface JudgeDecision {
  severity: 'BLOCK' | 'REDUCE_SIZE' | 'APPROVE';
  sizeFactor?: number;
  verdict: 'APPROVE' | 'REJECT' | 'REQUEST_MORE_DATA';
  approved: boolean;
  reasons: string[];
}

export interface JudgeContext {
  mode?: 'SHADOW' | 'DEMO' | 'LIVE';
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
      return { verdict: 'REQUEST_MORE_DATA', severity: 'BLOCK', approved: false, reasons: ['SYMBOL_REQUIRED'] };
    }
    const spreadBps = parseSpreadBps(
      analyses.market?.liquidity?.bidAskSpread ?? analyses.market?.liquidity?.spread,
      context?.referencePrice,
    );
    const riskRewardRatio = decision.expectedReward && decision.expectedLoss && decision.expectedLoss > 0
      ? decision.expectedReward / decision.expectedLoss
      : undefined;
    const policy = adaptiveTradingPolicy({
      symbol: context.symbol,
      provider: context?.provider,
      timeframe: context?.timeframe,
      regime: decision.regime?.type ?? 'RANGING',
      spreadBps,
      riskRewardRatio,
      directionalAgreement: decision.directionalAgreement ?? decision.agreementScore,
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
    
    // Integrate Evidence Gate
    const gateResult = evaluateEvidenceGate({
      mode: context.mode ?? 'LIVE',
      newCohort: context.mode !== undefined && decision.confidenceCalibration?.status !== 'CALIBRATED',
      coreDataStale: staleCoreAnalysis || !coreTechnicalEvidence,
      unsafeGeometry: decision.decision !== 'WAIT' && (
        decision.expectedValue <= policy.minExpectedValue ||
        decision.profitFactorEstimate < policy.minProfitFactor ||
        (spreadBps !== undefined && spreadBps > policy.maxSpreadBps)
      )
    });
    
    if (gateResult.severity === 'BLOCK') {
      reasons.push(...gateResult.reasons);
    }

    
    const targetDirection = decision.decision === 'LONG' ? 'UP' : decision.decision === 'SHORT' ? 'DOWN' : undefined;
    const executionCoreGood = Boolean(
      targetDirection &&
      decision.coreDataQuality === 'GOOD' &&
      analyses.market.dataQuality === 'GOOD' &&
      analyses.technical.dataQuality === 'GOOD' &&
      analyses.market.trend.direction === targetDirection &&
      analyses.technical.trend.direction === targetDirection &&
      freshUsable.length >= minimumUsable,
    );
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

    // Macro Pre-News Blackout Gate & Direction Alignment Guard
    if (decision.decision !== 'WAIT' && analyses.macro) {
      const macroRiskFactors = Array.isArray(analyses.macro.riskFactors) ? analyses.macro.riskFactors : [];
      const hasBlackoutRisk = macroRiskFactors.some((r: unknown) =>
        typeof r === 'string' && r.includes('MACRO_NEWS_BLACKOUT'),
      );
      const hasBlackoutSummary = typeof analyses.macro.summary === 'string' &&
        analyses.macro.summary.includes('[MACRO_NEWS_BLACKOUT ACTIVE]');

      if (hasBlackoutRisk || hasBlackoutSummary) {
        reasons.push('MACRO_NEWS_BLACKOUT');
      }

      const macroTrend = analyses.macro.macroTrend;
      if (decision.decision === 'SHORT' && macroTrend === 'RISK_ON') {
        reasons.push('MACRO_DIRECTION_CONFLICT');
      } else if (decision.decision === 'LONG' && macroTrend === 'RISK_OFF') {
        reasons.push('MACRO_DIRECTION_CONFLICT');
      }
    }
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
    const hardGateCalibration = exactCalibration?.hardGateEligible !== false
      ? exactCalibration
      : undefined;
    if (
      context.mode !== 'DEMO' && context.mode !== 'SHADOW' &&
      context?.requireCalibratedConfidence &&
      decision.decision !== 'WAIT' &&
      (!calibration || calibration.status !== 'CALIBRATED' || !hardGateCalibration) &&
      decision.dataQuality === 'PARTIAL' &&
      !executionCoreGood
    ) reasons.push('PARTIAL_DATA_UNCALIBRATED');
    if (
      context.mode !== 'DEMO' && context.mode !== 'SHADOW' &&
      context?.requireCalibratedConfidence &&
      decision.decision !== 'WAIT' &&
      (!calibration || calibration.status !== 'CALIBRATED' || !hardGateCalibration) &&
      decision.confidence < (executionCoreGood ? Math.max(65, decision.adaptiveThreshold) : 80)
    ) reasons.push('UNCALIBRATED_CONFIDENCE_TOO_LOW');
    if (
      decision.decision !== 'WAIT' &&
      hardGateCalibration &&
      (hardGateCalibration.empiricalProbability ?? 0) < policy.minCalibratedProbability
    ) reasons.push('CALIBRATED_PROBABILITY_TOO_LOW');
    const sampleSize = hardGateCalibration?.sampleSize ?? hardGateCalibration?.bucketSampleSize ?? 0;
    // Tighter brier requirement for larger samples, standard 0.35 ceiling
    const maxBrier = sampleSize >= 100 ? 0.32 : 0.35;
    if (
      hardGateCalibration &&
      (hardGateCalibration.brierScore ?? 0) > maxBrier
    ) reasons.push('CALIBRATION_UNRELIABLE');

    if (reasons.some((reason) => reason.includes('DATA') || reason.includes('STALE') || reason.includes('USABLE') || reason.includes('CALIBRAT'))) {
      return { verdict: 'REQUEST_MORE_DATA', severity: 'BLOCK', approved: false, reasons: Array.from(new Set(reasons)) };
    }
    if (reasons.length > 0) return { verdict: 'REJECT', severity: 'BLOCK', approved: false, reasons: Array.from(new Set(reasons)) };
    return { verdict: 'APPROVE', severity: gateResult.severity, ...(gateResult.sizeFactor !== undefined ? { sizeFactor: gateResult.sizeFactor } : {}), approved: true, reasons: Array.from(new Set(gateResult.reasons)) };
  }
}
