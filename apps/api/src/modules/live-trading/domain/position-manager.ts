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
  const currentProfitPct = input.entryPrice > 0 ? currentProfit / input.entryPrice : 0;
  const minimumPartialProfitPct = Math.max(
    0,
    input.plan.estimatedRoundTripCostPct ?? 0.001,
  ) * 3;
  let candidate = input.currentStopLoss;
  if (peakR >= input.plan.breakEvenAtR) {
    // A stop exactly at gross break-even can still realize a net loss. Keep a
    // 25% safety margin over the conservative round-trip fee/slippage estimate.
    const feeBuffer = input.entryPrice *
      (input.plan.estimatedRoundTripCostPct ?? 0.001) * 1.25;
    candidate = input.side === "LONG"
      ? Math.max(candidate, input.entryPrice + feeBuffer)
      : Math.min(candidate, input.entryPrice - feeBuffer);
  }
  if (peakR >= 1.5 && input.plan.trailingAtrMultiple && input.plan.atr) {
    const trailing = input.side === "LONG"
      ? highestMark - input.plan.trailingAtrMultiple * input.plan.atr
      : lowestMark + input.plan.trailingAtrMultiple * input.plan.atr;
    candidate = input.side === "LONG" ? Math.max(candidate, trailing) : Math.min(candidate, trailing);
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
      peakR >= 1 &&
      currentR >= 1 &&
      currentProfitPct > minimumPartialProfitPct,
    // maxHoldingCandles is an analysis horizon, not an execution deadline.
    // A stale thesis must be reassessed by the normal Decision/Judge pipeline;
    // it must never cause an unconditional market close here.
    reassessmentDue:
      elapsedCandles >= input.plan.maxHoldingCandles && currentR < 0.3,
  };
}
