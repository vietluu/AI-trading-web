import type {
  CanonicalRegime,
  CanonicalSetup,
  EntryAction,
  ExecutionContext,
  RiskTier,
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
  maximumRangeLongPercentile: 0.3,
  minimumRangeShortPercentile: 0.7,
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
  | 'RANGE_LONG_NOT_AT_LOWER_BOUNDARY'
  | 'RANGE_SHORT_NOT_AT_UPPER_BOUNDARY'
  | 'PRIMARY_CANDLE_NOT_CLOSED'
  | 'ENTRY_TRIGGER_NOT_CONFIRMED'
  | 'ENTRY_CHASE_DISTANCE_EXCEEDED'
  | 'EXPECTED_MOVE_ALREADY_CONSUMED';

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function positiveFinite(value: number | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
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

  return {
    regime: input.regime,
    ...(input.regimeDetail === undefined ? {} : { regimeDetail: input.regimeDetail }),
    setup: input.setup,
    action: input.action,
    riskTier: riskTierFor(input.action),
    sourceDataCutoff: sourceDataCutoffIso(input.sourceDataCutoff),
    usesClosedPrimaryCandle: input.primaryCandleClosed,
    triggerConfirmed: input.triggerConfirmed ?? false,
    priceLocation,
  };
}

export function validateSetupLocation(
  context: ExecutionContext,
  direction: TradeDirection,
): SetupLocationValidationReason[] {
  const reasons = new Set<SetupLocationValidationReason>();
  const { priceLocation } = context;

  if (context.setup === 'RANGE_REVERSION') {
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

  if (context.action !== 'ENTER') return [...reasons];

  if (!context.usesClosedPrimaryCandle) reasons.add('PRIMARY_CANDLE_NOT_CLOSED');
  if (!context.triggerConfirmed) reasons.add('ENTRY_TRIGGER_NOT_CONFIRMED');
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
