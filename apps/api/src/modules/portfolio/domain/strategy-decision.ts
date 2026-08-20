import type { DecisionOutput, FusionInput } from "@platform/shared";

export const STRATEGY_KEYS = [
  "ai-core",
  "trend",
  "mean-reversion",
  "breakout",
  "momentum-scalp",
  "news",
] as const;
export type StrategyKey = (typeof STRATEGY_KEYS)[number];

export interface StrategyMarketSnapshot {
  timeframe?: string;
  priceChangePercent?: number;
  volumeChangePercent?: number;
  adx?: number;
  efficiencyRatio?: number;
  ema20?: number;
  ema50?: number;
}

/** Portfolio routing parameters must not leak into strict analyst input schemas. */
export function analysisParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    "interval",
    "lookbackCandles",
    "lookbackHours",
    "maxItems",
  ] as const) {
    if (params[key] !== undefined) result[key] = params[key];
  }
  return result;
}

export interface StrategySelection {
  selectedStrategyKey: StrategyKey;
  decision: DecisionOutput;
  candidates: Array<{
    strategyKey: StrategyKey;
    decision: DecisionOutput["decision"];
    confidence: number;
    opportunityScore: number;
    expectedValue: number;
    score: number;
  }>;
  reason: "BEST_REGIME_ADJUSTED_CANDIDATE" | "NO_ACTIONABLE_STRATEGY";
}

/**
 * Evaluates every configured strategy against one shared analysis snapshot and
 * deterministically selects one candidate. This is deliberately pure: the
 * Judge, Quant and Risk gates still run exactly once after arbitration.
 */
export function selectStrategyDecision(
  requestedKeys: readonly string[],
  base: DecisionOutput,
  analyses: FusionInput,
  market?: StrategyMarketSnapshot,
): StrategySelection {
  const keys = normalizeStrategyKeys(requestedKeys);
  const candidates = keys.map((strategyKey) => {
    const decision = decisionForStrategy(strategyKey, base, analyses, market);
    return {
      strategyKey,
      decision,
      score: strategyCandidateScore(strategyKey, decision),
    };
  });
  const active = candidates
    .filter((candidate) => candidate.decision.decision !== "WAIT")
    .sort(compareCandidates);
  const selected = active[0] ??
    candidates.find((candidate) => candidate.strategyKey === "ai-core") ??
    candidates[0]!;

  return {
    selectedStrategyKey: selected.strategyKey,
    decision: selected.decision,
    candidates: candidates.map((candidate) => ({
      strategyKey: candidate.strategyKey,
      decision: candidate.decision.decision,
      confidence: candidate.decision.confidence,
      opportunityScore: candidate.decision.opportunityScore,
      expectedValue: candidate.decision.expectedValue,
      score: candidate.score,
    })),
    reason: active.length > 0
      ? "BEST_REGIME_ADJUSTED_CANDIDATE"
      : "NO_ACTIONABLE_STRATEGY",
  };
}

function normalizeStrategyKeys(keys: readonly string[]): StrategyKey[] {
  const allowed = new Set<string>(STRATEGY_KEYS);
  const unique = [...new Set(keys)].filter((key): key is StrategyKey => allowed.has(key));
  return unique.length > 0 ? unique : ["ai-core"];
}

function compareCandidates(
  left: { strategyKey: StrategyKey; score: number },
  right: { strategyKey: StrategyKey; score: number },
): number {
  return right.score - left.score ||
    STRATEGY_KEYS.indexOf(left.strategyKey) - STRATEGY_KEYS.indexOf(right.strategyKey);
}

function strategyCandidateScore(key: StrategyKey, decision: DecisionOutput): number {
  const affinity: Record<DecisionOutput["regime"]["type"], Partial<Record<StrategyKey, number>>> = {
    TRENDING: { "ai-core": 4, trend: 18, breakout: 12, "momentum-scalp": 16, "mean-reversion": -20 },
    RANGING: { "ai-core": 0, trend: -18, breakout: -14, "momentum-scalp": -8, "mean-reversion": 22 },
    HIGH_VOLATILITY: { "ai-core": 0, trend: 2, breakout: 12, "momentum-scalp": 8, news: 8, "mean-reversion": -12 },
  };
  const boundedEv = Math.max(-1, Math.min(1, decision.expectedValue));
  return Number((
    decision.confidence * 0.55 +
    decision.opportunityScore * 0.25 +
    boundedEv * 10 +
    (affinity[decision.regime.type]?.[key] ?? 0)
  ).toFixed(3));
}

