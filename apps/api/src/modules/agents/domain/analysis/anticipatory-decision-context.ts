import type { AnticipatoryMarketSnapshot, DecisionOutput } from '@platform/shared';
import type { TradePlanMarketContext } from '../../../risk/domain/trade-plan-engine';

export function anticipatoryDecisionContext(snapshot: AnticipatoryMarketSnapshot): {
  market: TradePlanMarketContext;
  signals: NonNullable<DecisionOutput['anticipatorySignals']>;
} {
  const volatility = snapshot.volatility.coverage === 'AVAILABLE' ? snapshot.volatility : undefined;
  const structure = snapshot.structure.coverage === 'AVAILABLE' ? snapshot.structure : undefined;
  const momentum = snapshot.momentum.coverage === 'AVAILABLE' ? snapshot.momentum : undefined;
  const sweep = structure?.liquiditySweep.coverage === 'AVAILABLE' ? structure.liquiditySweep : undefined;
  const imbalance = snapshot.derivatives.coverage === 'AVAILABLE' && snapshot.derivatives.derivativesImbalance.coverage === 'AVAILABLE'
    ? snapshot.derivatives.derivativesImbalance : undefined;
  const direction = momentum && momentum.macd.histogram > 0 ? 'BULLISH' : momentum && momentum.macd.histogram < 0 ? 'BEARISH' : 'NEUTRAL';
  return {
    market: {
      ...(snapshot.execution.coverage === 'AVAILABLE' ? { currentPrice: snapshot.execution.currentPrice } : {}),
      ...(volatility ? { atr: volatility.atr, squeezeState: { isSqueezing: volatility.squeezeState === 'SQUEEZING', breakoutProbability: 100 - volatility.atrPercentile, momentumDirection: direction, consecutiveSqueezeBars: volatility.squeezeDurationCandles } } : {}),
      ...(structure?.rangeBoundaries ? { support: structure.rangeBoundaries.lower, resistance: structure.rangeBoundaries.upper } : {}),
      ...(momentum ? { rsi: momentum.rsi } : {}),
      ...(sweep ? { liquiditySweep: sweep.detected } : {}),
      ...(imbalance ? { derivativesImbalance: imbalance.squeezeProbability } : {}),
    },
    signals: {
      ...(volatility ? { squeeze: { active: volatility.squeezeState === 'SQUEEZING', intensity: 100 - volatility.atrPercentile, duration: volatility.squeezeDurationCandles, breakoutBias: direction, breakoutProbability: 100 - volatility.atrPercentile } } : {}),
      ...(sweep ? { liquiditySweep: { detected: sweep.detected, direction: sweep.direction, confidence: sweep.detected && sweep.reclaimed ? 100 : 0 } } : {}),
      ...(imbalance ? { derivativesImbalance: { squeezeProbability: imbalance.squeezeProbability, squeezeDirection: imbalance.squeezeDirection, fundingExtreme: imbalance.fundingExtreme } } : {}),
    },
  };
}
