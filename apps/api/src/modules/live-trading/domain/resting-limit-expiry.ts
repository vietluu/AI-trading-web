/** Only managed resting entries have a cancellation deadline. */
export function isRestingEntryExpired(order: {
  type?: string; purpose?: string; reduceOnly?: boolean; tradePlan?: unknown;
}, now = Date.now()): boolean {
  if (order.type !== 'LIMIT' || order.purpose !== 'OPEN' || order.reduceOnly) return false;
  if (!order.tradePlan || typeof order.tradePlan !== 'object' || Array.isArray(order.tradePlan)) return false;
  const plan = order.tradePlan as Record<string, unknown>;
  const deadline = typeof plan.expiresAt === 'string' ? Date.parse(plan.expiresAt) : NaN;
  return plan.timeInForce === 'GTC' && Number.isFinite(deadline) && deadline <= now;
}
