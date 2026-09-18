import type { DecisionOutput, TradeThesis, AnticipatoryMarketSnapshot, StructuredTrigger } from "@platform/shared";
import type { ExecutionContext, RiskTier } from "../../pipeline/domain/execution-context";
import { adaptiveTradingPolicy } from "../../pipeline/domain/adaptive-trading-policy";
import { selectEntryOrderPolicy } from "./entry-order-policy";

export type TradePlanRegime =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGING"
  | "BREAKOUT"
  | "HIGH_VOLATILITY"
  | "PRE_BREAKOUT_ACCUMULATION";

export type TradePlanStrategy =
  | "TREND_PULLBACK"
  | "RANGE_REVERSAL"
  | "BREAKOUT_RETEST"
  | "MOMENTUM_SCALP"
  | "VOLATILITY_CONTROL"
  | "LIQUIDITY_SWEEP_REVERSAL"
  | "RECOVERY_RECLAIM"
  | "SQUEEZE_BREAKOUT"
  | "LEGACY_FALLBACK";

export interface ProactiveExecutionContext {
  thesisId: string;
  parentThesisId?: string;
  thesis: TradeThesis;
  snapshot: AnticipatoryMarketSnapshot;
  mode: 'OBSERVE' | 'SHADOW' | 'DEMO';
  sizeFactor: number;
}

export interface StoredProbe {
  stage: 'PROBE' | 'CONFIRMED';
  thesisId: string;
  setup: string;
  trigger: StructuredTrigger[];
  sourceDataCutoff: string;
}

export interface TradePlanMarketContext {
  proactive?: ProactiveExecutionContext;
  executionContext?: ExecutionContext;
  atr?: number;
  rsi?: number;
  support?: number;
  resistance?: number;
  adx?: number;
  efficiencyRatio?: number;
  ema20?: number;
  ema50?: number;
  breakout?: boolean;
  marketStructure?: "HH_HL" | "LH_LL" | "LL_LH" | "RANGE";
  timeframeMs?: number;
  candleOpen?: number;
  candleHigh?: number;
  candleLow?: number;
  candleClose?: number;
  volumeRatio?: number;
  currentPrice?: number;
  liquiditySweep?: boolean;
  derivativesImbalance?: number;
  gateSeverity?: "APPROVE" | "REDUCE_SIZE" | "BLOCK";
  squeezeState?: {
    isSqueezing: boolean;
    breakoutProbability: number;
    momentumDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    consecutiveSqueezeBars: number;
  };
  tickSize?: number;
}

