import { validateTradeThesis } from '../../agents/domain/trade-thesis-validator';
import { thesisTriggersSatisfied } from './thesis-execution';
import { validateSetupLocation } from '../../pipeline/domain/execution-context';
import type {
  DrawdownRequestedAction,
  DrawdownRiskPolicy,
  LastTradeRecord,
  RiskAccount,
  RiskEvaluation,
  RiskInput,
  RiskLimits,
  RiskPosition,
} from "./risk-engine.types";
import { RISK_ENGINE_CONSTANTS } from "./risk-engine.constants";
import { buildAdaptiveTradePlan } from "./trade-plan-engine";
import { adaptiveTradingPolicy } from "../../pipeline/domain/adaptive-trading-policy";

export type {
  DrawdownRequestedAction,
  DrawdownRiskPolicy,
  LastTradeRecord,
  RiskAccount,
  RiskEvaluation,
  RiskInput,
  RiskLimits,
  RiskPosition,
};

const DEFAULT_DRAWDOWN_REDUCED_PCT = 0.08;
const DEFAULT_DRAWDOWN_DIAGNOSTIC_PROBE_PCT = 0.12;
const DEFAULT_DRAWDOWN_HALT_PCT = 0.15;

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

function drawdownThresholds(limits?: Pick<
  RiskLimits,
  "drawdownReducedPct" | "drawdownDiagnosticProbePct" | "drawdownHaltPct"
>) {
  const reduced = finitePositive(limits?.drawdownReducedPct ?? Number.NaN)
    ? limits!.drawdownReducedPct!
    : DEFAULT_DRAWDOWN_REDUCED_PCT;
  const diagnostic = finitePositive(limits?.drawdownDiagnosticProbePct ?? Number.NaN)
    ? limits!.drawdownDiagnosticProbePct!
    : DEFAULT_DRAWDOWN_DIAGNOSTIC_PROBE_PCT;
  const halt = finitePositive(limits?.drawdownHaltPct ?? Number.NaN)
    ? limits!.drawdownHaltPct!
    : DEFAULT_DRAWDOWN_HALT_PCT;
  return { reduced, diagnostic, halt };
}

/**
 * Applies only to orders that increase exposure. Reduce-only/protective exits
 * must continue to work even while the new-entry circuit breaker is halted.
 */