/** Converts the shared analysis snapshot into an independent strategy decision. */
export function decisionForStrategy(
  key: string,
  base: DecisionOutput,
  analyses: FusionInput,
  market?: StrategyMarketSnapshot,
): DecisionOutput {
  if (key === "ai-core") return base;
  let decision: DecisionOutput["decision"] = "WAIT";
  let confidence = 0;
  let explanation = "No strategy-specific setup is active.";
  if (key === "trend") {
    const market = analyses.market.trend.direction;
    const technical = analyses.technical.trend.direction;
    if (market === technical && market !== "SIDEWAYS") {
      decision = market === "UP" ? "LONG" : "SHORT";
      confidence =
        analyses.market.trend.strength === "STRONG" &&
        analyses.technical.trend.strength === "STRONG"
          ? 80
          : 68;
      explanation = "Market and technical trends agree.";
    }
  } else if (key === "mean-reversion") {
    const ranging = base.regime.type === "RANGING";
    const rsi = analyses.technical.momentum.rsiState;
    const bollinger = analyses.technical.volatility?.bollinger?.position;
    const structure = analyses.technical.structure;
    const atRangeBoundary =
      (rsi === "OVERSOLD" && bollinger === "LOWER") ||
      (rsi === "OVERBOUGHT" && bollinger === "UPPER");
    if (
      ranging &&
      structure.marketStructure === "RANGE" &&
      structure.breakout !== true &&
      atRangeBoundary
    ) {
      decision = rsi === "OVERSOLD" ? "LONG" : "SHORT";
      const confirmingDivergence = decision === "LONG"
        ? analyses.technical.divergence?.rsiDivergence === "BULLISH"
        : analyses.technical.divergence?.rsiDivergence === "BEARISH";
      const confirmingMacd = decision === "LONG"
        ? analyses.technical.momentum.macd.trend === "BULLISH"
        : analyses.technical.momentum.macd.trend === "BEARISH";
      confidence = 70 + (confirmingDivergence ? 4 : 0) + (confirmingMacd ? 3 : 0);
      explanation = `Ranging structure, ${bollinger.toLowerCase()} Bollinger boundary and ${rsi.toLowerCase()} RSI activated mean reversion.`;
    }
  } else if (key === "breakout") {
    const trend = analyses.technical.trend.direction;
    if (analyses.technical.structure.breakout && trend !== "SIDEWAYS") {
      decision = trend === "UP" ? "LONG" : "SHORT";
      confidence = 74;
      explanation =
        "Confirmed structure breakout aligns with the technical trend.";
    }
  } else if (key === "momentum-scalp") {
    const timeframeMinutes = parseTimeframeMinutes(market?.timeframe);
    const priceChange = market?.priceChangePercent;
    const volumeChange = market?.volumeChangePercent;
    const direction = Number.isFinite(priceChange) && (priceChange ?? 0) !== 0
      ? (priceChange ?? 0) > 0 ? "LONG" : "SHORT"
      : undefined;
    const trendDirection = analyses.technical.trend.direction;
    const macdDirection = analyses.technical.momentum.macd?.trend;
    const emaAligned = direction === "LONG"
      ? Number.isFinite(market?.ema20) && Number.isFinite(market?.ema50) && market!.ema20! >= market!.ema50!
      : direction === "SHORT"
        ? Number.isFinite(market?.ema20) && Number.isFinite(market?.ema50) && market!.ema20! <= market!.ema50!
        : false;
    const trendAligned = direction === "LONG"
      ? trendDirection === "UP" || macdDirection === "BULLISH" || emaAligned
      : direction === "SHORT"
        ? trendDirection === "DOWN" || macdDirection === "BEARISH" || emaAligned
        : false;
    const impulse = Math.abs(priceChange ?? 0);
    const liquidImpulse = Number.isFinite(volumeChange) && (volumeChange ?? 0) >= 0.35;
    const efficientMove = (market?.adx ?? 0) >= 18 || (market?.efficiencyRatio ?? 0) >= 0.25;
    if (
      timeframeMinutes <= 15 &&
      direction &&
      impulse >= 0.15 && impulse <= 2.5 &&
      liquidImpulse && efficientMove && trendAligned
    ) {
      decision = direction;
      confidence = 66 + Math.min(8, Math.floor(impulse * 4)) +
        ((market?.adx ?? 0) >= 22 ? 3 : 0) +
        ((market?.efficiencyRatio ?? 0) >= 0.3 ? 3 : 0);
      explanation = `Short-horizon ${impulse.toFixed(2)}% price impulse with ${Number(volumeChange).toFixed(2)}% volume expansion and directional confirmation activated momentum scalp.`;
    }
  } else if (key === "news") {
    const impact = analyses.news.impact;
    if (impact.level !== "LOW" && impact.direction !== "NEUTRAL") {
      decision = impact.direction === "POSITIVE" ? "LONG" : "SHORT";
      confidence = impact.level === "HIGH" ? 82 : 68;
      explanation = `${impact.level.toLowerCase()}-impact ${impact.direction.toLowerCase()} news signal.`;
    }
  } else
    return {
      ...base,
      decision: "WAIT",
      confidence: 0,
      reasoning: `Unknown strategy '${key}'.`,
    };

  if (analyses.market.volatility.level === "HIGH") confidence -= 10;
  if (base.dataQuality === "PARTIAL") confidence = Math.min(confidence, 75);
  if (base.dataQuality === "INSUFFICIENT") {
    decision = "WAIT";
    confidence = 0;
    explanation = "Insufficient shared market data forced WAIT.";
  }
  const adaptiveThreshold = key === "mean-reversion"
    ? Math.min(base.adaptiveThreshold, 62)
    : key === "momentum-scalp"
      ? Math.min(base.adaptiveThreshold, 65)
      : base.adaptiveThreshold;
  const strategyEconomics = decision !== "WAIT"
    ? strategyAdjustedEconomics(
        base,
        confidence,
        key === "mean-reversion" ? 68 : key === "momentum-scalp" ? 70 : undefined,
      )
    : {};
  return {
    ...base,
    ...strategyEconomics,
    ...(decision !== base.decision || confidence !== base.confidence
      ? { confidenceCalibration: undefined }
      : {}),
    decision,
    confidence: Math.round(Math.min(100, Math.max(0, confidence))),
    adaptiveThreshold,
    reasoning: `[${key}] ${explanation} ${base.reasoning}`,
    overrides: [...base.overrides, `Applied ${key} strategy policy.`],
  };
}

