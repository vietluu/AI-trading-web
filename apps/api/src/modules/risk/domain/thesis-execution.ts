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
