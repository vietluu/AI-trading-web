import type { DecisionOutput, FusionInput } from "@platform/shared";

export const STRATEGY_KEYS = [
  "ai-core",
  "trend",
  "mean-reversion",
  "breakout",
  "news",
] as const;
export type StrategyKey = (typeof STRATEGY_KEYS)[number];

/** Portfolio routing parameters must not leak into strict analyst input schemas. */
export function analysisParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...params };
  delete result.strategyId;
  return result;
}

/** Converts the shared analysis snapshot into an independent strategy decision. */
export function decisionForStrategy(
  key: string,
  base: DecisionOutput,
  analyses: FusionInput,
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
    const rsi = analyses.technical.momentum.rsiState;
    if (rsi !== "NEUTRAL") {
      decision = rsi === "OVERSOLD" ? "LONG" : "SHORT";
      confidence = 70;
      explanation = `RSI is ${rsi.toLowerCase()}, activating mean reversion.`;
    }
  } else if (key === "breakout") {
    const trend = analyses.technical.trend.direction;
    if (analyses.technical.structure.breakout && trend !== "SIDEWAYS") {
      decision = trend === "UP" ? "LONG" : "SHORT";
      confidence = 74;
      explanation =
        "Confirmed structure breakout aligns with the technical trend.";
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
  if (base.dataQuality === "INSUFFICIENT") {
    decision = "WAIT";
    confidence = 0;
    explanation = "Insufficient shared market data forced WAIT.";
  }
  return {
    ...base,
    decision,
    confidence: Math.round(Math.min(100, Math.max(0, confidence))),
    reasoning: `[${key}] ${explanation} ${base.reasoning}`,
    overrides: [...base.overrides, `Applied ${key} strategy policy.`],
  };
}