function parseTimeframeMinutes(timeframe?: string): number {
  const match = /^(\d+)([mhd])$/i.exec(timeframe ?? "");
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  return value * (match[2]!.toLowerCase() === "d" ? 1440 : match[2]!.toLowerCase() === "h" ? 60 : 1);
}

function strategyAdjustedEconomics(
  base: DecisionOutput,
  confidence: number,
  opportunityFloor?: number,
): Pick<
  DecisionOutput,
  | "agreementScore"
  | "opportunityScore"
  | "expectedWinProbability"
  | "expectedReward"
  | "expectedLoss"
  | "expectedValue"
  | "profitFactorEstimate"
> {
  const opportunityScore = Math.max(base.opportunityScore, opportunityFloor ?? 0);
  const expectedWinProbability = clamp(
    0.5,
    0,
    1,
  );
  const expectedReward = clamp((opportunityScore / 100) * 3 + 0.5, 0.2, 5);
  const expectedLoss = clamp((100 - opportunityScore) / 100 * 1.4 + 0.4, 0.2, 3);
  const expectedValue = clamp(
    expectedWinProbability * expectedReward -
      (1 - expectedWinProbability) * expectedLoss -
      base.executionCost,
    -3,
    3,
  );
  return {
    agreementScore: Math.max(base.agreementScore, confidence),
    opportunityScore: Math.round(opportunityScore),
    expectedWinProbability: Number(expectedWinProbability.toFixed(3)),
    expectedReward: Number(expectedReward.toFixed(3)),
    expectedLoss: Number(expectedLoss.toFixed(3)),
    expectedValue: Number(expectedValue.toFixed(3)),
    profitFactorEstimate: Number(
      clamp(
        (expectedWinProbability * expectedReward) /
          Math.max((1 - expectedWinProbability) * expectedLoss, 0.05),
        0.1,
        10,
      ).toFixed(3),
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
