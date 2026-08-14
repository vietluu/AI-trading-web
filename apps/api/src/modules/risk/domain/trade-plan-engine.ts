import type { DecisionOutput } from "@platform/shared";

export type TradePlanRegime =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGING"
  | "BREAKOUT"
  | "HIGH_VOLATILITY";

export type TradePlanStrategy =
  | "TREND_PULLBACK"
  | "RANGE_REVERSAL"
  | "BREAKOUT_RETEST"
  | "MOMENTUM_SCALP"
  | "VOLATILITY_CONTROL"
  | "LEGACY_FALLBACK";

export interface TradePlanMarketContext {
  atr?: number;
  support?: number;
  resistance?: number;
  adx?: number;
  efficiencyRatio?: number;
  ema20?: number;
  ema50?: number;
  breakout?: boolean;
  marketStructure?: "HH_HL" | "LH_LL" | "LL_LH" | "RANGE";
  timeframeMs?: number;
}

export interface TradePlan {
  approved: boolean;
  reason?: string;
  regime: TradePlanRegime;
  strategy: TradePlanStrategy;
  stopLoss?: number;
  takeProfit?: number;
  rewardToRisk?: number;
  maxHoldingCandles: number;
  breakEvenAtR: number;
  trailingAtrMultiple?: number;
  atr?: number;
  timeframeMs?: number;
  entryLocation?: number;
  boundaryThreshold?: number;
  structuralRiskAtr?: number;
}

const finitePositive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;
const rounded = (value: number): number => Number(value.toFixed(8));
const rangeHoldingCandles = (timeframeMs?: number): number =>
  finitePositive(timeframeMs)
    ? Math.max(1, Math.min(8, Math.floor((2 * 3_600_000) / timeframeMs)))
    : 8;

export function resolveTradePlanRegime(
  decision: DecisionOutput,
  market: TradePlanMarketContext,
): TradePlanRegime {
  if (decision.regime.type === "HIGH_VOLATILITY") return "HIGH_VOLATILITY";
  if (market.breakout) return "BREAKOUT";
  const directionAligned = decision.decision === "LONG"
    ? finitePositive(market.ema20) && finitePositive(market.ema50) && market.ema20 > market.ema50
    : finitePositive(market.ema20) && finitePositive(market.ema50) && market.ema20 < market.ema50;
  const quantitativeTrend =
    finitePositive(market.adx) && market.adx >= 22 &&
    market.efficiencyRatio !== undefined && market.efficiencyRatio >= 0.3 &&
    directionAligned;
  if (quantitativeTrend)
    return decision.decision === "SHORT" ? "TREND_DOWN" : "TREND_UP";
  const quantitativeRange =
    (finitePositive(market.adx) && market.adx < 18) ||
    (market.efficiencyRatio !== undefined && market.efficiencyRatio < 0.25);
  if (
    (market.marketStructure === "RANGE" && !quantitativeTrend) ||
    decision.regime.type === "RANGING" ||
    quantitativeRange
  ) return "RANGING";
  return decision.decision === "SHORT" ? "TREND_DOWN" : "TREND_UP";
}

function rewardToRisk(
  side: "LONG" | "SHORT",
  entry: number,
  stopLoss: number,
  takeProfit: number,
  roundTripCostPct: number,
): number {
  const cost = entry * Math.max(0, roundTripCostPct);
  const grossReward = side === "LONG" ? takeProfit - entry : entry - takeProfit;
  const grossRisk = side === "LONG" ? entry - stopLoss : stopLoss - entry;
  return Math.max(0, grossReward - cost) / Math.max(Number.EPSILON, grossRisk + cost);
}