export interface TradePlan {
  approved: boolean;
  reason?: string;
  regime: TradePlanRegime;
  strategy: TradePlanStrategy;
  riskTier?: RiskTier;
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
  /** Conservative entry + exit fees/slippage used by execution risk. */
  estimatedRoundTripCostPct?: number;
  grossRewardPct?: number;
  expectedNetRewardPct?: number;
  netRewardToRisk?: number;
  lossStreakSizeFactor?: number;
  limitEntryPrice?: number;
  limitPrice?: number;
  orderType?: "MARKET" | "LIMIT";
  limitTtlCandles?: number;
  timeInForce?: 'IOC' | 'GTC';
  expiresAt?: string;
  sizeFactor?: number;
  targets?: TradeThesis['targets'];
  isLiquiditySweep?: boolean;
  tp1Price?: number;
  tp2Price?: number;
  stagedEntry?: StoredProbe & {
    stage: "PROBE" | "CONFIRMED";
    probeSizePct: number;
    confirmationSizePct: number;
    combinedRiskLimitPct: number;
  };
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
  if (decision.regimeDetailed === "PRE_BREAKOUT_ACCUMULATION" || decision.regime.detailed === "PRE_BREAKOUT_ACCUMULATION") return "PRE_BREAKOUT_ACCUMULATION";
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
    (finitePositive(market.adx) && market.adx < 20) ||
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

function _buildAdaptiveTradePlan(input: {
  symbol?: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  decision: DecisionOutput;
  market: TradePlanMarketContext;
  configuredStopLossPct: number;
  configuredRiskRewardRatio: number;
  roundTripCostPct?: number;
  useLimitlessTrailing?: boolean;
  executionContext?: ExecutionContext;
}): TradePlan {
  const { side, entryPrice, decision, market } = input;
  const context = input.executionContext ?? market.executionContext ?? decision.executionContext;
  let regime: TradePlanRegime;
  if (context) {
    if (context.regime === "RANGING") regime = "RANGING";
    else if (context.regime === "BREAKOUT") regime = "BREAKOUT";
    else if (context.regime === "PRE_BREAKOUT") regime = "PRE_BREAKOUT_ACCUMULATION";
    else if (context.regime === "TRENDING") regime = side === "LONG" ? "TREND_UP" : "TREND_DOWN";
    else regime = resolveTradePlanRegime(decision, market);
  } else {
    regime = resolveTradePlanRegime(decision, market);
  }
  const atr = market.atr;
  const support = market.support;
  const resistance = market.resistance;
  const costPct = input.roundTripCostPct ?? 0.0008;
  const momentumScalp = !context && /\[momentum-scalp\]/i.test(decision.reasoning);
  const policy = adaptiveTradingPolicy({
    symbol: input.symbol,
    regime:
      regime === "TREND_UP" || regime === "TREND_DOWN" || regime === "BREAKOUT"
        ? "TRENDING"
        : regime === "HIGH_VOLATILITY"
          ? "HIGH_VOLATILITY"
          : "RANGING",
    spreadBps: input.roundTripCostPct !== undefined ? input.roundTripCostPct * 10_000 : undefined,
  });

  // Preserve safe behaviour for manual/API callers that do not have a complete
  // market snapshot yet. Automated pipeline calls supply ATR and range levels.
  if (!finitePositive(atr)) {
    const risk = entryPrice * input.configuredStopLossPct;
    const cost = entryPrice * costPct;
    const stopLoss = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const targetDistance =
      risk * input.configuredRiskRewardRatio +
      cost * (1 + input.configuredRiskRewardRatio);
    const takeProfit = side === "LONG"
      ? entryPrice + targetDistance
      : entryPrice - targetDistance;
    return {
      approved: true,
      regime,
      strategy: "LEGACY_FALLBACK",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: rounded(
        rewardToRisk(side, entryPrice, stopLoss, takeProfit, costPct),
      ),
      maxHoldingCandles: 16,
      breakEvenAtR: 1,
    };
  }

  // 1. Volume Exhaustion / Climax Spike Gate
  // When volume is extreme (> 2.5x avg) but body is narrow (< 35% of full range),
  // a long opposing wick indicates smart money distribution or rejection.
  if (
    finitePositive(market.volumeRatio) &&
    market.volumeRatio > 2.5 &&
    finitePositive(market.candleHigh) &&
    finitePositive(market.candleLow) &&
    finitePositive(market.candleOpen) &&
    finitePositive(market.candleClose)
  ) {
    const candleRange = market.candleHigh - market.candleLow;
    if (candleRange > 0) {
      const body = Math.abs(market.candleClose - market.candleOpen);
      const upperWick = market.candleHigh - Math.max(market.candleOpen, market.candleClose);
      const lowerWick = Math.min(market.candleOpen, market.candleClose) - market.candleLow;
      const bodyRatio = body / candleRange;

      if (bodyRatio < 0.35) {
        // For LONG: if upper wick dominates (> 50% of range), buyers were rejected at highs
        if (side === "LONG" && upperWick / candleRange > 0.5) {
          return {
            approved: false,
            reason: "VOLUME_EXHAUSTION_SPIKE",
            regime,
            strategy: "LEGACY_FALLBACK",
            maxHoldingCandles: 4,
            breakEvenAtR: 1,
          };
        }
        // For SHORT: if lower wick dominates (> 50% of range), sellers were absorbed at lows
        if (side === "SHORT" && lowerWick / candleRange > 0.5) {
          return {
            approved: false,
            reason: "VOLUME_EXHAUSTION_SPIKE",
            regime,
            strategy: "LEGACY_FALLBACK",
            maxHoldingCandles: 4,
            breakEvenAtR: 1,
          };
        }
      }
    }
  }

  // 2. Liquidity Sweep / V-Shape Reversal Detection
  // e.g. Price dipped below support / dumped -3% but retracted >= 70% of the dump,
  // creating a bear trap. We enter LONG with a tight structural stop below the sweep wick.
  const isLiquiditySweep = (() => {
    if (
      finitePositive(market.candleHigh) &&
      finitePositive(market.candleLow) &&
      finitePositive(market.candleOpen) &&
      finitePositive(market.candleClose)
    ) {
      const candleRange = market.candleHigh - market.candleLow;
      if (candleRange > 0) {
        if (side === "LONG") {
          const lowerWick = Math.min(market.candleOpen, market.candleClose) - market.candleLow;
          // Retraction >= 70% from lowest low
          const retractionPct = lowerWick / candleRange;
          const sweptSupport = finitePositive(support) && market.candleLow < support && market.candleClose > support;
          return retractionPct >= 0.7 || sweptSupport;
        } else if (side === "SHORT") {
          const upperWick = market.candleHigh - Math.max(market.candleOpen, market.candleClose);
          const retractionPct = upperWick / candleRange;
          const sweptResistance = finitePositive(resistance) && market.candleHigh > resistance && market.candleClose < resistance;
          return retractionPct >= 0.7 || sweptResistance;
        }
      }
    }
    return false;
  })();

  if (!context && isLiquiditySweep && finitePositive(atr)) {
    const sweepWickExtreme = side === "LONG" ? market.candleLow! : market.candleHigh!;
    const buffer = atr * 0.2;
    const stopLoss = side === "LONG" ? sweepWickExtreme - buffer : sweepWickExtreme + buffer;
    const rawRisk = Math.abs(entryPrice - stopLoss);
    const risk = Math.max(atr * 0.8, rawRisk);
    const targetMultiple = Math.max(2.5, policy.minStructuralRiskReward);
    const cost = entryPrice * costPct;
    const targetDistance = risk * targetMultiple + cost * (1 + targetMultiple);
    const takeProfit = side === "LONG" ? entryPrice + targetDistance : entryPrice - targetDistance;
    const rr = rewardToRisk(side, entryPrice, stopLoss, takeProfit, costPct);

    // Limit Pullback for liquidity sweep: entry waits for minor retest
    const pullbackOffset = Math.min(atr * 0.25, Math.abs(entryPrice - sweepWickExtreme) * 0.382);
    const limitEntryPrice = side === "LONG" ? entryPrice - pullbackOffset : entryPrice + pullbackOffset;

    return {
      approved: rr >= 2.0 - 1e-6,
      ...(rr < 2.0 - 1e-6 ? { reason: "STRUCTURAL_RISK_REWARD_NOT_MET" } : {}),
      regime,
      strategy: "LIQUIDITY_SWEEP_REVERSAL",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: rounded(rr),
      maxHoldingCandles: 10,
      breakEvenAtR: 0.8,
      trailingAtrMultiple: Number((2.0 * policy.executionCostMultiplier).toFixed(2)),
      atr,
      timeframeMs: market.timeframeMs,
      limitEntryPrice: rounded(limitEntryPrice),
      orderType: "LIMIT",
      limitTtlCandles: 2,
      isLiquiditySweep: true,
    };
  }
  
  if (
    context?.setup === "TRANSITION_PROBE" ||
    (!context &&
      (regime === "PRE_BREAKOUT_ACCUMULATION" || regime === "HIGH_VOLATILITY") &&
      market.squeezeState?.isSqueezing &&
      market.squeezeState.breakoutProbability > 65 &&
      finitePositive(atr) &&
      finitePositive(support) &&
      finitePositive(resistance))
  ) {
    if (
      !market.squeezeState?.isSqueezing ||
      market.squeezeState.breakoutProbability <= 65 ||
      !finitePositive(support) ||
      !finitePositive(resistance)
    ) {
      return {
        approved: false,
        reason: "TRANSITION_CONDITIONS_NOT_MET",
        regime: "PRE_BREAKOUT_ACCUMULATION",
        strategy: "SQUEEZE_BREAKOUT",
        maxHoldingCandles: 8,
        breakEvenAtR: 1,
      };
    }
    const isLong = side === "LONG";
    const limitEntryPrice = isLong ? support : resistance;
    const buffer = atr * 0.3;
    const stopLoss = isLong ? support - buffer : resistance + buffer;
    const targetDistance = atr * 4;
    const takeProfit = isLong ? limitEntryPrice + targetDistance : limitEntryPrice - targetDistance;
    const rr = rewardToRisk(side, limitEntryPrice, stopLoss, takeProfit, costPct);
    
    return {
      approved: true,
      regime: "PRE_BREAKOUT_ACCUMULATION",
      strategy: "SQUEEZE_BREAKOUT",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: rounded(rr),
      maxHoldingCandles: 15,
      breakEvenAtR: 1,
      trailingAtrMultiple: 1.5,
      atr,
      timeframeMs: market.timeframeMs,
      limitEntryPrice: rounded(limitEntryPrice),
      orderType: "LIMIT",
      limitTtlCandles: 4,
    };
  }

  if (momentumScalp) {
    if (regime === "HIGH_VOLATILITY") {
      return {
        approved: false,
        reason: "MOMENTUM_SCALP_DISABLED_IN_HIGH_VOLATILITY",
        regime,
        strategy: "MOMENTUM_SCALP",
        maxHoldingCandles: 6,
        breakEvenAtR: 0.8,
      };
    }
    const emaExtension = finitePositive(market.ema20)
      ? side === "LONG"
        ? entryPrice - market.ema20
        : market.ema20 - entryPrice
      : 0;
    const exhaustedMomentum =
      (side === "LONG" && (market.rsi ?? 0) >= policy.maxRsiLong) ||
      (side === "SHORT" && (market.rsi ?? 100) <= policy.minRsiShort);
    if (
      emaExtension > atr * 1.5 ||
      (exhaustedMomentum && emaExtension > atr * 0.75)
    ) {
      return {
        approved: false,
        reason: "MOMENTUM_ENTRY_OVEREXTENDED",
        regime,
        strategy: "MOMENTUM_SCALP",
        maxHoldingCandles: 6,
        breakEvenAtR: 0.8,
      };
    }
    // The old 0.8 ATR stop was inside ordinary short-horizon noise in
    // production. A wider structural stop automatically reduces position size,
    // so monetary risk remains bounded while avoiding noise-only stop-outs.
    // Low-cap / LONG_TAIL assets have wider wicks and require 1.8 ATR stop buffer.
    const riskAtrMultiple = policy.liquidityClass === 'LONG_TAIL' ? 1.8 : policy.liquidityClass === 'LIQUID_ALT' ? 1.4 : 1.2;
    const risk = atr * riskAtrMultiple;
    const stopLoss = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const targetMultiple = Math.max(1.8, Math.min(2.5, input.configuredRiskRewardRatio));
    const cost = entryPrice * costPct;
    const targetDistance = risk * targetMultiple + cost * (1 + targetMultiple);
    const takeProfit = side === "LONG"
      ? entryPrice + targetDistance
      : entryPrice - targetDistance;
    const rr = rewardToRisk(side, entryPrice, stopLoss, takeProfit, costPct);
    const pullbackOffset = Math.min(atr * 0.25, entryPrice * 0.003);
    const limitEntryPrice = side === "LONG" ? entryPrice - pullbackOffset : entryPrice + pullbackOffset;
    return {
      approved: rr >= 1.5 - 1e-6,
      ...(rr < 1.5 - 1e-6 ? { reason: "STRUCTURAL_RISK_REWARD_NOT_MET" } : {}),
      regime,
      strategy: "MOMENTUM_SCALP",
      stopLoss: rounded(stopLoss),
      takeProfit: rounded(takeProfit),
      rewardToRisk: rounded(rr),
      maxHoldingCandles: 6,
      breakEvenAtR: 0.8,
      trailingAtrMultiple: Number((1.8 * policy.executionCostMultiplier).toFixed(2)),
      atr,
      timeframeMs: market.timeframeMs,
      structuralRiskAtr: 1.2,
      limitEntryPrice: rounded(limitEntryPrice),
      orderType: "LIMIT",
      limitTtlCandles: 2,
    };
  }

  // Derive a breakout from market prices when the model omitted its optional
  // breakout flag. A small ATR buffer avoids classifying a boundary touch as a
  // confirmed break.
  if (
    !context &&
    market.breakout !== true &&
    ((side === "LONG" && finitePositive(resistance) && entryPrice > resistance + atr * 0.1) ||
      (side === "SHORT" && finitePositive(support) && entryPrice < support - atr * 0.1))
  ) {
    regime = "BREAKOUT";
  }

  if (
    context?.setup === "RANGE_REVERSION" ||
    (!context &&
      regime === "RANGING" &&
      finitePositive(support) &&
      finitePositive(resistance) &&
      resistance > support)
  ) {
    if (!finitePositive(support) || !finitePositive(resistance) || resistance <= support) {
      return {
        approved: false,
        reason: "RANGE_LOCATION_UNAVAILABLE",
        regime: "RANGING",
        strategy: "RANGE_REVERSAL",
        maxHoldingCandles: rangeHoldingCandles(market.timeframeMs),
        breakEvenAtR: 0.8,
      };
    }
    const rangeWidth = resistance - support;
    const location = (entryPrice - support) / rangeWidth;
    const boundaryTolerance = Math.min(0.05, (atr / rangeWidth) * 0.1);
    const longBoundary = 0.35 + boundaryTolerance;
    const shortBoundary = 0.65 - boundaryTolerance;
    if ((side === "LONG" && location > longBoundary) || (side === "SHORT" && location < shortBoundary)) {
      return {
        approved: false,
        reason: "RANGE_ENTRY_NOT_AT_BOUNDARY",
        regime: "RANGING",
        strategy: "RANGE_REVERSAL",
        maxHoldingCandles: rangeHoldingCandles(market.timeframeMs),
        breakEvenAtR: 0.8,
        entryLocation: rounded(location),
        boundaryThreshold: rounded(side === "LONG" ? longBoundary : shortBoundary),
      };
    }
    const stopLoss = side === "LONG" ? support - atr * 0.5 : resistance + atr * 0.5;
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
        regime: "RANGING",
        strategy: "RANGE_REVERSAL",
        rewardToRisk: rounded(rr),
        maxHoldingCandles: rangeHoldingCandles(market.timeframeMs),
        breakEvenAtR: 0.8,
        entryLocation: rounded(location),
        boundaryThreshold: rounded(side === "LONG" ? longBoundary : shortBoundary),
      };
    }
    const pullbackOffset = Math.min(atr * 0.25, entryPrice * 0.003);
    const limitEntryPrice = side === "LONG" ? entryPrice - pullbackOffset : entryPrice + pullbackOffset;
    return {
      approved: true,
      regime: "RANGING",
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
      limitEntryPrice: rounded(limitEntryPrice),
      orderType: "LIMIT",
      limitTtlCandles: 2,
    };
  }

  if (
    context?.setup === "BREAKOUT_RETEST" ||
    (!context && regime === "BREAKOUT")
  ) {
    const boundary = side === "LONG" ? resistance : support;
    if (finitePositive(boundary)) {
      const extension = side === "LONG"
        ? entryPrice - boundary
        : boundary - entryPrice;
      if (extension > atr * 0.75) {
        return {
          approved: false,
          reason: "BREAKOUT_ENTRY_OVEREXTENDED",
          regime,
          strategy: "BREAKOUT_RETEST",
          maxHoldingCandles: 5,
          breakEvenAtR: 0.8,
        };
      }
    }
    const structuralStop = finitePositive(boundary)
      ? side === "LONG" ? boundary - atr * 0.5 : boundary + atr * 0.5
      : side === "LONG" ? entryPrice - atr * 1.2 : entryPrice + atr * 1.2;
    const minimumRisk = atr * 1.0;
    const rawRisk = Math.abs(entryPrice - structuralStop);
    const risk = Math.max(minimumRisk, rawRisk);
    if (risk > atr * 2.5) {
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
    const pullbackOffset = Math.min(atr * 0.25, entryPrice * 0.003);
    const limitEntryPrice = side === "LONG" ? entryPrice - pullbackOffset : entryPrice + pullbackOffset;
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
      trailingAtrMultiple: Number((2.5 * policy.executionCostMultiplier).toFixed(2)),
      atr,
      timeframeMs: market.timeframeMs,
      limitEntryPrice: rounded(limitEntryPrice),
      orderType: "LIMIT",
      limitTtlCandles: 2,
    };
  }

  // Anti-chasing protection for trend pullbacks: prevent entering when price is overextended from EMA20
  if (finitePositive(market.ema20) && finitePositive(atr)) {
    const isMomentumExpansion =
      Boolean(market.breakout) ||
      (finitePositive(market.volumeRatio) && market.volumeRatio >= 1.35) ||
      market.marketStructure === "HH_HL";
    const extensionLimit = atr * (isMomentumExpansion ? 3.5 : 2.5);
    if (side === "LONG" && entryPrice > market.ema20 + extensionLimit) {
      return {
        approved: false,
        reason: "PRICE_EXTENDED_FROM_EMA20",
        regime,
        strategy: "TREND_PULLBACK",
        maxHoldingCandles: 20,
        breakEvenAtR: 1,
      };
    }
    if (side === "SHORT" && entryPrice < market.ema20 - extensionLimit) {
      return {
        approved: false,
        reason: "PRICE_EXTENDED_FROM_EMA20",
        regime,
        strategy: "TREND_PULLBACK",
        maxHoldingCandles: 20,
        breakEvenAtR: 1,
      };
    }
  }

  const structuralCandidates = side === "LONG"
    ? [
        finitePositive(support) ? support - atr * 0.6 : undefined,
        finitePositive(market.ema20) ? market.ema20 - atr * 0.5 : undefined,
        finitePositive(market.ema50) ? market.ema50 - atr * 0.5 : undefined,
      ].filter((value): value is number => finitePositive(value) && value < entryPrice)
    : [
        finitePositive(resistance) ? resistance + atr * 0.6 : undefined,
        finitePositive(market.ema20) ? market.ema20 + atr * 0.5 : undefined,
        finitePositive(market.ema50) ? market.ema50 + atr * 0.5 : undefined,
      ].filter((value): value is number => finitePositive(value) && value > entryPrice);
  const structuralStop = structuralCandidates.length > 0
    ? side === "LONG" ? Math.max(...structuralCandidates) : Math.min(...structuralCandidates)
    : side === "LONG" ? entryPrice - atr * 1.2 : entryPrice + atr * 1.2;
  const rawRisk = Math.abs(entryPrice - structuralStop);
  const structuralRiskAtr = rawRisk / atr;
  const maximumStructuralRiskAtr = regime === "HIGH_VOLATILITY" ? 2.5 : 3.5;
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
  const minRiskAtr = policy.liquidityClass === 'LONG_TAIL' ? 1.6 : policy.liquidityClass === 'LIQUID_ALT' ? 1.2 : 1.0;
  const risk = Math.max(atr * minRiskAtr, rawRisk);
  const stopLoss = side === "LONG" ? entryPrice - risk : entryPrice + risk;
  const targetMultiple = Math.max(1.8, input.configuredRiskRewardRatio);
  const cost = entryPrice * costPct;
  const targetDistance =
    risk * targetMultiple +
    cost * (1 + targetMultiple);
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
  const minRR = Math.min(input.configuredRiskRewardRatio, policy.minStructuralRiskReward);
  if (rr < minRR - 1e-6) {
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
  const pullbackOffset = Math.min(atr * 0.25, entryPrice * 0.003);
  const limitEntryPrice = side === "LONG" ? entryPrice - pullbackOffset : entryPrice + pullbackOffset;
  return {
    approved: true,
    regime,
    strategy: regime === "HIGH_VOLATILITY" ? "VOLATILITY_CONTROL" : "TREND_PULLBACK",
    stopLoss: rounded(stopLoss),
    takeProfit: rounded(takeProfit),
    rewardToRisk: rounded(rr),
    maxHoldingCandles: regime === "HIGH_VOLATILITY" ? 8 : 20,
    breakEvenAtR: 1,
    trailingAtrMultiple:
      regime === "HIGH_VOLATILITY"
        ? Number((3 * policy.executionCostMultiplier).toFixed(2))
        : Number((2.5 * policy.executionCostMultiplier).toFixed(2)),
    atr,
    timeframeMs: market.timeframeMs,
    structuralRiskAtr: rounded(structuralRiskAtr),
    limitEntryPrice: rounded(limitEntryPrice),
    orderType: "LIMIT",
    limitTtlCandles: 2,
  };
}

