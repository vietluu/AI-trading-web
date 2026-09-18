export interface SelectEntryOrderPolicyInput {
  setup?: string;
  strategyKey?: string;
  side: 'BUY' | 'SELL';
  bid: number;
  ask: number;
  tickSize?: number;
  maxSlippagePct?: number;
  structuralPrice?: number;
}

export interface EntryOrderPolicy {
  orderType: 'LIMIT';
  timeInForce: 'IOC' | 'GTC';
  limitPrice: number;
  expiryCandles: number;
}

export function roundToTick(value: number, tickSize?: number): number {
  if (!Number.isFinite(value)) return value;
  if (!tickSize || !Number.isFinite(tickSize) || tickSize <= 0) {
    return Number(value.toFixed(8));
  }
  const precision = Math.max(0, Math.ceil(-Math.log10(tickSize) + 1e-6));
  const factor = 1 / tickSize;
  return Number((Math.round(value * factor) / factor).toFixed(precision));
}

export function selectEntryOrderPolicy(input: SelectEntryOrderPolicyInput): EntryOrderPolicy {
  const isMomentumOrBreakout =
    input.setup === 'BREAKOUT_RETEST' ||
    input.strategyKey === 'breakout' ||
    input.strategyKey === 'momentum-scalp' ||
    input.setup === 'MOMENTUM_SCALP';

  const timeInForce: 'IOC' | 'GTC' = isMomentumOrBreakout ? 'IOC' : 'GTC';
  const expiryCandles = isMomentumOrBreakout ? 1 : 2;

  let limitPrice: number;
  if (timeInForce === 'IOC') {
    const slippage = input.maxSlippagePct ?? 0.004;
    const rawPrice = input.side === 'BUY'
      ? input.ask * (1 + slippage)
      : input.bid * (1 - slippage);
    limitPrice = roundToTick(rawPrice, input.tickSize);
  } else {
    const rawPrice = input.structuralPrice !== undefined && Number.isFinite(input.structuralPrice)
      ? input.structuralPrice
      : (input.side === 'BUY' ? input.bid : input.ask);
    limitPrice = roundToTick(rawPrice, input.tickSize);
  }

  return {
    orderType: 'LIMIT',
    timeInForce,
    limitPrice,
    expiryCandles,
  };
}
