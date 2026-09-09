import type { Decision, DetailedRegimeType, MarketRegime, TradingScenario } from '@platform/shared';

export interface ScenarioPlanningInput {
  decision: Decision;
  confidence: number;
  regime: MarketRegime;
  currentPrice?: number;
  atr?: number;
  supportLevel?: number;
  resistanceLevel?: number;
  hasSfpWick?: boolean;
  sfpType?: 'BULLISH' | 'BEARISH';
  directionalAgreement?: number;
}

/**
 * Builds an actionable multi-scenario trading blueprint:
 * 1. PRIMARY Plan: The baseline thesis with probability, entry trigger, TP, and invalidation.
 * 2. CONTINGENCY Plan: The counter-scenario (e.g. SFP fakeout, liquidity sweep reversal, or fail-safe).
 * 3. INVALIDATION Level: Price point or condition that voids the primary thesis immediately.
 */
export function buildScenarioBlueprint(input: ScenarioPlanningInput): TradingScenario[] {
  const {
    decision,
    confidence,
    regime,
    currentPrice = 0,
    atr = currentPrice > 0 ? currentPrice * 0.015 : 100,
    supportLevel = currentPrice > 0 ? currentPrice - atr * 1.5 : undefined,
    resistanceLevel = currentPrice > 0 ? currentPrice + atr * 1.5 : undefined,
    hasSfpWick,
    sfpType,
    directionalAgreement = 70,
  } = input;

  const scenarios: TradingScenario[] = [];
  const detailedRegime: DetailedRegimeType = regime.detailed ?? (
    regime.type === 'HIGH_VOLATILITY' ? 'VOLATILE_LIQUIDITY_EXPANSION' :
    regime.type === 'TRENDING' ? 'TRENDING_BULL' : 'RANGING_CONSOLIDATION'
  );

  const baseProb = Math.max(0.45, Math.min(0.85, (confidence / 100) * 0.8 + (directionalAgreement / 100) * 0.2));

  if (decision === 'LONG') {
    const tpTarget = resistanceLevel ?? (currentPrice > 0 ? currentPrice + atr * 2.2 : undefined);
    const slLevel = supportLevel ?? (currentPrice > 0 ? currentPrice - atr * 1.2 : undefined);

    scenarios.push({
      id: 'plan_primary_long',
      type: 'PRIMARY',
      direction: 'LONG',
      probability: Number(baseProb.toFixed(2)),
      triggerCondition: hasSfpWick && sfpType === 'BULLISH'
        ? 'Confirmed lower wick rejection (SFP) above support boundary'
        : 'Sustained buy momentum holding above local support',
      priceTarget: tpTarget ? Number(tpTarget.toFixed(2)) : undefined,
      invalidationPrice: slLevel ? Number(slLevel.toFixed(2)) : undefined,
      rationale: `${detailedRegime} favor continuation upward with structural support buffer.`,
    });

    scenarios.push({
      id: 'plan_contingency_bear_reversal',
      type: 'CONTINGENCY',
      direction: 'SHORT',
      probability: Number((1 - baseProb).toFixed(2)),
      triggerCondition: 'Failure to hold support with high volume breakdown / upper wick sweep',
      priceTarget: slLevel && currentPrice > 0 ? Number((slLevel - atr * 1.5).toFixed(2)) : undefined,
      invalidationPrice: currentPrice > 0 ? Number((currentPrice + atr * 0.8).toFixed(2)) : undefined,
      rationale: 'If price breaks lower support decisively, flip to hedge or short retest.',
    });

    scenarios.push({
      id: 'plan_invalidation_threshold',
      type: 'INVALIDATION',
      direction: 'WAIT',
      probability: 1.0,
      triggerCondition: slLevel ? `Price closes below ${slLevel.toFixed(2)} on 15m candle` : 'Price closes below local swing low',
      invalidationPrice: slLevel ? Number(slLevel.toFixed(2)) : undefined,
      rationale: 'Breach of support invalidates the bullish thesis entirely.',
    });
  } else if (decision === 'SHORT') {
    const tpTarget = supportLevel ?? (currentPrice > 0 ? currentPrice - atr * 2.2 : undefined);
    const slLevel = resistanceLevel ?? (currentPrice > 0 ? currentPrice + atr * 1.2 : undefined);

    scenarios.push({
      id: 'plan_primary_short',
      type: 'PRIMARY',
      direction: 'SHORT',
      probability: Number(baseProb.toFixed(2)),
      triggerCondition: hasSfpWick && sfpType === 'BEARISH'
        ? 'Confirmed upper wick rejection (SFP) below resistance boundary'
        : 'Bearish continuation with momentum rejection at resistance',
      priceTarget: tpTarget ? Number(tpTarget.toFixed(2)) : undefined,
      invalidationPrice: slLevel ? Number(slLevel.toFixed(2)) : undefined,
      rationale: `${detailedRegime} favor short-side momentum targeting lower liquidity pools.`,
    });

    scenarios.push({
      id: 'plan_contingency_bull_reversal',
      type: 'CONTINGENCY',
      direction: 'LONG',
      probability: Number((1 - baseProb).toFixed(2)),
      triggerCondition: 'Short squeeze breakout above resistance with sustained volume expansion',
      priceTarget: slLevel && currentPrice > 0 ? Number((slLevel + atr * 1.5).toFixed(2)) : undefined,
      invalidationPrice: currentPrice > 0 ? Number((currentPrice - atr * 0.8).toFixed(2)) : undefined,
      rationale: 'If resistance is breached with strong volume, cancel short bias and seek pullback long.',
    });

    scenarios.push({
      id: 'plan_invalidation_threshold',
      type: 'INVALIDATION',
      direction: 'WAIT',
      probability: 1.0,
      triggerCondition: slLevel ? `Price closes above ${slLevel.toFixed(2)} on 15m candle` : 'Price closes above local swing high',
      invalidationPrice: slLevel ? Number(slLevel.toFixed(2)) : undefined,
      rationale: 'Breakout above structural resistance invalidates the short thesis completely.',
    });
  } else {
    // WAIT Decision: Plan boundary triggers
    scenarios.push({
      id: 'plan_wait_range_long',
      type: 'PRIMARY',
      direction: 'WAIT',
      probability: 0.5,
      triggerCondition: supportLevel
        ? `Monitor for liquidity sweep / SFP pinbar around support ${supportLevel.toFixed(2)}`
        : 'Wait for price to test range low with wick rejection',
      priceTarget: resistanceLevel ? Number(resistanceLevel.toFixed(2)) : undefined,
      invalidationPrice: supportLevel ? Number(supportLevel.toFixed(2)) : undefined,
      rationale: 'Current market is neutral/conflicted. Patience required until extreme boundary is tapped.',
    });

    scenarios.push({
      id: 'plan_contingency_breakout',
      type: 'CONTINGENCY',
      direction: 'WAIT',
      probability: 0.5,
      triggerCondition: resistanceLevel
        ? `Clean breakout and retest above resistance ${resistanceLevel.toFixed(2)}`
        : 'Momentum expansion break with volume confirmation',
      priceTarget: resistanceLevel && currentPrice > 0 ? Number((resistanceLevel + atr * 2).toFixed(2)) : undefined,
      invalidationPrice: supportLevel ? Number(supportLevel.toFixed(2)) : undefined,
      rationale: 'If volatility expansion breaks range with volume, transition to trend-following.',
    });
  }

  return scenarios;
}