export function buildAdaptiveTradePlan(input: Parameters<typeof _buildAdaptiveTradePlan>[0]): TradePlan {
  const proactive = input.market.proactive;
  if (proactive) {
    const thesis = proactive.thesis;
    const entry = thesis.entryZone;
    const regime = resolveTradePlanRegime(input.decision, input.market);
    const strategy: TradePlanStrategy = thesis.setup === 'SQUEEZE_PROBE' ? 'SQUEEZE_BREAKOUT'
      : thesis.setup === 'NO_TRADE' ? 'LEGACY_FALLBACK' : thesis.setup;
    if (!entry || thesis.stopLoss === null || !['PROBE_READY', 'CONFIRMED'].includes(thesis.state)) {
      return { approved: false, reason: 'THESIS_NOT_EXECUTABLE', regime, strategy, maxHoldingCandles: 8, breakEvenAtR: 1 };
    }
    const reject = (reason: string): TradePlan => ({ approved: false, reason, regime, strategy, maxHoldingCandles: 8, breakEvenAtR: 1, targets: thesis.targets });
    const snapshot = proactive.snapshot;
    const structure = snapshot.structure.coverage === 'AVAILABLE' ? snapshot.structure : undefined;
    const volatility = snapshot.volatility.coverage === 'AVAILABLE' ? snapshot.volatility : undefined;
    const boundary = structure?.rangeBoundaries;
    if (thesis.setup === 'RANGE_REVERSAL') {
      if (!boundary || !Number.isFinite(boundary.upper) || !Number.isFinite(boundary.lower) || boundary.upper <= boundary.lower) {
        return reject('THESIS_RANGE_BOUNDARY_REQUIRED');
      }
      if (input.entryPrice < boundary.lower || input.entryPrice > boundary.upper) {
        return reject('THESIS_RANGE_DIRECTION_INVALID');
      }
      const location = (input.entryPrice - boundary.lower) / (boundary.upper - boundary.lower);
      if (location > 0.3 && location < 0.7) return reject('RANGE_MIDPOINT_ENTRY_BLOCKED');
      if (thesis.direction === 'LONG' ? location > 0.3 : location < 0.7) return reject('THESIS_RANGE_DIRECTION_INVALID');
    }
    const fresh = (field: { freshness: string; sourceTimestamp: string; freshnessThresholdMs: number }) => field.freshness === 'FRESH' &&
      Date.parse(snapshot.sourceDataCutoff) - Date.parse(field.sourceTimestamp) <= field.freshnessThresholdMs;
    const sweep = structure?.liquiditySweep.coverage === 'AVAILABLE' ? structure.liquiditySweep : undefined;
    const alignedSweep = sweep && fresh(sweep) && sweep.detected && sweep.reclaimed && sweep.sweepZone &&
      sweep.direction === (thesis.direction === 'LONG' ? 'BULLISH_SWEEP' : 'BEARISH_SWEEP');
    if (thesis.setup === 'LIQUIDITY_SWEEP_REVERSAL' && !alignedSweep) return reject('THESIS_SWEEP_EVIDENCE_REQUIRED');
    if (thesis.setup === 'SQUEEZE_PROBE') {
      if (!volatility || !fresh(volatility) || volatility.squeezeState !== 'SQUEEZING' || volatility.squeezeDurationCandles < 3) return reject('THESIS_COMPRESSION_REQUIRED');
      const structureAligned = structure?.invalidationCandidates.some((candidate) => candidate.direction === thesis.direction &&
        (thesis.direction === 'LONG' ? candidate.price < entry.lower : candidate.price > entry.upper));
      const participation = snapshot.participation.coverage === 'AVAILABLE' ? snapshot.participation : undefined;
      const book = participation?.orderBook.coverage === 'AVAILABLE' ? participation.orderBook : undefined;
      const participationAligned = book && fresh(book) && (thesis.direction === 'LONG' ? book.imbalance >= 0.2 : book.imbalance <= -0.2);
      const derivatives = snapshot.derivatives.coverage === 'AVAILABLE' && snapshot.derivatives.derivativesImbalance.coverage === 'AVAILABLE' ? snapshot.derivatives.derivativesImbalance : undefined;
      const derivativesAligned = derivatives && fresh(derivatives) && derivatives.squeezeProbability >= 65 &&
        derivatives.squeezeDirection === (thesis.direction === 'LONG' ? 'SHORT_SQUEEZE' : 'LONG_SQUEEZE');
      if ([structureAligned, participationAligned, derivativesAligned].filter(Boolean).length < 2) return reject('THESIS_DIRECTIONAL_EVIDENCE_REQUIRED');
    }
    // Native protection currently implements one full-position TP. Preserve and reject unsupported fractions.
    if (thesis.targets.length !== 1 || thesis.targets[0]?.fraction !== 1) return reject('THESIS_MULTI_TARGET_EXECUTION_UNSUPPORTED');
    const timeframeMs = input.market.timeframeMs ?? 15 * 60_000;
    const isGtc = thesis.setup === 'RANGE_REVERSAL';
    const timeInForce = isGtc ? 'GTC' : 'IOC';
    const limitTtlCandles = isGtc ? 2 : 1;
    const expiresAt = new Date(Math.min(Date.parse(thesis.expiresAt), Date.parse(snapshot.sourceDataCutoff) + timeframeMs * limitTtlCandles)).toISOString();
    const probeSizePct = 0.25;
    return {
      approved: true, regime, strategy, stopLoss: thesis.stopLoss,
      takeProfit: thesis.targets[0].price, targets: thesis.targets,
      maxHoldingCandles: 8, breakEvenAtR: 1, atr: input.market.atr,
      timeframeMs: input.market.timeframeMs,
      timeInForce, expiresAt,
      orderType: 'LIMIT', limitEntryPrice: Math.min(entry.upper, Math.max(entry.lower, input.entryPrice)), limitTtlCandles,
      stagedEntry: { stage: thesis.state === 'CONFIRMED' ? 'CONFIRMED' : 'PROBE', thesisId: proactive.thesisId,
        setup: thesis.setup, trigger: thesis.trigger, sourceDataCutoff: proactive.snapshot.sourceDataCutoff,
        probeSizePct, confirmationSizePct: 1 - probeSizePct, combinedRiskLimitPct: 0.005 },
    };
  }

  const plan = _buildAdaptiveTradePlan(input);
  if (!plan.approved) return plan;

  // 1. Fee Friction & Net Economic Edge Audit
  // Ensure potential gross profit target is at least 3x round-trip cost to prevent fee drag
  const entry = input.entryPrice;
  const costPct = input.roundTripCostPct ?? (plan.orderType === "LIMIT" ? 0.0004 : 0.001);
  plan.estimatedRoundTripCostPct = costPct;

  if (finitePositive(plan.takeProfit) && finitePositive(entry)) {
    const grossRewardDistance = Math.abs(plan.takeProfit - entry);
    const grossRewardPct = grossRewardDistance / entry;
    const roundTripCost = entry * costPct;
    const netRewardDistance = Math.max(0, grossRewardDistance - roundTripCost);
    const expectedNetRewardPct = netRewardDistance / entry;

    plan.grossRewardPct = Number((grossRewardPct * 100).toFixed(4));
    plan.expectedNetRewardPct = Number((expectedNetRewardPct * 100).toFixed(4));

    // Hard Gate: Gross reward must be at least 2.5x total fees AND at least 0.5% net expected return
    const minRequiredGrossDistance = entry * costPct * 2.5;
    const minNetEdgePct = 0.004; // 0.4% minimum net edge after costs
    if (grossRewardDistance < minRequiredGrossDistance || expectedNetRewardPct < minNetEdgePct) {
      return {
        ...plan,
        approved: false,
        reason: "INSUFFICIENT_NET_EDGE_AFTER_FEES",
      };
    }

    // 2. Multi-Stage Take Profit Setup:
    // TP1: 50% target at intermediate level (mid-way to full TP or EMA20), locking in profit and pulling SL to BE
    const tp1Distance = grossRewardDistance * 0.5;
    plan.tp1Price = rounded(input.side === "LONG" ? entry + tp1Distance : entry - tp1Distance);
    plan.tp2Price = plan.takeProfit;
  }

  if (input.useLimitlessTrailing) {
    plan.takeProfit = undefined;
  }


  plan.riskTier = input.executionContext?.riskTier ?? input.market?.executionContext?.riskTier ?? plan.riskTier;
  if (plan.approved && plan.orderType === "LIMIT") {
    const context = input.executionContext ?? input.market.executionContext ?? input.decision.executionContext;
    const strategyKey =
      (input.decision as { strategyKey?: string })?.strategyKey ??
      (input.decision as { metadata?: { strategyKey?: string } })?.metadata?.strategyKey ??
      (/\[momentum-scalp\]/i.test(input.decision.reasoning ?? "") ? "momentum-scalp" : undefined);
    const policy = selectEntryOrderPolicy({
      setup: context?.setup ?? plan.strategy,
      strategyKey,
      side: input.side === "LONG" ? "BUY" : "SELL",
      bid: input.market.currentPrice ?? input.entryPrice,
      ask: input.market.currentPrice ?? input.entryPrice,
      structuralPrice: plan.limitEntryPrice,
      tickSize: input.market.tickSize,
    });
    plan.timeInForce = policy.timeInForce;
    plan.limitTtlCandles = policy.expiryCandles;
    plan.limitEntryPrice = policy.limitPrice;
    plan.limitPrice = policy.limitPrice;
  }
  return plan;
}
