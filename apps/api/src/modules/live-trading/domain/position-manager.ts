import type { TradePlan } from "../../risk/domain/trade-plan-engine";

export interface PositionManagementInput {
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  initialStopLoss: number;
  currentStopLoss: number;
  highestMark?: number;
  lowestMark?: number;
  openedAt: Date;
  now?: Date;
  partialTaken: boolean;
  plan: TradePlan;
}

export function evaluatePositionManagement(input: PositionManagementInput) {
  const highestMark = Math.max(input.highestMark ?? input.entryPrice, input.markPrice);
  const lowestMark = Math.min(input.lowestMark ?? input.entryPrice, input.markPrice);
  const risk = Math.abs(input.entryPrice - input.initialStopLoss);

  if (!Number.isFinite(risk) || risk <= 0) {
    return {
      highestMark,
      lowestMark,
      peakR: 0,
      currentR: 0,
      takePartial: false,
      reassessmentDue: false,
    };
  }

  const favorable = input.side === "LONG" ? highestMark - input.entryPrice : input.entryPrice - lowestMark;
  const currentProfit = input.side === "LONG" ? input.markPrice - input.entryPrice : input.entryPrice - input.markPrice;
  const peakR = favorable / risk;
  const currentR = currentProfit / risk;
  const peakProfitPct = input.entryPrice > 0 ? favorable / input.entryPrice : 0;
  const currentProfitPct = input.entryPrice > 0 ? currentProfit / input.entryPrice : 0;
  const minimumPartialProfitPct = Math.max(
    0,
    input.plan.estimatedRoundTripCostPct ?? 0.001,
  ) * 3;

  let candidate = input.currentStopLoss;

  // 1. Breakeven Stop Loss (at 0.8R or 0.8% peak profit)
  if (peakR >= input.plan.breakEvenAtR || peakProfitPct >= 0.008) {
    // Keep a 25% safety margin over the round-trip fee/slippage estimate
    const feeBuffer = input.entryPrice *
      (input.plan.estimatedRoundTripCostPct ?? 0.001) * 1.25;
    candidate = input.side === "LONG"
      ? Math.max(candidate, input.entryPrice + feeBuffer)
      : Math.min(candidate, input.entryPrice - feeBuffer);
  }

  // 2. Dynamic Tiered Profit Retention (Khóa Lợi Nhuận Bậc Thang)
  // Ensures peak profits are protected and not given back to the market
  let retentionRatio = 0;
  if (peakProfitPct >= 0.040 || peakR >= 3.5) {
    retentionRatio = 0.80; // Keep at least 80% of peak profit when peak >= 4.0%
  } else if (peakProfitPct >= 0.025 || peakR >= 2.5) {
    retentionRatio = 0.70; // Keep at least 70% of peak profit when peak >= 2.5% (e.g. +3% peak -> locks +2.1% min!)
  } else if (peakProfitPct >= 0.015 || peakR >= 1.5) {
    retentionRatio = 0.50; // Keep at least 50% of peak profit when peak >= 1.5%
  }

  if (retentionRatio > 0 && favorable > 0) {
    const guaranteedProfit = favorable * retentionRatio;
    const guaranteedStop =
      input.side === "LONG"
        ? input.entryPrice + guaranteedProfit
        : input.entryPrice - guaranteedProfit;
    candidate = input.side === "LONG"
      ? Math.max(candidate, guaranteedStop)
      : Math.min(candidate, guaranteedStop);
  }

  // 3. Adaptive ATR Trailing (Thu hẹp ATR khi lãi lớn để bám sát đỉnh)
  if ((peakR >= 1.5 || peakProfitPct >= 0.015) && input.plan.atr) {
    let atrMultiplier = input.plan.trailingAtrMultiple ?? 1.5;
    if (peakR >= 3.0 || peakProfitPct >= 0.035) {
      atrMultiplier = 0.6; // Ultra-tight trail on high profits
    } else if (peakR >= 2.0 || peakProfitPct >= 0.025) {
      atrMultiplier = 0.9; // Tight trail
    } else {
      atrMultiplier = Math.min(1.2, atrMultiplier); // Moderate trail
    }

    const trailing = input.side === "LONG"
      ? highestMark - atrMultiplier * input.plan.atr
      : lowestMark + atrMultiplier * input.plan.atr;
    candidate = input.side === "LONG"
      ? Math.max(candidate, trailing)
      : Math.min(candidate, trailing);
  }

  const improved = input.side === "LONG"
    ? candidate > input.currentStopLoss + Number.EPSILON
    : candidate < input.currentStopLoss - Number.EPSILON;

  const elapsedCandles = ((input.now ?? new Date()).getTime() - input.openedAt.getTime()) /
    (input.plan.timeframeMs ?? 15 * 60_000);

  return {
    highestMark,
    lowestMark,
    peakR,
    currentR,
    ...(improved ? { tightenedStopLoss: Number(candidate.toFixed(8)) } : {}),
    takePartial:
      !input.partialTaken &&
      (peakR >= 1.8 || peakProfitPct >= 0.02) &&
      currentR >= 1 &&
      currentProfitPct > minimumPartialProfitPct,
    // maxHoldingCandles is an analysis horizon, not an execution deadline.
    reassessmentDue:
      elapsedCandles >= input.plan.maxHoldingCandles && currentR < 0.3,
  };
}
