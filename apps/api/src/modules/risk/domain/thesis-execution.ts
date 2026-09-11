import type { PlaceOrderCommand } from '../../../exchange/domain/exchange.types';
import { z } from 'zod';
import { AnticipatoryMarketSnapshotSchema, TradeThesisSchema, StructuredTriggerSchema } from '@platform/shared';
import { validateTradeThesis } from '../../agents/domain/trade-thesis-validator';
import type { AnticipatoryMarketSnapshot, StructuredTrigger } from '@platform/shared';

/** Only deterministic, declared trigger types can authorize confirmation. */
export function thesisTriggersSatisfied(triggers: StructuredTrigger[], snapshot: AnticipatoryMarketSnapshot, price: number): boolean {
  return triggers.length > 0 && triggers.every((trigger) => {
    if (trigger.type === 'VOLATILITY_EXPANSION') return snapshot.volatility.coverage === 'AVAILABLE' && snapshot.volatility.expansionState !== 'NOT_EXPANDED';
    if (trigger.price === null || !Number.isFinite(trigger.price)) return false;
    if (['PRICE_ABOVE', 'PRICE_RECLAIM', 'PRICE_BREAKOUT'].includes(trigger.type)) return price >= trigger.price;
    if (['PRICE_BELOW', 'PRICE_BREAKDOWN'].includes(trigger.type)) return price <= trigger.price;
    return false;
  });
}


export const StoredProbeSchema = z.object({
  stage: z.enum(['PROBE', 'CONFIRMED']), thesisId: z.string().min(1), setup: z.string().min(1),
  trigger: z.array(StructuredTriggerSchema).min(1), sourceDataCutoff: z.string().datetime(),
});
export const ProactiveAuthorizationSchema = z.object({
  kind: z.literal('PROACTIVE'), mode: z.enum(['OBSERVE', 'SHADOW', 'DEMO']),
  requiredEnvironment: z.literal('DEMO'), connectionId: z.string().min(1), thesisId: z.string().min(1),
  thesis: TradeThesisSchema, snapshot: AnticipatoryMarketSnapshotSchema,
});

export function proactiveAuthorizationAllowed(authorization: unknown, connectionId: string, environment: string, now = new Date()): boolean {
  const parsed = ProactiveAuthorizationSchema.safeParse(authorization);
  if (!parsed.success) return false;
  const auth = parsed.data;
  return auth.mode === 'DEMO' && environment === 'DEMO' && auth.connectionId === connectionId &&
    ['PROBE_READY', 'CONFIRMED'].includes(auth.thesis.state) &&
    validateTradeThesis(auth.thesis, auth.snapshot, { now }).valid;
}


const ProactiveLimitPlanSchema = z.object({
  orderType: z.literal('LIMIT'), timeInForce: z.literal('IOC'), limitEntryPrice: z.number().positive(),
  expiresAt: z.string().datetime(), limitTtlCandles: z.number().int().positive(),
  targets: z.array(z.object({ price: z.number().positive(), fraction: z.literal(1) })).length(1),
});

export function proactiveOrderTerms(plan: unknown, authorization: unknown): Pick<PlaceOrderCommand, 'orderType' | 'limitPrice' | 'timeInForce' | 'expiresAt'> {
  const parsed = ProactiveLimitPlanSchema.safeParse(plan);
  const auth = ProactiveAuthorizationSchema.safeParse(authorization);
  if (!parsed.success || !auth.success) throw new Error('THESIS_EXECUTION_PLAN_INVALID');
  const value = parsed.data;
  const thesis = auth.data.thesis;
  if (!thesis.entryZone || value.limitEntryPrice < thesis.entryZone.lower || value.limitEntryPrice > thesis.entryZone.upper ||
    thesis.targets.length !== 1 || thesis.targets[0]?.fraction !== 1 || value.targets[0]?.price !== thesis.targets[0]?.price) throw new Error('THESIS_EXECUTION_PLAN_MISMATCH');
  if (Date.parse(value.expiresAt) <= Date.now() || Date.parse(value.expiresAt) > Date.parse(thesis.expiresAt)) throw new Error('THESIS_ORDER_EXPIRED');
  return { orderType: 'LIMIT', timeInForce: 'IOC', limitPrice: String(value.limitEntryPrice), expiresAt: value.expiresAt };
}