export function resolveDrawdownRiskPolicy(
  drawdownPct: number,
  requestedAction: DrawdownRequestedAction,
  limits?: Pick<
    RiskLimits,
    "maxDrawdown" | "drawdownReducedPct" | "drawdownDiagnosticProbePct" | "drawdownHaltPct"
  >,
): DrawdownRiskPolicy {
  if (requestedAction === "PROTECTIVE_EXIT" || requestedAction === "REDUCE_ONLY") {
    return { tier: "NORMAL", maxSizeFactor: 1 };
  }

  const drawdown = Number.isFinite(drawdownPct)
    ? clamp(drawdownPct, 0, 1)
    : 1;
  const thresholds = drawdownThresholds(limits);
  if (drawdown >= thresholds.halt) return { tier: "HALTED", maxSizeFactor: 0 };
  if (drawdown >= thresholds.diagnostic) {
    return { tier: "DIAGNOSTIC_PROBE", maxSizeFactor: 0.1 };
  }
  if (drawdown >= thresholds.reduced) return { tier: "REDUCED", maxSizeFactor: 0.5 };
  return { tier: "NORMAL", maxSizeFactor: 1 };
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
  const drawdownPolicy = resolveDrawdownRiskPolicy(
    drawdownPct,
    "ENTER",
    limits,
  );
  if (drawdownPolicy.tier === "HALTED") return reject("MAX_DRAWDOWN_EXCEEDED");

  const context =
    input.executionContext ??
    marketData.tradePlanContext?.executionContext ??
    decision.executionContext;

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
  const consecutiveLosses = (input.recentClosedTrades ?? [])
    .findIndex((trade) => trade.netPnl >= 0);
  const lossCount = consecutiveLosses === -1
    ? (input.recentClosedTrades?.length ?? 0)
    : consecutiveLosses;
  const latestLoss = input.recentClosedTrades?.[0];
  const maxConsecutiveLosses = Math.max(
    1,
    limits.maxConsecutiveLosses ?? 3,
  );
  const lossStreakPauseMs = Math.max(
    limits.lossReentryCooldownMs ?? 15 * 60_000,
    limits.lossStreakPauseMs ?? 6 * 60 * 60_000,
  );
  if (
    lossCount >= maxConsecutiveLosses &&
    latestLoss &&
    (input.now ?? new Date()).getTime() - latestLoss.closedAt.getTime() <
      lossStreakPauseMs
  ) return reject("LOSS_STREAK_CIRCUIT_BREAKER_ACTIVE");
  const policy = adaptiveTradingPolicy({
    symbol: input.symbol,
    regime: decision.regime?.type,
  });
  const cooldownTierMultiplier =
    policy.liquidityClass === "MAJOR" ? 1 : policy.liquidityClass === "LIQUID_ALT" ? 4 : 16;
  const baseLossCooldownMs =
    (limits.lossReentryCooldownMs ?? 15 * 60_000) * cooldownTierMultiplier;
  const lossCooldownMs = baseLossCooldownMs * Math.min(
    4,
    2 ** Math.max(0, lossCount - 1),
  );
  let isReversalTransitionProbe = false;
  if (
    lossCount > 0 &&
    latestLoss &&
    (input.now ?? new Date()).getTime() - latestLoss.closedAt.getTime() <
      lossCooldownMs
  ) {
    const isOppositeDirection =
      Boolean(latestLoss.direction) &&
      latestLoss.direction !== decision.decision;

    if (isOppositeDirection) {
      const isTransitionProbe =
        context?.setup === "TRANSITION_PROBE" ||
        decision.thesis?.setup === "TRANSITION_PROBE";
      const isTriggerConfirmed =
        context?.triggerConfirmed === true ||
        decision.thesis?.trigger?.confirmed === true;
      const latestCutoff = latestLoss.sourceDataCutoff;
      const currentCutoff = context?.sourceDataCutoff
        ? String(context.sourceDataCutoff)
        : decision.thesis?.trigger?.observedAt;
      const differentCutoff =
        !latestCutoff || !currentCutoff || latestCutoff !== currentCutoff;

      if (!isTransitionProbe || !isTriggerConfirmed || !differentCutoff) {
        return reject("LOSS_REVERSAL_TRIGGER_REQUIRED");
      }
      isReversalTransitionProbe = true;
    } else {
      return reject("LOSS_REENTRY_COOLDOWN_ACTIVE");
    }
  }

  if (context) {
    const [firstLocationReason] = validateSetupLocation(context, decision.decision);
    if (firstLocationReason) {
      return reject(firstLocationReason);
    }
  }

  const proactive = marketData.tradePlanContext?.proactive;
  if (proactive) {
    if (!['OBSERVE', 'SHADOW', 'DEMO'].includes(proactive.mode)) return reject('PROACTIVE_MODE_INVALID');
    if (!['PROBE_READY', 'CONFIRMED'].includes(proactive.thesis.state) || proactive.thesis.direction !== decision.decision) return reject('THESIS_NOT_EXECUTABLE');
    if (!Number.isFinite(proactive.sizeFactor) || proactive.sizeFactor <= 0 || proactive.sizeFactor > 1) return reject('THESIS_SIZE_FACTOR_INVALID');
    const snapshot = structuredClone(proactive.snapshot);
    if (snapshot.execution.coverage === 'AVAILABLE') snapshot.execution.currentPrice = marketData.price;
    const validation = validateTradeThesis(proactive.thesis, snapshot, { now: input.now ?? new Date() });
    if (!validation.valid) return reject(validation.reasonCodes[0] ?? 'THESIS_INVALID');
  }
  if (
    drawdownPolicy.tier === "DIAGNOSTIC_PROBE" &&
    (!proactive ||
      !["DEMO", "SHADOW"].includes(proactive.mode) ||
      proactive.thesis.state !== "PROBE_READY")
  ) return reject("DRAWDOWN_DIAGNOSTIC_PROBE_REQUIRED");
  const sameSymbolPosition = input.currentPositions.find(
    (position) => position.symbol === input.symbol,
  );
  // Determine whether this is a legitimate staged-entry confirmation add
  // (probe already placed; this is the CONFIRMED add at the same direction).
  const storedProbe = sameSymbolPosition?.stagedEntry;
  const isStagedEntry = Boolean(proactive && proactive.thesis.state === 'CONFIRMED' &&
    storedProbe?.stage === 'PROBE' && storedProbe.thesisId === (proactive.parentThesisId ?? proactive.thesisId) &&
    storedProbe.setup === proactive.thesis.setup &&
    Date.parse(storedProbe.sourceDataCutoff) < Date.parse(proactive.snapshot.sourceDataCutoff));
  if (proactive?.thesis.state === 'CONFIRMED' && !isStagedEntry) return reject('STORED_PROBE_REQUIRED');
  if (isStagedEntry && storedProbe && !thesisTriggersSatisfied(storedProbe.trigger, proactive!.snapshot, marketData.price)) return reject('THESIS_TRIGGER_REQUIRED');

  if (sameSymbolPosition) {
    const existingDirection = sameSymbolPosition.side ??
      (sameSymbolPosition.size >= 0 ? "LONG" : "SHORT");
    const isSameDirection = existingDirection === decision.decision;
    // Execution intentionally does not pyramid. Reject at the authoritative
    // risk stage as well, so a candidate cannot be recorded as risk-approved
    // and then encounter the same-direction guard only during submission.
    if (isSameDirection && !isStagedEntry) {
      return reject("PYRAMIDING_NOT_ALLOWED");
    }
  }

  // A reversal replaces the position in the same symbol, so it must not consume an
  // additional slot or be counted twice in projected exposure.
  // For a staged-entry confirmation add, also exclude the existing same-direction position
  // from slot / direction counting — it is being augmented, not added as a new position.
  const retainedPositions = input.currentPositions.filter((position) => {
    if (position.symbol !== input.symbol) return true;
    const posDir = position.side ?? (position.size >= 0 ? "LONG" : "SHORT");
    // Exclude existing same-direction position when doing a staged confirmation add
    if (isStagedEntry && posDir === decision.decision) return false;
    // Keep same-symbol position only if it's the same direction (i.e. a reversal scenario)
    return posDir === decision.decision;
  });
  if (retainedPositions.length >= limits.maxPositions)
    return reject("MAX_OPEN_POSITIONS_EXCEEDED");
  const sameDirectionPositions = retainedPositions.filter(
    (position) =>
      (position.side ?? (position.size >= 0 ? "LONG" : "SHORT")) ===
      decision.decision,
  );
  if (
    sameDirectionPositions.length >=
      (limits.maxSameDirectionPositions ?? 1)
  ) return reject("MAX_SAME_DIRECTION_POSITIONS_EXCEEDED");

  const plan = buildAdaptiveTradePlan({
    symbol: input.symbol,
    side: decision.decision,
    entryPrice: marketData.price,
    decision,
    market: {
      ...marketData.tradePlanContext,
      ...(context ? { executionContext: context } : {}),
    },
    configuredStopLossPct: limits.stopLossPct,
    configuredRiskRewardRatio: limits.riskRewardRatio,
    roundTripCostPct: limits.estimatedRoundTripCostPct,
    executionContext: context,
  });

  const explicitProbeRequested =
    isReversalTransitionProbe ||
    context?.riskTier === "PROBE" ||
    context?.action === "PROBE" ||
    context?.setup === "TRANSITION_PROBE";
  if (explicitProbeRequested) {
    plan.riskTier = "PROBE";
    plan.sizeFactor = Math.min(plan.sizeFactor ?? 1, 0.15);
  }
  if (drawdownPolicy.tier === "DIAGNOSTIC_PROBE") {
    plan.riskTier = "PROBE";
    plan.sizeFactor = Math.min(plan.sizeFactor ?? 1, drawdownPolicy.maxSizeFactor);
  }

  if (input.executionPlan) {
    plan.orderType = input.executionPlan.orderType;
    plan.limitPrice = input.executionPlan.limitPrice;
    plan.limitEntryPrice = input.executionPlan.limitPrice;
    plan.timeInForce = input.executionPlan.timeInForce;
    plan.limitTtlCandles = input.executionPlan.expiryCandles;
  }

  if (!plan.approved || !plan.stopLoss || !plan.takeProfit)
    return {
      ...reject(plan.reason ?? "TRADE_PLAN_REJECTED"),
      tradePlan: plan,
    };
  const { stopLoss, takeProfit } = plan;
  const stopDistancePct = Math.abs(marketData.price - stopLoss) / marketData.price;
  const costToStopRatio =
    limits.estimatedRoundTripCostPct /
    Math.max(stopDistancePct, Number.EPSILON);
  if (
    costToStopRatio >
    (limits.maxRoundTripCostToStopRatio ?? 0.35) +
      RISK_ENGINE_CONSTANTS.EXPOSURE_TOLERANCE_EPSILON
  ) return reject("TRADING_COST_TOO_HIGH");
  const grossRewardPct = Math.abs(takeProfit - marketData.price) / marketData.price;
  const expectedNetRewardPct =
    grossRewardPct - limits.estimatedRoundTripCostPct;
  const netRewardToRisk = expectedNetRewardPct /
    Math.max(
      stopDistancePct + limits.estimatedRoundTripCostPct,
      Number.EPSILON,
    );
  plan.estimatedRoundTripCostPct = rounded(
    limits.estimatedRoundTripCostPct,
    8,
  );
  plan.grossRewardPct = rounded(grossRewardPct, 8);
  plan.expectedNetRewardPct = rounded(expectedNetRewardPct, 8);
  plan.netRewardToRisk = rounded(netRewardToRisk, 8);
  if (expectedNetRewardPct <= RISK_ENGINE_CONSTANTS.EXPOSURE_TOLERANCE_EPSILON)
    return {
      ...reject("EXPECTED_NET_PROFIT_NOT_POSITIVE"),
      tradePlan: plan,
    };
  const requiredRiskReward = plan.strategy === "RANGE_REVERSAL"
    ? Math.min(limits.riskRewardRatio, 1.25)
    : plan.strategy === "MOMENTUM_SCALP"
      ? Math.min(limits.riskRewardRatio, 1.25)
    : plan.strategy === "BREAKOUT_RETEST"
      ? 1.5
      : limits.riskRewardRatio;
  if (netRewardToRisk < requiredRiskReward - 1e-6)
    return {
      ...reject("NET_RISK_REWARD_NOT_MET"),
      tradePlan: plan,
    };
  let positionSize = calculatePositionSize(
    account.balance,
    limits.riskPerTrade,
    marketData.price,
    stopLoss,
    limits.estimatedRoundTripCostPct,
  );
  
  // Identify the existing same-symbol same-direction position (if any).
  // `sameSymbolPosition` was computed earlier; we now know it's safe to use it
  // because if it existed and was same-direction WITHOUT staged-entry intent,
  // we already rejected above (PYRAMIDING_NOT_ALLOWED).
  const existingSameDirection = sameSymbolPosition &&
    (sameSymbolPosition.side ?? (sameSymbolPosition.size >= 0 ? "LONG" : "SHORT")) === decision.decision
      ? sameSymbolPosition
      : undefined;

  if (existingSameDirection) {
    const entryPrice = existingSameDirection.entryPrice;
    if (entryPrice === undefined || !finitePositive(entryPrice)) {
      return reject("POSITION_ENTRY_PRICE_REQUIRED");
    }
    // Reject if the existing position is already underwater — adding to a
    // losing position (averaging down) is explicitly prohibited.
    const isUnderwater = decision.decision === 'LONG'
      ? marketData.price < entryPrice
      : marketData.price > entryPrice;

    if (isUnderwater) {
      return {
        approved: false,
        reason: 'UNPLANNED_AVERAGE_DOWN',
        riskScore: 100,
        exposurePct: rounded(baseExposurePct, 6),
        drawdownPct: rounded(drawdownPct, 6),
      };
    }

    if (!plan.stagedEntry) {
      // Staged entry metadata is required for any same-direction add.
      return {
        approved: false,
        reason: 'UNPLANNED_AVERAGE_DOWN',
        riskScore: 100,
        exposurePct: rounded(baseExposurePct, 6),
        drawdownPct: rounded(drawdownPct, 6),
      };
    }

    if (!existingSameDirection.protectionVerified || !finitePositive(existingSameDirection.stopLoss ?? 0)) return reject('POSITION_PROTECTION_REQUIRED');

  } else if (plan.stagedEntry) {
    // No existing same-direction position: this is the initial PROBE entry.
    plan.stagedEntry.stage = 'PROBE';
  }


  const lossStreakSizeFactor = lossCount <= 0
    ? 1
    : lossCount === 1
      ? 0.75
      : lossCount === 2
        ? 0.5
        : 0.35;
  const assetMaxLeverage =
    policy.liquidityClass === "MAJOR" ? 30 : policy.liquidityClass === "LIQUID_ALT" ? 15 : 5;
  const effectiveMaxLeverage = Math.min(limits.maxLeverage, assetMaxLeverage);
  const effectiveHighVolatility = limits.highVolatility * (policy.liquidityClass === "MAJOR" ? 1 : policy.liquidityClass === "LIQUID_ALT" ? 1.5 : 2.5);
  const highVolatility = marketData.volatility >= effectiveHighVolatility;
  if (plan.strategy === "RANGE_REVERSAL") {
    positionSize = rounded(
      positionSize * 0.6,
      RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS,
    );
  }
  const exposurePositions = input.currentPositions.filter((position) => position.symbol !== input.symbol ||
    (position.side ?? (position.size >= 0 ? 'LONG' : 'SHORT')) === decision.decision);
  const retainedExposure = exposurePositions.reduce(
    (sum, position) => sum + Math.abs(position.size * position.markPrice),
    0,
  );
  const cohortSizeFactor = proactive?.sizeFactor ?? 1;
  const stagedEntrySizeFactor = plan.stagedEntry
    ? plan.stagedEntry.stage === 'CONFIRMED'
      ? plan.stagedEntry.confirmationSizePct
      : plan.stagedEntry.probeSizePct
    : 1;
  const probeSizeFactor = explicitProbeRequested
    ? Math.min(stagedEntrySizeFactor, 0.15)
    : stagedEntrySizeFactor;
  const volatilitySizeFactor = highVolatility
    ? limits.highVolatilitySizeFactor
    : 1;
  const finalSizeFactor = Math.min(
    cohortSizeFactor,
    probeSizeFactor,
    volatilitySizeFactor,
    drawdownPolicy.maxSizeFactor,
  );
  positionSize = rounded(
    positionSize * finalSizeFactor,
    RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS,
  );
  plan.sizeFactor = finalSizeFactor;
  const availableExposure = Math.max(0, account.equity * limits.maxExposure - retainedExposure);
  positionSize = Math.floor(Math.min(positionSize, availableExposure / marketData.price) * 1e12) / 1e12;
  if (lossStreakSizeFactor < 1) {
    positionSize = rounded(
      positionSize * lossStreakSizeFactor,
      RISK_ENGINE_CONSTANTS.POSITION_SIZE_PRECISION_DIGITS,
    );
    plan.lossStreakSizeFactor = lossStreakSizeFactor;
  }
  if (!finitePositive(positionSize))
    return reject("MAX_PORTFOLIO_EXPOSURE_EXCEEDED");

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
    ? Math.max(1, Math.floor(effectiveMaxLeverage / 2))
    : effectiveMaxLeverage;
  const maximumSafeLeverage = Math.max(
    1,
    Math.min(
      effectiveMaxLeverage,
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
  if (existingSameDirection && plan.stagedEntry) {
    const existingRisk = Math.abs(existingSameDirection.size) *
      (Math.abs(existingSameDirection.entryPrice! - existingSameDirection.stopLoss!) +
        existingSameDirection.entryPrice! * limits.estimatedRoundTripCostPct);
    if (existingRisk + plannedLoss > account.equity * Math.min(limits.riskPerTrade, plan.stagedEntry.combinedRiskLimitPct) + 1e-8)
      return reject('COMBINED_THESIS_RISK_EXCEEDED');
  }
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
      {
        ...limits,
        highVolatility: effectiveHighVolatility,
        maxLeverage: effectiveMaxLeverage,
      },
    ),
    exposurePct: rounded(exposurePct, 6),
    drawdownPct: rounded(drawdownPct, 6),
    plannedLoss: rounded(plannedLoss, 8),
    plannedEquityRiskPct: rounded(plannedEquityRiskPct, 8),
    plannedMarginRoe: rounded(plannedMarginRoe, 8),
    tradePlan: plan,
  };
}
