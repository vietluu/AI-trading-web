import { roundToTick } from '../../modules/risk/domain/entry-order-policy';

export type ProtectionPreflightRejectionReason =
  | 'ENTRY_PROTECTION_GEOMETRY_INVALID'
  | 'STOP_ALREADY_BREACHED'
  | 'TAKE_PROFIT_ALREADY_CROSSED'
  | 'MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED';

export interface PreflightOrderProtectionInput {
  side: 'BUY' | 'SELL';
  entry: number;
  stopLoss?: number;
  takeProfit?: number;
  currentPrice: number;
  tickSize?: number;
  maxSlippagePct?: number;
  orderType?: 'LIMIT' | 'MARKET';
  timeInForce?: 'IOC' | 'GTC';
}

export interface NormalizedOrderProtection {
  approved: true;
  entry: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface OrderProtectionRejection {
  approved: false;
  reason: ProtectionPreflightRejectionReason;
}

export type OrderProtectionPreflightResult =
  | NormalizedOrderProtection
  | OrderProtectionRejection;

export function preflightOrderProtection(
  input: PreflightOrderProtectionInput,
): OrderProtectionPreflightResult {
  const normEntry = roundToTick(input.entry, input.tickSize);
  const normStop =
    input.stopLoss !== undefined
      ? roundToTick(input.stopLoss, input.tickSize)
      : undefined;
  const normTp =
    input.takeProfit !== undefined
      ? roundToTick(input.takeProfit, input.tickSize)
      : undefined;
  const normCurrent = roundToTick(input.currentPrice, input.tickSize);

  // 1. Geometry validation
  if (normStop !== undefined && normTp !== undefined) {
    if (input.side === 'BUY') {
      if (!(normStop < normEntry && normEntry < normTp)) {
        return { approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID' };
      }
    } else {
      if (!(normTp < normEntry && normEntry < normStop)) {
        return { approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID' };
      }
    }
  } else if (normStop !== undefined) {
    if (input.side === 'BUY' && normStop >= normEntry) {
      return { approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID' };
    }
    if (input.side === 'SELL' && normStop <= normEntry) {
      return { approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID' };
    }
  } else if (normTp !== undefined) {
    if (input.side === 'BUY' && normTp <= normEntry) {
      return { approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID' };
    }
    if (input.side === 'SELL' && normTp >= normEntry) {
      return { approved: false, reason: 'ENTRY_PROTECTION_GEOMETRY_INVALID' };
    }
  }

  // 2. Current price vs Stop Loss breach
  if (normStop !== undefined) {
    if (input.side === 'BUY' && normCurrent <= normStop) {
      return { approved: false, reason: 'STOP_ALREADY_BREACHED' };
    }
    if (input.side === 'SELL' && normCurrent >= normStop) {
      return { approved: false, reason: 'STOP_ALREADY_BREACHED' };
    }
  }

  // 3. Current price vs Take Profit crossed
  if (normTp !== undefined) {
    if (input.side === 'BUY' && normCurrent >= normTp) {
      return { approved: false, reason: 'TAKE_PROFIT_ALREADY_CROSSED' };
    }
    if (input.side === 'SELL' && normCurrent <= normTp) {
      return { approved: false, reason: 'TAKE_PROFIT_ALREADY_CROSSED' };
    }
  }

  // 4. Slippage bound for marketable limits
  if (
    input.maxSlippagePct !== undefined &&
    Number.isFinite(input.maxSlippagePct) &&
    input.maxSlippagePct > 0
  ) {
    if (input.side === 'BUY') {
      const maxPrice = input.currentPrice * (1 + input.maxSlippagePct);
      if (normEntry > roundToTick(maxPrice, input.tickSize)) {
        return {
          approved: false,
          reason: 'MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED',
        };
      }
    } else {
      const minPrice = input.currentPrice * (1 - input.maxSlippagePct);
      if (normEntry < roundToTick(minPrice, input.tickSize)) {
        return {
          approved: false,
          reason: 'MARKETABLE_LIMIT_SLIPPAGE_EXCEEDED',
        };
      }
    }
  }

  return {
    approved: true,
    entry: normEntry,
    ...(normStop !== undefined ? { stopLoss: normStop } : {}),
    ...(normTp !== undefined ? { takeProfit: normTp } : {}),
  };
}