export function buildAdaptiveTradePlan(input: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  decision: DecisionOutput;
  market: TradePlanMarketContext;
  configuredStopLossPct: number;
  configuredRiskRewardRatio: number;
  roundTripCostPct?: number;
}): TradePlan {
  const { side, entryPrice, decision, market } = input;
  let regime = resolveTradePlanRegime(decision, market);
  const atr = market.atr;
  const support = market.support;
  const resistance = market.resistance;
  const costPct = input.roundTripCostPct ?? 0.0008;

  // Preserve safe behaviour for manual/API callers that do not have a complete
  // market snapshot yet. Automated pipeline calls supply ATR and range levels.
  if (!finitePositive(atr)) {
    const risk = entryPrice * input.configuredStopLossPct;
    const stopLoss = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const takeProfit = side === "LONG"
      ? entryPrice + risk * input.configuredRiskRewardRatio
      : entryPrice - risk * input.configuredRiskRewardRatio;
    return {
      approved: true,
      regime,
      strategy: "LEGACY_FALLBACK",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: input.configuredRiskRewardRatio,
      maxHoldingCandles: 16,
      breakEvenAtR: 1,
    };
  }

  if (/\[momentum-scalp\]/i.test(decision.reasoning)) {
    const risk = atr * 0.8;
    const stopLoss = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const targetMultiple = Math.max(1.25, Math.min(1.5, input.configuredRiskRewardRatio));
    const cost = entryPrice * costPct;
    const targetDistance = risk * targetMultiple + cost * (1 + targetMultiple);
    const takeProfit = side === "LONG"
      ? entryPrice + targetDistance
      : entryPrice - targetDistance;
    const rr = rewardToRisk(side, entryPrice, stopLoss, takeProfit, costPct);
    return {
      approved: rr >= 1.25 - 1e-6,
      ...(rr < 1.25 - 1e-6 ? { reason: "STRUCTURAL_RISK_REWARD_NOT_MET" } : {}),
      regime,
      strategy: "MOMENTUM_SCALP",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: rounded(rr),
      maxHoldingCandles: 6,
      breakEvenAtR: 0.7,
      trailingAtrMultiple: 1.5,
      atr,
      timeframeMs: market.timeframeMs,
      structuralRiskAtr: 0.8,
    };
  }

  // Derive a breakout from market prices when the model omitted its optional
  // breakout flag. A small ATR buffer avoids classifying a boundary touch as a
  // confirmed break.
  if (
    market.breakout !== true &&
    ((side === "LONG" && finitePositive(resistance) && entryPrice > resistance + atr * 0.1) ||
      (side === "SHORT" && finitePositive(support) && entryPrice < support - atr * 0.1))
  ) {
    regime = "BREAKOUT";
  }

  if (
    regime === "RANGING" &&
    finitePositive(support) &&
    finitePositive(resistance) &&
    resistance > support
  ) {
    const rangeWidth = resistance - support;
    const location = (entryPrice - support) / rangeWidth;
    const boundaryTolerance = Math.min(0.05, (atr / rangeWidth) * 0.1);
    const longBoundary = 0.35 + boundaryTolerance;
    const shortBoundary = 0.65 - boundaryTolerance;
    if ((side === "LONG" && location > longBoundary) || (side === "SHORT" && location < shortBoundary)) {
      return {
        approved: false,
        reason: "RANGE_ENTRY_NOT_AT_BOUNDARY",
        regime,
        strategy: "RANGE_REVERSAL",
        maxHoldingCandles: rangeHoldingCandles(market.timeframeMs),
        breakEvenAtR: 0.8,
        entryLocation: rounded(location),
        boundaryThreshold: rounded(side === "LONG" ? longBoundary : shortBoundary),
      };
    }
    const stopLoss = side === "LONG" ? support - atr * 0.3 : resistance + atr * 0.3;
    const takeProfit = side === "LONG" ? resistance - atr * 0.2 : support + atr * 0.2;
    const rr = rewardToRisk(side, entryPrice, stopLoss, takeProfit, costPct);
    const minimum = Math.min(input.configuredRiskRewardRatio, 1.25);
    if (
      (side === "LONG" && (stopLoss >= entryPrice || takeProfit <= entryPrice)) ||
      (side === "SHORT" && (stopLoss <= entryPrice || takeProfit >= entryPrice)) ||
      rr < minimum - 1e-6
    ) {
      return {
        approved: false,
        reason: "STRUCTURAL_RISK_REWARD_NOT_MET",
        regime,
        strategy: "RANGE_REVERSAL",
        rewardToRisk: rounded(rr),
        maxHoldingCandles: rangeHoldingCandles(market.timeframeMs),
        breakEvenAtR: 0.8,
        entryLocation: rounded(location),
        boundaryThreshold: rounded(side === "LONG" ? longBoundary : shortBoundary),
      };
    }
    return {
      approved: true,
      regime,
      strategy: "RANGE_REVERSAL",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: rounded(rr),
      maxHoldingCandles: rangeHoldingCandles(market.timeframeMs),
      breakEvenAtR: 0.8,
      atr,
      timeframeMs: market.timeframeMs,
      entryLocation: rounded(location),
      boundaryThreshold: rounded(side === "LONG" ? longBoundary : shortBoundary),
    };
  }

  if (regime === "BREAKOUT") {
    const boundary = side === "LONG" ? resistance : support;
    const structuralStop = finitePositive(boundary)
      ? side === "LONG" ? boundary - atr * 0.3 : boundary + atr * 0.3
      : side === "LONG" ? entryPrice - atr : entryPrice + atr;
    const minimumRisk = atr * 0.8;
    const rawRisk = Math.abs(entryPrice - structuralStop);
    const risk = Math.max(minimumRisk, rawRisk);
    if (risk > atr * 2) {
      return {
        approved: false,
        reason: "BREAKOUT_STOP_TOO_WIDE",
        regime,
        strategy: "BREAKOUT_RETEST",
        maxHoldingCandles: 5,
        breakEvenAtR: 0.8,
      };
    }
    const stopLoss = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const targetMultiple = Math.max(1.8, input.configuredRiskRewardRatio);
    const cost = entryPrice * costPct;
    const targetDistance = risk * targetMultiple + cost * (1 + targetMultiple);
    const takeProfit = side === "LONG"
      ? entryPrice + targetDistance
      : entryPrice - targetDistance;
    const rr = rewardToRisk(side, entryPrice, stopLoss, takeProfit, costPct);
    return {
      approved: rr >= 1.5 - 1e-6,
      ...(rr < 1.5 - 1e-6 ? { reason: "STRUCTURAL_RISK_REWARD_NOT_MET" } : {}),
      regime,
      strategy: "BREAKOUT_RETEST",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: rounded(rr),
      maxHoldingCandles: 5,
      breakEvenAtR: 0.8,
      trailingAtrMultiple: 2.5,
      atr,
      timeframeMs: market.timeframeMs,
    };
  }

  const structuralCandidates = side === "LONG"
    ? [
        finitePositive(support) ? support - atr * 0.3 : undefined,
        finitePositive(market.ema20) ? market.ema20 - atr * 0.3 : undefined,
        finitePositive(market.ema50) ? market.ema50 - atr * 0.3 : undefined,
      ].filter((value): value is number => finitePositive(value) && value < entryPrice)
    : [
        finitePositive(resistance) ? resistance + atr * 0.3 : undefined,
        finitePositive(market.ema20) ? market.ema20 + atr * 0.3 : undefined,
        finitePositive(market.ema50) ? market.ema50 + atr * 0.3 : undefined,
      ].filter((value): value is number => finitePositive(value) && value > entryPrice);
  const structuralStop = structuralCandidates.length > 0
    ? side === "LONG" ? Math.max(...structuralCandidates) : Math.min(...structuralCandidates)
    : side === "LONG" ? entryPrice - atr * 1.2 : entryPrice + atr * 1.2;
  const rawRisk = Math.abs(entryPrice - structuralStop);
  const structuralRiskAtr = rawRisk / atr;
  const maximumStructuralRiskAtr = regime === "HIGH_VOLATILITY" ? 2 : 3;
  if (structuralRiskAtr > maximumStructuralRiskAtr) {
    return {
      approved: false,
      reason: "STRUCTURAL_STOP_TOO_WIDE",
      regime,
      strategy: regime === "HIGH_VOLATILITY" ? "VOLATILITY_CONTROL" : "TREND_PULLBACK",
      maxHoldingCandles: regime === "HIGH_VOLATILITY" ? 8 : 20,
      breakEvenAtR: 1,
      structuralRiskAtr: rounded(structuralRiskAtr),
    };
  }
  const risk = Math.max(atr * 0.8, rawRisk);
  const stopLoss = side === "LONG" ? entryPrice - risk : entryPrice + risk;
  const cost = entryPrice * costPct;
  const targetDistance =
    risk * input.configuredRiskRewardRatio +
    cost * (1 + input.configuredRiskRewardRatio);
  let takeProfit = side === "LONG"
    ? entryPrice + targetDistance
    : entryPrice - targetDistance;

  // A nearby range boundary is a real obstacle unless a breakout has already
  // been confirmed. Place the target before it and validate the resulting RR.
  if (side === "LONG" && finitePositive(resistance)) {
    const capped = resistance - atr * 0.2;
    if (capped > entryPrice + atr * 0.5 && capped < takeProfit) takeProfit = capped;
  } else if (side === "SHORT" && finitePositive(support)) {
    const capped = support + atr * 0.2;
    if (capped < entryPrice - atr * 0.5 && capped > takeProfit) takeProfit = capped;
  }
  const rr = rewardToRisk(side, entryPrice, stopLoss, takeProfit, costPct);
  if (rr < input.configuredRiskRewardRatio - 1e-6) {
    return {
      approved: false,
      reason: "STRUCTURAL_RISK_REWARD_NOT_MET",
      regime,
      strategy: regime === "HIGH_VOLATILITY" ? "VOLATILITY_CONTROL" : "TREND_PULLBACK",
      rewardToRisk: rounded(rr),
      maxHoldingCandles: regime === "HIGH_VOLATILITY" ? 8 : 20,
      breakEvenAtR: 1,
      structuralRiskAtr: rounded(structuralRiskAtr),
    };
  }
  return {
    approved: true,
    regime,
    strategy: regime === "HIGH_VOLATILITY" ? "VOLATILITY_CONTROL" : "TREND_PULLBACK",
    stopLoss: rounded(stopLoss),
    takeProfit: rounded(takeProfit),
    rewardToRisk: rounded(rr),
    maxHoldingCandles: regime === "HIGH_VOLATILITY" ? 8 : 20,
    breakEvenAtR: 1,
    trailingAtrMultiple: regime === "HIGH_VOLATILITY" ? 3 : 2.5,
    atr,
    timeframeMs: market.timeframeMs,
    structuralRiskAtr: rounded(structuralRiskAtr),
  };
}
