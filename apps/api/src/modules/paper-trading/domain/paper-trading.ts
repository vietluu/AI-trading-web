import { createHash } from 'node:crypto';

export type PositionSide = 'LONG' | 'SHORT';
export type OrderSide = 'BUY' | 'SELL';

export function calculatePnL(side: PositionSide, entryPrice: number, currentPrice: number, size: number): number {
  return (side === 'LONG' ? currentPrice - entryPrice : entryPrice - currentPrice) * size;
}

export function calculateFee(price: number, quantity: number, feeRate: number): number {
  return price * quantity * feeRate;
}

/** A stable pseudo-random slippage value makes replays and tests reproducible. */
export function deterministicSlippage(seed: string, minimum: number, maximum: number): number {
  const value = createHash('sha256').update(seed).digest().readUInt32BE(0) / 0xffffffff;
  return minimum + value * (maximum - minimum);
}

export function executionPrice(referencePrice: number, side: OrderSide, slippage: number): number {
  return referencePrice * (side === 'BUY' ? 1 + slippage : 1 - slippage);
}

export function protectiveExit(side: PositionSide, entry: number, mark: number, pnl: number, margin: number, stopLoss: number, takeProfit: number): 'LIQUIDATION' | 'STOP_LOSS' | 'TAKE_PROFIT' | undefined {
  if (pnl < -0.5 * margin) return 'LIQUIDATION';
  const change = side === 'LONG' ? (mark - entry) / entry : (entry - mark) / entry;
  if (change <= -stopLoss) return 'STOP_LOSS';
  if (change >= takeProfit) return 'TAKE_PROFIT';
  return undefined;
}

export function round(value: number, digits = 8): number {
  return Number(value.toFixed(digits));
}

export function maximumDrawdown(equities: number[]): number {
  let peak = equities[0] ?? 0;
  let maximum = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    if (peak > 0) maximum = Math.max(maximum, (peak - equity) / peak * 100);
  }
  return round(maximum, 4);
}
