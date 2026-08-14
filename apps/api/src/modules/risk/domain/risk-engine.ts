import type {
  LastTradeRecord,
  RiskAccount,
  RiskEvaluation,
  RiskInput,
  RiskLimits,
  RiskPosition,
} from "./risk-engine.types";
import { RISK_ENGINE_CONSTANTS } from "./risk-engine.constants";
import { buildAdaptiveTradePlan } from "./trade-plan-engine";

export type {
  LastTradeRecord,
  RiskAccount,
  RiskEvaluation,
  RiskInput,
  RiskLimits,
  RiskPosition,
};

const finitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));
const rounded = (
  value: number,
  digits: number = RISK_ENGINE_CONSTANTS.DEFAULT_PRECISION_DIGITS,
): number => Number(value.toFixed(digits));

export function maxStopLossRoeForStrategy(
  limits: Pick<RiskLimits, "maxStopLossRoe" | "rangeScalpRoeMultiplier">,
  strategy?: string,
  timeframeMs?: number,
): number {
  const horizonFactor = timeframeMs !== undefined && timeframeMs >= 4 * 3_600_000
    ? 0.5
    : timeframeMs !== undefined && timeframeMs >= 3_600_000
      ? 0.75
      : 1;
  const rangeFactor = strategy === "RANGE_REVERSAL" || strategy === "MOMENTUM_SCALP"
    ? timeframeMs !== undefined && timeframeMs > 15 * 60_000
      ? 1
      : timeframeMs !== undefined && timeframeMs > 5 * 60_000
        ? Math.min(1.5, limits.rangeScalpRoeMultiplier)
        : Math.max(1, limits.rangeScalpRoeMultiplier)
    : 1;
  return limits.maxStopLossRoe * horizonFactor * rangeFactor;
}

export function estimatedLiquidationLeverageLimit(
  stopDistancePct: number,
  minimumBufferPct: number,
): number {
  const protectedDistance = Math.max(0, stopDistancePct) + Math.max(0, minimumBufferPct);
  return Math.max(1, Math.floor(1 / Math.max(protectedDistance, Number.EPSILON)));
}

export function calculateDrawdown(equity: number, peakEquity: number): number {
  return peakEquity > 0 ? clamp((peakEquity - equity) / peakEquity, 0, 1) : 1;
}

export function calculateProtectivePrices(
  side: "LONG" | "SHORT",
  entryPrice: number,
  stopLossPct: number,
  riskRewardRatio: number,
): { stopLoss: number; takeProfit: number } {
  const stopDistance = entryPrice * stopLossPct;
  const stopLoss = side === "LONG"
    ? rounded(entryPrice - stopDistance)
    : rounded(entryPrice + stopDistance);
  const takeProfit = side === "LONG"
    ? rounded(entryPrice + stopDistance * riskRewardRatio)
    : rounded(entryPrice - stopDistance * riskRewardRatio);
  return { stopLoss, takeProfit };
}

export function calculatePositionSize(
  balance: number,
  riskPerTrade: number,
  entryPrice: number,
  stopLoss: number,
  estimatedRoundTripCostPct = 0,
): number {
  const distance = Math.abs(entryPrice - stopLoss);
  const costPerUnit = entryPrice * Math.max(0, estimatedRoundTripCostPct);
  const lossPerUnit = distance + costPerUnit;
  return lossPerUnit > 0
    ? rounded(
        (balance * riskPerTrade) / lossPerUnit,
        RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS,
      )
    : 0;
}

export function calculateRiskScore(
  volatility: number,
  leverage: number,
  exposurePct: number,
  drawdown: number,
  limits: Pick<
    RiskLimits,
    "highVolatility" | "maxLeverage" | "maxExposure" | "maxDrawdown"
  >,
): number {
  const safeVol = Number.isFinite(volatility) ? Math.max(0, volatility) : 0;
  const safeLev = Number.isFinite(leverage) ? Math.max(1, leverage) : 1;
  const safeExp = Number.isFinite(exposurePct) ? Math.max(0, exposurePct) : 0;
  const safeDd = Number.isFinite(drawdown) ? Math.max(0, drawdown) : 0;

  const highVol = limits.highVolatility > 0 ? limits.highVolatility : 0.05;
  const maxLev = limits.maxLeverage > 0 ? limits.maxLeverage : 50;
  const maxExp = limits.maxExposure > 0 ? limits.maxExposure : 0.4;
  const maxDd = limits.maxDrawdown > 0 ? limits.maxDrawdown : 0.15;

  const volatilityRisk = clamp(safeVol / highVol, 0, 2) / 2;
  const leverageRisk = clamp(safeLev / maxLev, 0, 1);
  const exposureRisk = clamp(safeExp / maxExp, 0, 1);
  const drawdownRisk = clamp(safeDd / maxDd, 0, 1);
  const score = rounded(
    (volatilityRisk + leverageRisk + exposureRisk + drawdownRisk) *
      RISK_ENGINE_CONSTANTS.RISK_SCORE_CATEGORY_WEIGHT,
    2,
  );
  return Number.isFinite(score) ? score : 50;
}

