import { Injectable } from '@nestjs/common';
import type { DecisionOutput, FusionInput } from '@platform/shared';
import { adaptiveTradingPolicy, parseSpreadBps } from '../domain/adaptive-trading-policy';

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
      name !== 'onchain' || !(
        'signals' in analysis &&
        analysis.signals.some((signal: string) =>
          /no verified on-chain (?:provider|analysis)|coin metrics returned no verified coverage/i.test(signal),
        )
      ),
    ).map(([, analysis]) => analysis);
    const usable = configured.filter((analysis) => analysis.dataQuality !== 'INSUFFICIENT');
    const minimumUsable = Math.min(4, configured.length);
    if (usable.length < minimumUsable) reasons.push('INSUFFICIENT_USABLE_ANALYSTS');
    if (decision.dataQuality === 'INSUFFICIENT') reasons.push('INSUFFICIENT_DECISION_DATA');
    if (decision.conflictLevel === 'HIGH') reasons.push('HIGH_SIGNAL_CONFLICT');

    const stale = usable.some((analysis) => {
      const generatedAt = Date.parse(analysis.generatedAt);
      return !Number.isFinite(generatedAt) || now - generatedAt > policy.staleAfterMs;
    });
    if (stale) reasons.push('STALE_ANALYSIS');

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
    if (
      decision.decision !== 'WAIT' &&
      decision.confidenceCalibration?.status === 'CALIBRATED' &&
      (decision.confidenceCalibration.empiricalProbability ?? 0) < policy.minCalibratedProbability
    ) reasons.push('CALIBRATED_PROBABILITY_TOO_LOW');
    if (
      decision.confidenceCalibration?.status === 'CALIBRATED' &&
      (decision.confidenceCalibration.brierScore ?? 0) > 0.3
    ) reasons.push('CALIBRATION_UNRELIABLE');

    if (reasons.some((reason) => reason.includes('DATA') || reason.includes('STALE') || reason.includes('USABLE') || reason.includes('CALIBRATION_UNRELIABLE'))) {
      return { verdict: 'REQUEST_MORE_DATA', approved: false, reasons };
    }
    if (reasons.length > 0) return { verdict: 'REJECT', approved: false, reasons };
    return { verdict: 'APPROVE', approved: true, reasons: [] };
  }
}
