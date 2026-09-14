export interface ShadowCandle {
  openTime: number; // timestamp ms
  closeTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ShadowPlanEvaluationInput {
  id?: string;
  evaluationKey: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  targets: Array<{ price: number; fraction: number }>;
  expiresAt: string | Date;
  sourceDataCutoff: string | Date;
  feeBps: number;
  slippageBps: number;
  fundingBps: number;
  quantity?: number;
  riskFraction?: number;
}

export interface ShadowPlanOutcome {
  status: 'FILLED' | 'EXPIRED' | 'STOPPED' | 'TARGET_REACHED' | 'CANCELLED';
  grossPnl: number;
  feeCost: number;
  slippageCost: number;
  fundingCost: number;
  netPnl: number;
  netR: number;
  mfe: number;
  mae: number;
  durationCandles: number;
  terminalReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXPIRED_UNFILLED' | 'EXPIRED_TIME' | 'INCOMPLETE_DATA';
  isComplete: boolean;
  filledAt?: Date;
  closedAt?: Date;
  fillPrice?: number;
  exitPrice?: number;
}

export function evaluateShadowPlan(
  plan: ShadowPlanEvaluationInput,
  candles: ShadowCandle[],
): ShadowPlanOutcome {
  const quantity = plan.quantity ?? 1;
  const expiresAtMs = typeof plan.expiresAt === 'string' ? Date.parse(plan.expiresAt) : plan.expiresAt.getTime();
  const cutoffMs = typeof plan.sourceDataCutoff === 'string' ? Date.parse(plan.sourceDataCutoff) : plan.sourceDataCutoff.getTime();
  const isLong = plan.direction === 'LONG';
  const targetPrice = plan.targets[0]?.price ?? (isLong ? plan.entryPrice * 1.02 : plan.entryPrice * 0.98);
  const initialRiskDistance = Math.abs(plan.entryPrice - plan.stopLoss);

  const relevantCandles = [...candles]
    .filter((c) => c.openTime >= cutoffMs)
    .sort((a, b) => a.openTime - b.openTime);

  let isFilled = false;
  let filledAt: Date | undefined;
  let fillCandleIndex = -1;
  let mfe = 0;
  let mae = 0;

  for (let i = 0; i < relevantCandles.length; i++) {
    const candle = relevantCandles[i];
    if (!candle) continue;

    if (!isFilled) {
      if (candle.openTime >= expiresAtMs) {
        return {
          status: 'EXPIRED',
          grossPnl: 0,
          feeCost: 0,
          slippageCost: 0,
          fundingCost: 0,
          netPnl: 0,
          netR: 0,
          mfe: 0,
          mae: 0,
          durationCandles: 0,
          terminalReason: 'EXPIRED_UNFILLED',
          isComplete: true,
        };
      }

      const canFill = isLong
        ? candle.low <= plan.entryPrice
        : candle.high >= plan.entryPrice;

      if (canFill) {
        isFilled = true;
        filledAt = new Date(candle.openTime);
        fillCandleIndex = i;
        if (isLong) {
          mfe = Math.max(mfe, candle.high - plan.entryPrice);
          mae = Math.min(mae, candle.low - plan.entryPrice);
        } else {
          mfe = Math.max(mfe, plan.entryPrice - candle.low);
          mae = Math.min(mae, plan.entryPrice - candle.high);
        }
      } else {
        continue;
      }
    }

    const durationCandles = i - fillCandleIndex + 1;

    if (isLong) {
      mfe = Math.max(mfe, candle.high - plan.entryPrice);
      mae = Math.min(mae, candle.low - plan.entryPrice);
    } else {
      mfe = Math.max(mfe, plan.entryPrice - candle.low);
      mae = Math.min(mae, plan.entryPrice - candle.high);
    }

    const hitStop = isLong ? candle.low <= plan.stopLoss : candle.high >= plan.stopLoss;
    const hitTarget = isLong ? candle.high >= targetPrice : candle.low <= targetPrice;

    if (hitStop) {
      const exitPrice = plan.stopLoss;
      const grossPnl = isLong
        ? (exitPrice - plan.entryPrice) * quantity
        : (plan.entryPrice - exitPrice) * quantity;
      const feeCost = (plan.feeBps / 10_000) * (plan.entryPrice + exitPrice) * quantity;
      const slippageCost = (plan.slippageBps / 10_000) * (plan.entryPrice + exitPrice) * quantity;
      const fundingCost = (plan.fundingBps / 10_000) * plan.entryPrice * quantity * Math.max(1, durationCandles);
      const totalCost = feeCost + slippageCost + fundingCost;
      const netPnl = grossPnl - totalCost;
      const netR = initialRiskDistance > 0 ? netPnl / (initialRiskDistance * quantity) : 0;

      return {
        status: 'STOPPED',
        grossPnl,
        feeCost,
        slippageCost,
        fundingCost,
        netPnl,
        netR,
        mfe,
        mae,
        durationCandles,
        terminalReason: 'STOP_LOSS',
        isComplete: true,
        filledAt,
        closedAt: new Date(candle.openTime),
        fillPrice: plan.entryPrice,
        exitPrice,
      };
    }

    if (hitTarget) {
      const exitPrice = targetPrice;
      const grossPnl = isLong
        ? (exitPrice - plan.entryPrice) * quantity
        : (plan.entryPrice - exitPrice) * quantity;
      const feeCost = (plan.feeBps / 10_000) * (plan.entryPrice + exitPrice) * quantity;
      const slippageCost = (plan.slippageBps / 10_000) * (plan.entryPrice + exitPrice) * quantity;
      const fundingCost = (plan.fundingBps / 10_000) * plan.entryPrice * quantity * Math.max(1, durationCandles);
      const totalCost = feeCost + slippageCost + fundingCost;
      const netPnl = grossPnl - totalCost;
      const netR = initialRiskDistance > 0 ? netPnl / (initialRiskDistance * quantity) : 0;

      return {
        status: 'TARGET_REACHED',
        grossPnl,
        feeCost,
        slippageCost,
        fundingCost,
        netPnl,
        netR,
        mfe,
        mae,
        durationCandles,
        terminalReason: 'TAKE_PROFIT',
        isComplete: true,
        filledAt,
        closedAt: new Date(candle.openTime),
        fillPrice: plan.entryPrice,
        exitPrice,
      };
    }
  }

  if (!isFilled) {
    return {
      status: 'EXPIRED',
      grossPnl: 0,
      feeCost: 0,
      slippageCost: 0,
      fundingCost: 0,
      netPnl: 0,
      netR: 0,
      mfe: 0,
      mae: 0,
      durationCandles: 0,
      terminalReason: 'EXPIRED_UNFILLED',
      isComplete: true,
    };
  }

  const lastCandle = relevantCandles[relevantCandles.length - 1];
  const markPrice = lastCandle?.close ?? plan.entryPrice;
  const durationCandles = relevantCandles.length - fillCandleIndex;
  const grossPnl = isLong
    ? (markPrice - plan.entryPrice) * quantity
    : (plan.entryPrice - markPrice) * quantity;
  const feeCost = (plan.feeBps / 10_000) * (plan.entryPrice + markPrice) * quantity;
  const slippageCost = (plan.slippageBps / 10_000) * plan.entryPrice * quantity;
  const fundingCost = (plan.fundingBps / 10_000) * plan.entryPrice * quantity * Math.max(1, durationCandles);
  const totalCost = feeCost + slippageCost + fundingCost;
  const netPnl = grossPnl - totalCost;
  const netR = initialRiskDistance > 0 ? netPnl / (initialRiskDistance * quantity) : 0;

  return {
    status: 'FILLED',
    grossPnl,
    feeCost,
    slippageCost,
    fundingCost,
    netPnl,
    netR,
    mfe,
    mae,
    durationCandles,
    terminalReason: 'INCOMPLETE_DATA',
    isComplete: false,
    filledAt,
    fillPrice: plan.entryPrice,
    exitPrice: markPrice,
  };
}
