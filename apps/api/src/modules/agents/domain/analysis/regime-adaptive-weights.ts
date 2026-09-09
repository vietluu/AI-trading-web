import type { DetailedRegimeType, MarketRegime } from '@platform/shared';
import { BASE_WEIGHTS } from '../constants/decision.constants';
import type { Weighting } from '../types/decision-service.types';

export interface RegimeWeightProfile {
  weights: Weighting;
  playbook: string;
}

/**
 * Detailed Regime Profiles tailoring agent confidence weights and playbooks
 * to the structural behavior of crypto markets.
 */
export const REGIME_WEIGHT_PROFILES: Record<DetailedRegimeType, RegimeWeightProfile> = {
  TRENDING_BULL: {
    // In strong bull expansion: Trend momentum & volume lead, macro/on-chain distribution warnings
    // often lag or give premature tops. Technical gets +5, News gets -5.
    weights: {
      technical: 30,
      market: 20,
      news: 10,
      sentiment: 15,
      macro: 15,
      onchain: 10,
    },
    playbook: 'Aggressive trend-following with trailing take-profit. Filter out short retracements.',
  },
  TRENDING_BEAR: {
    // In heavy downtrends: Derivatives positioning (open interest, funding cascade) and market liquidity dominate.
    weights: {
      technical: 28,
      market: 25,
      sentiment: 15,
      news: 12,
      macro: 10,
      onchain: 10,
    },
    playbook: 'Short rallies into major EMAs/resistance. Strict trailing stops on short momentum.',
  },
  RANGING_CONSOLIDATION: {
    // In sideways / consolidation: Mean-reversion, support/resistance boundaries and price action SFP wicks dominate.
    // Shifts weight from market to technical: technical 30%, market 15%.
    weights: {
      technical: 30,
      market: 15,
      sentiment: 15,
      news: 15,
      macro: 15,
      onchain: 10,
    },
    playbook: 'Boundary mean-reversion with limit maker orders. Take partial profits at range midline (TP1).',
  },
  VOLATILE_LIQUIDITY_EXPANSION: {
    // In volatility expansions / stop hunts: Prioritize liquidation spikes, liquidity book depth, and SFP wick rejection.
    weights: {
      market: 25,
      sentiment: 20,
      technical: 20,
      news: 15,
      macro: 10,
      onchain: 10,
    },
    playbook: 'Defensive liquidity sweep sniper. Wait for confirmed wick rejection before entering counter-moves.',
  },
};

export function classifyDetailedRegime(params: {
  regimeType: MarketRegime['type'];
  trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
  trendStrength?: 'WEAK' | 'MODERATE' | 'STRONG';
  volatilityLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  isSfpWick?: boolean;
}): { detailed: DetailedRegimeType; playbook: string } {
  const { regimeType, trendDirection, trendStrength, volatilityLevel, isSfpWick } = params;

  if (regimeType === 'HIGH_VOLATILITY' || volatilityLevel === 'HIGH' || isSfpWick) {
    return {
      detailed: 'VOLATILE_LIQUIDITY_EXPANSION',
      playbook: REGIME_WEIGHT_PROFILES.VOLATILE_LIQUIDITY_EXPANSION.playbook,
    };
  }

  if (regimeType === 'RANGING' || volatilityLevel === 'LOW' || trendDirection === 'SIDEWAYS') {
    return {
      detailed: 'RANGING_CONSOLIDATION',
      playbook: REGIME_WEIGHT_PROFILES.RANGING_CONSOLIDATION.playbook,
    };
  }

  if (trendDirection === 'UP' && (trendStrength === 'STRONG' || trendStrength === 'MODERATE')) {
    return {
      detailed: 'TRENDING_BULL',
      playbook: REGIME_WEIGHT_PROFILES.TRENDING_BULL.playbook,
    };
  }

  if (trendDirection === 'DOWN' && (trendStrength === 'STRONG' || trendStrength === 'MODERATE')) {
    return {
      detailed: 'TRENDING_BEAR',
      playbook: REGIME_WEIGHT_PROFILES.TRENDING_BEAR.playbook,
    };
  }

  return {
    detailed: 'RANGING_CONSOLIDATION',
    playbook: REGIME_WEIGHT_PROFILES.RANGING_CONSOLIDATION.playbook,
  };
}

export function computeRegimeAdaptiveWeights(
  detailedRegime: DetailedRegimeType,
  agentAccuracyModifiers?: Partial<Record<keyof Weighting, number>>,
  customWeights?: Weighting,
): Weighting {
  const baseProfile = REGIME_WEIGHT_PROFILES[detailedRegime]?.weights ?? BASE_WEIGHTS;
  const weights: Weighting = { ...(customWeights || baseProfile) };

  // Apply historical performance / reflection learning loop adjustments if present
  if (agentAccuracyModifiers) {
    for (const [key, modifier] of Object.entries(agentAccuracyModifiers)) {
      const agentKey = key as keyof Weighting;
      if (typeof weights[agentKey] === 'number' && typeof modifier === 'number') {
        weights[agentKey] = Math.max(2, weights[agentKey] + modifier);
      }
    }
  }

  // Normalize total to 100%
  const total = Object.values(weights).reduce((sum: number, val: number) => sum + val, 0);
  const normalized = {} as Weighting;
  const keys = Object.keys(weights) as (keyof Weighting)[];
  keys.forEach((key) => {
    normalized[key] = Math.round(((weights[key] ?? 0) / total) * 10_000) / 100;
  });
  const sumNormalized = Object.values(normalized).reduce((sum: number, val: number) => sum + val, 0);
  normalized.onchain = Math.round((normalized.onchain + 100 - sumNormalized) * 100) / 100;

  return normalized;
}
