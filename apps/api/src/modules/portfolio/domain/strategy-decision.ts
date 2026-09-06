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

export interface RankedStrategyDecision {
  strategyKey: StrategyKey;
  decision: DecisionOutput;
  score: number;
}

/**
 * Returns actionable strategy candidates in arbitration order. When no
 * strategy is actionable, the normal safe WAIT fallback is returned so callers
 * can still persist a complete decision record.
 */
export function rankStrategyDecisionCandidates(
  requestedKeys: readonly string[],
  base: DecisionOutput,
  analyses: FusionInput,
  market?: StrategyMarketSnapshot,
): RankedStrategyDecision[] {
  const candidates = evaluateStrategyCandidates(requestedKeys, base, analyses, market);
  const active = candidates
    .filter((candidate) => candidate.decision.decision !== "WAIT")
    .sort(compareCandidates);
  if (active.length > 0) return active;
  const fallback = candidates.find((candidate) => candidate.strategyKey === "ai-core") ?? candidates[0];
  return fallback ? [fallback] : [];
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
  const candidates = evaluateStrategyCandidates(requestedKeys, base, analyses, market);
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

function evaluateStrategyCandidates(
  requestedKeys: readonly string[],
  base: DecisionOutput,
  analyses: FusionInput,
  market?: StrategyMarketSnapshot,
): RankedStrategyDecision[] {
  return normalizeStrategyKeys(requestedKeys).map((strategyKey) => {
    const decision = decisionForStrategy(strategyKey, base, analyses, market);
    return {
      strategyKey,
      decision,
      score: strategyCandidateScore(strategyKey, decision),
    };
  });
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
    HIGH_VOLATILITY: { "ai-core": 0, trend: 2, breakout: 12, "momentum-scalp": -25, news: 8, "mean-reversion": -12 },
  };
  const boundedEv = Math.max(-1, Math.min(1, decision.expectedValue));
  return Number((
    decision.confidence * 0.55 +
    decision.opportunityScore * 0.25 +
    boundedEv * 10 +
    (affinity[decision.regime.type]?.[key] ?? 0)
  ).toFixed(3));
}

/**
 * Evaluates whether momentum is exhausted based on asset regime, trend strength, and RSI.
 * In explosive breakouts and strong trends, allows RSI up to 75 for LONG (and down to 25 for SHORT)
 * without triggering false exhaustion alarms.
 */
export function isMomentumExhausted(
  direction: "LONG" | "SHORT",
  analyses: FusionInput,
  baseRegime?: string,
  market?: StrategyMarketSnapshot,
): boolean {
  const parsedRsi = analyses.technical?.momentum?.rsi ? Number(analyses.technical.momentum.rsi) : NaN;
  const rsiState = analyses.technical?.momentum?.rsiState;
  const rsiValue = Number.isFinite(parsedRsi)
    ? parsedRsi
    : rsiState === "OVERBOUGHT"
      ? 78
      : rsiState === "OVERSOLD"
        ? 22
        : 50;

  const isStrongBreakoutOrTrend =
    baseRegime === "BREAKOUT" ||
    baseRegime === "TRENDING" ||
    analyses.technical?.structure?.breakout === true ||
    (analyses.technical?.trend?.strength === "STRONG" && analyses.technical?.trend?.direction !== "SIDEWAYS") ||
    (market?.adx !== undefined && market.adx >= 25) ||
    (market?.volumeChangePercent !== undefined && market.volumeChangePercent >= 30);

  if (direction === "LONG") {
    const hasBearishDiv = analyses.technical?.divergence?.rsiDivergence === "BEARISH";
    if (hasBearishDiv && rsiValue >= 68) return true;
    const upperLimit = isStrongBreakoutOrTrend ? 75 : 68;
    return rsiValue > upperLimit || (!isStrongBreakoutOrTrend && rsiState === "OVERBOUGHT");
  }

  if (direction === "SHORT") {
    const hasBullishDiv = analyses.technical?.divergence?.rsiDivergence === "BULLISH";
    if (hasBullishDiv && rsiValue <= 32) return true;
    const lowerLimit = isStrongBreakoutOrTrend ? 25 : 32;
    return rsiValue < lowerLimit || (!isStrongBreakoutOrTrend && rsiState === "OVERSOLD");
  }

  return false;
}

/** Converts the shared analysis snapshot into an independent strategy decision. */
export function decisionForStrategy(
  key: string,
  base: DecisionOutput,
  analyses: FusionInput,
  market?: StrategyMarketSnapshot,
): DecisionOutput {
  let decisionBase = base;

  // RSI Exhaustion / Momentum Guard
  if (["ai-core", "trend"].includes(key) && decisionBase.decision !== "WAIT") {
    if (isMomentumExhausted(decisionBase.decision, analyses, decisionBase.regime.type, market)) {
      const rsiDesc = analyses.technical?.momentum?.rsi ?? analyses.technical?.momentum?.rsiState ?? "exhausted";
      decisionBase = {
        ...decisionBase,
        decision: "WAIT",
        overrides: [
          ...decisionBase.overrides,
          `Blocked ${decisionBase.decision} due to momentum exhaustion (RSI ${rsiDesc}).`,
        ],
      };
    }
  }

  if (key === "ai-core") return decisionBase;
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
    const isRanging = base.regime.type === "RANGING";
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
    const rsiExhausted = direction
      ? isMomentumExhausted(direction, analyses, base.regime.type, market)
      : false;
    const impulse = Math.abs(priceChange ?? 0);
    const minImpulse = isRanging ? 0.35 : 0.15;
    const liquidImpulse = Number.isFinite(volumeChange) && (volumeChange ?? 0) >= 0.35;
    const efficientMove = (market?.adx ?? 0) >= 18 || (market?.efficiencyRatio ?? 0) >= 0.25;
    if (
      base.regime.type !== "HIGH_VOLATILITY" &&
      !rsiExhausted &&
      timeframeMinutes <= 15 &&
      direction &&
      impulse >= minImpulse && impulse <= 2.5 &&
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

  // Strategy routing may specialize a shared decision, but partial evidence
  // must never manufacture stronger conviction than the underlying consensus.
  // This keeps an uncalibrated rule-based candidate from reaching the exact
  // confidence boundary used by the automatic-execution Judge.
  if (base.dataQuality === "PARTIAL") {
    confidence = Math.min(confidence, base.confidence);
  }

  if (
    decision !== "WAIT" &&
    (key === "trend" || key === "breakout" || key === "momentum-scalp") &&
    isMomentumExhausted(decision, analyses, base.regime.type, market)
  ) {
    const rsiDesc = analyses.technical?.momentum?.rsi ?? analyses.technical?.momentum?.rsiState ?? "exhausted";
    decision = "WAIT";
    confidence = 0;
    explanation = `${key} entry rejected because it would chase an exhausted move (RSI ${rsiDesc}).`;
  }

  const isStrongTrend =
    analyses.market.trend.strength === "STRONG" &&
    analyses.technical.trend.strength === "STRONG" &&
    analyses.market.trend.direction === analyses.technical.trend.direction;

  if (
    analyses.market.volatility.level === "HIGH" &&
    key !== "breakout" &&
    key !== "momentum-scalp" &&
    !(key === "trend" && isStrongTrend)
  ) {
    confidence -= 10;
  }
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
    // Agreement describes independent analyst consensus. A strategy's own
    // confidence is not another analyst vote and must not overwrite it.
    agreementScore: base.agreementScore,
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