export function evaluateRisk(
  input: RiskInput,
  limits: RiskLimits,
): RiskEvaluation {
  const { account, marketData, decision } = input;
  const currentExposure = input.currentPositions.reduce(
    (sum, position) => sum + Math.abs(position.size * position.markPrice),
    0,
  );
  const baseExposurePct =
    account.equity > 0 ? currentExposure / account.equity : 1;
  const drawdownPct = calculateDrawdown(account.equity, account.peakEquity);
  const reject = (reason: string, leverage = 1): RiskEvaluation => ({
    approved: false,
    reason,
    riskScore: calculateRiskScore(
      Number.isFinite(marketData.volatility)
        ? marketData.volatility
        : limits.abnormalVolatility,
      leverage,
      baseExposurePct,
      drawdownPct,
      limits,
    ),
    exposurePct: rounded(baseExposurePct, 6),
    drawdownPct: rounded(drawdownPct, 6),
  });

  if (
    ![
      account.balance,
      account.equity,
      account.peakEquity,
      marketData.price,
    ].every(finitePositive) ||
    !Number.isFinite(marketData.volatility) ||
    marketData.volatility < 0
  )
    return reject("MISSING_OR_INVALID_RISK_DATA");
  if (decision.decision === "WAIT") return reject("NO_ACTIONABLE_DECISION");
  if (decision.confidence < limits.minimumConfidence)
    return reject("CONFIDENCE_BELOW_THRESHOLD");
  if (decision.conflictLevel === "HIGH") return reject("HIGH_SIGNAL_CONFLICT");
  if (marketData.volatility >= limits.abnormalVolatility)
    return reject("ABNORMAL_VOLATILITY");
  if (drawdownPct >= limits.maxDrawdown) return reject("MAX_DRAWDOWN_EXCEEDED");

  const sameSymbolPosition = input.currentPositions.find(
    (position) => position.symbol === input.symbol,
  );
  if (sameSymbolPosition) {
    const existingDirection = sameSymbolPosition.size >= 0 ? "LONG" : "SHORT";
    const isSameDirection = existingDirection === decision.decision;
    // Execution intentionally does not pyramid. Reject at the authoritative
    // risk stage as well, so a candidate cannot be recorded as risk-approved
    // and then encounter the same-direction guard only during submission.
    if (isSameDirection) return reject("PYRAMIDING_NOT_ALLOWED");
  }

  // A reversal replaces the position in the same symbol, so it must not consume an
  // additional slot or be counted twice in projected exposure.
  const retainedPositions = input.currentPositions.filter(
    (position) => position.symbol !== input.symbol,
  );
  if (retainedPositions.length >= limits.maxPositions)
    return reject("MAX_OPEN_POSITIONS_EXCEEDED");
  const cooldownWindow = input.lastTrades?.find(
    (trade) =>
      trade.symbol === input.symbol && trade.direction === decision.decision &&
      (input.now ?? new Date()).getTime() - trade.createdAt.getTime() <
        limits.cooldownMs,
  );
  if (
    (input.lastTradeAt &&
      (input.now ?? new Date()).getTime() - input.lastTradeAt.getTime() <
        limits.cooldownMs) ||
    cooldownWindow
  )
    return reject("TRADE_COOLDOWN_ACTIVE");

  const plan = buildAdaptiveTradePlan({
    side: decision.decision,
    entryPrice: marketData.price,
    decision,
    market: marketData.tradePlanContext ?? {},
    configuredStopLossPct: limits.stopLossPct,
    configuredRiskRewardRatio: limits.riskRewardRatio,
  });
  if (!plan.approved || !plan.stopLoss || !plan.takeProfit)
    return {
      ...reject(plan.reason ?? "TRADE_PLAN_REJECTED"),
      tradePlan: plan,
    };
  const { stopLoss, takeProfit } = plan;
  const rewardToRisk = Math.abs(takeProfit - marketData.price) / Math.abs(marketData.price - stopLoss);
  const requiredRiskReward = plan.strategy === "RANGE_REVERSAL"
    ? Math.min(limits.riskRewardRatio, 1.25)
    : plan.strategy === "MOMENTUM_SCALP"
      ? Math.min(limits.riskRewardRatio, 1.25)
    : plan.strategy === "BREAKOUT_RETEST"
      ? 1.5
      : limits.riskRewardRatio;
  if (rewardToRisk < requiredRiskReward - 1e-6)
    return reject("RISK_REWARD_NOT_MET");
  let positionSize = calculatePositionSize(
    account.balance,
    limits.riskPerTrade,
    marketData.price,
    stopLoss,
    limits.estimatedRoundTripCostPct,
  );
  const highVolatility = marketData.volatility >= limits.highVolatility;
  if (highVolatility)
    positionSize = rounded(
      positionSize * limits.highVolatilitySizeFactor,
      RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS,
    );
  const retainedExposure = retainedPositions.reduce(
    (sum, position) => sum + Math.abs(position.size * position.markPrice),
    0,
  );
  const availableExposure = Math.max(
    0,
    account.equity * limits.maxExposure - retainedExposure,
  );
  positionSize = Math.min(
    positionSize,
    rounded(
      availableExposure / marketData.price,
      RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS,
    ),
  );
  if (!finitePositive(positionSize))
    return reject("MAX_PORTFOLIO_EXPOSURE_EXCEEDED");

  const stopDistancePct = Math.abs(marketData.price - stopLoss) / marketData.price;
  const lossPctOfNotional = stopDistancePct + limits.estimatedRoundTripCostPct;
  const effectiveMaxStopLossRoe = maxStopLossRoeForStrategy(
    limits,
    plan.strategy,
    plan.timeframeMs,
  );
  const roeLeverageLimit = Math.floor(
    effectiveMaxStopLossRoe / Math.max(lossPctOfNotional, Number.EPSILON),
  );
  if (roeLeverageLimit < 1) return reject("STOP_LOSS_ROE_EXCEEDS_LIMIT");
  const liquidationLeverageLimit = estimatedLiquidationLeverageLimit(
    stopDistancePct,
    limits.minLiquidationBufferPct,
  );
  const volatilityLeverageLimit = highVolatility
    ? Math.max(1, Math.floor(limits.maxLeverage / 2))
    : limits.maxLeverage;
  const maximumSafeLeverage = Math.max(
    1,
    Math.min(
      limits.maxLeverage,
      volatilityLeverageLimit,
      roeLeverageLimit,
      liquidationLeverageLimit,
    ),
  );

  const availableBalance = account.availableBalance ?? account.balance;
  if (!finitePositive(availableBalance))
    return reject("INSUFFICIENT_AVAILABLE_MARGIN", maximumSafeLeverage);
  const usableMargin =
    availableBalance * RISK_ENGINE_CONSTANTS.AVAILABLE_MARGIN_SAFETY_FACTOR;
  const requestedNotional = positionSize * marketData.price;
  const requiredLeverage = Math.max(
    1,
    Math.ceil(requestedNotional / usableMargin),
  );
  const leverage = Math.min(requiredLeverage, maximumSafeLeverage);
  if (requiredLeverage > maximumSafeLeverage) {
    positionSize = Math.floor(
      ((usableMargin * maximumSafeLeverage) / marketData.price) *
        10 ** RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS,
    ) / 10 ** RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS;
    if (!finitePositive(positionSize))
      return reject("INSUFFICIENT_AVAILABLE_MARGIN", maximumSafeLeverage);
  }

  const projectedExposure = retainedExposure + positionSize * marketData.price;
  const exposurePct = projectedExposure / account.equity;
  if (exposurePct > limits.maxExposure + RISK_ENGINE_CONSTANTS.EXPOSURE_TOLERANCE_EPSILON)
    return reject("MAX_PORTFOLIO_EXPOSURE_EXCEEDED", leverage);

  const plannedLoss = positionSize * marketData.price * lossPctOfNotional;
  const plannedEquityRiskPct = plannedLoss / account.equity;
  const plannedMarginRoe = plannedLoss / ((positionSize * marketData.price) / leverage);
  if (plannedEquityRiskPct > limits.riskPerTrade + 1e-8)
    return reject("RISK_PER_TRADE_EXCEEDED", leverage);
  if (plannedMarginRoe > effectiveMaxStopLossRoe + 1e-8)
    return reject("STOP_LOSS_ROE_EXCEEDS_LIMIT", leverage);

  return {
    approved: true,
    positionSize,
    leverage,
    stopLoss,
    takeProfit,
    riskScore: calculateRiskScore(
      marketData.volatility,
      leverage,
      exposurePct,
      drawdownPct,
      limits,
    ),
    exposurePct: rounded(exposurePct, 6),
    drawdownPct: rounded(drawdownPct, 6),
    plannedLoss: rounded(plannedLoss, 8),
    plannedEquityRiskPct: rounded(plannedEquityRiskPct, 8),
    plannedMarginRoe: rounded(plannedMarginRoe, 8),
    tradePlan: plan,
  };
}
