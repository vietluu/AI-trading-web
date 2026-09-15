import { ExchangeError } from './exchange.error';
import type { ExchangeProvider, PlaceOrderCommand } from './exchange.types';

/** A declared LIMIT is never eligible for an adapter's market-order fallback. */
export function assertDeclaredLimitOrder(command: PlaceOrderCommand, provider: ExchangeProvider): boolean {
  const declared = command.orderType === 'LIMIT' || command.limitPrice !== undefined || command.expiresAt !== undefined;
  if (!declared) return false;
  const expiresAt = Date.parse(command.expiresAt ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw ExchangeError.invalidRequest(provider, 'THESIS_ORDER_EXPIRED');
  if (command.orderType !== 'LIMIT' || !['IOC', 'GTC'].includes(command.timeInForce ?? '') || !Number.isFinite(Number(command.limitPrice)) || Number(command.limitPrice) <= 0)
    throw ExchangeError.invalidRequest(provider, 'THESIS_LIMIT_ORDER_INVALID');
  return true;
}
