import {
  ExecutionContextSchema,
  type CanonicalRegime,
  type CanonicalSetup,
  type EntryAction,
  type ExecutionContext,
  type RiskTier,
} from '@platform/shared';

export type {
  CanonicalRegime,
  CanonicalSetup,
  EntryAction,
  ExecutionContext,
  RiskTier,
} from '@platform/shared';

export const EXECUTION_CONTEXT_POLICY = Object.freeze({
  maximumTriggerChaseDistanceAtr: 0.8,
  maximumMoveConsumedPct: 0.5,
  maximumRangeLongPercentile: 0.35,
  minimumRangeShortPercentile: 0.65,
});

export interface BuildExecutionContextInput {
  regime: CanonicalRegime;
  regimeDetail?: string;
  setup: CanonicalSetup;
  action: EntryAction;
  price: number;
  support?: number;
  resistance?: number;
  triggerPrice?: number;
  atr?: number;
  moveConsumedPct?: number;
  sourceDataCutoff: Date | string;
  primaryCandleClosed: boolean;
  triggerConfirmed?: boolean;
}

export type TradeDirection = 'LONG' | 'SHORT';

export type SetupLocationValidationReason =
  | 'REGIME_SETUP_MISMATCH'
  | 'RANGE_LOCATION_UNAVAILABLE'
  | 'RANGE_LONG_NOT_AT_LOWER_BOUNDARY'
  | 'RANGE_SHORT_NOT_AT_UPPER_BOUNDARY'
  | 'PRIMARY_CANDLE_NOT_CLOSED'
  | 'ENTRY_TRIGGER_NOT_CONFIRMED'
  | 'ENTRY_CHASE_DISTANCE_EXCEEDED'
  | 'EXPECTED_MOVE_ALREADY_CONSUMED';

export function isSetupCompatibleWithRegime(
  regime: CanonicalRegime,
  setup: CanonicalSetup,
): boolean {
  if (regime === 'RANGING') return setup === 'RANGE_REVERSION' || setup === 'TRANSITION_PROBE';
  if (regime === 'BREAKOUT') return setup === 'BREAKOUT_RETEST';
  if (regime === 'PRE_BREAKOUT') return setup === 'TRANSITION_PROBE';
  if (regime === 'TRENDING') return setup === 'TREND_PULLBACK';
  return false;
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function positiveFinite(value: number | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function assertFiniteInput(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function assertOptionalFiniteInput(
  value: number | undefined,
  name: string,
): void {
  if (value !== undefined) assertFiniteInput(value, name);
}

function sourceDataCutoffIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('sourceDataCutoff must be a valid date');
  }
  return date.toISOString();
}

function riskTierFor(action: EntryAction): RiskTier {
  if (action === 'ENTER') return 'NORMAL';
  if (action === 'PROBE') return 'PROBE';
  return 'NONE';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function buildExecutionContext(
  input: BuildExecutionContextInput,
): ExecutionContext {
  const { atr, price, resistance, support, triggerPrice } = input;
  assertFiniteInput(price, 'price');
  assertOptionalFiniteInput(support, 'support');
  assertOptionalFiniteInput(resistance, 'resistance');
  assertOptionalFiniteInput(triggerPrice, 'triggerPrice');
  assertOptionalFiniteInput(atr, 'atr');
  assertOptionalFiniteInput(input.moveConsumedPct, 'moveConsumedPct');
  const rangeIsValid =
    isFiniteNumber(support) &&
    isFiniteNumber(resistance) &&
    resistance > support;
  const hasAtr = positiveFinite(atr);
  const priceLocation: ExecutionContext['priceLocation'] = {};

  if (rangeIsValid) {
    priceLocation.rangePercentile = clamp(
      (price - support) / (resistance - support),
      0,
      1,
    );
  }
  if (hasAtr && isFiniteNumber(support)) {
    priceLocation.distanceFromSupportAtr = Math.abs(price - support) / atr;
  }
  if (hasAtr && isFiniteNumber(resistance)) {
    priceLocation.distanceFromResistanceAtr = Math.abs(price - resistance) / atr;
  }
  if (hasAtr && isFiniteNumber(triggerPrice)) {
    priceLocation.distanceFromTriggerAtr = Math.abs(price - triggerPrice) / atr;
  }
  if (isFiniteNumber(input.moveConsumedPct)) {
    priceLocation.moveConsumedPct = input.moveConsumedPct;
  }

  return ExecutionContextSchema.parse({
    regime: input.regime,
    ...(input.regimeDetail === undefined ? {} : { regimeDetail: input.regimeDetail }),
    setup: input.setup,
    action: input.action,
    riskTier: riskTierFor(input.action),
    sourceDataCutoff: sourceDataCutoffIso(input.sourceDataCutoff),
    usesClosedPrimaryCandle: input.primaryCandleClosed,
    triggerConfirmed: input.triggerConfirmed ?? false,
    priceLocation,
  });
}

export function validateSetupLocation(
  context: ExecutionContext,
  direction: TradeDirection,
): SetupLocationValidationReason[] {
  const reasons = new Set<SetupLocationValidationReason>();
  const { priceLocation } = context;

  if (!isSetupCompatibleWithRegime(context.regime, context.setup)) {
    reasons.add('REGIME_SETUP_MISMATCH');
  }

  if (context.setup === 'RANGE_REVERSION' && context.action !== 'WAIT') {
    if (priceLocation.rangePercentile === undefined) {
      reasons.add('RANGE_LOCATION_UNAVAILABLE');
    }
    if (
      direction === 'LONG' &&
      priceLocation.rangePercentile !== undefined &&
      priceLocation.rangePercentile > EXECUTION_CONTEXT_POLICY.maximumRangeLongPercentile
    ) reasons.add('RANGE_LONG_NOT_AT_LOWER_BOUNDARY');
    if (
      direction === 'SHORT' &&
      priceLocation.rangePercentile !== undefined &&
      priceLocation.rangePercentile < EXECUTION_CONTEXT_POLICY.minimumRangeShortPercentile
    ) reasons.add('RANGE_SHORT_NOT_AT_UPPER_BOUNDARY');
  }

  if (context.action === 'WAIT') return [...reasons];

  if (!context.triggerConfirmed) reasons.add('ENTRY_TRIGGER_NOT_CONFIRMED');
  if (context.action !== 'ENTER') return [...reasons];

  if (!context.usesClosedPrimaryCandle) reasons.add('PRIMARY_CANDLE_NOT_CLOSED');
  if (
    priceLocation.distanceFromTriggerAtr !== undefined &&
    priceLocation.distanceFromTriggerAtr > EXECUTION_CONTEXT_POLICY.maximumTriggerChaseDistanceAtr
  ) reasons.add('ENTRY_CHASE_DISTANCE_EXCEEDED');
  if (
    priceLocation.moveConsumedPct !== undefined &&
    priceLocation.moveConsumedPct > EXECUTION_CONTEXT_POLICY.maximumMoveConsumedPct
  ) reasons.add('EXPECTED_MOVE_ALREADY_CONSUMED');

  return [...reasons];
}
