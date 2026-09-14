export type RecoveryState =
  | 'RANGING'
  | 'LIQUIDITY_SWEEP'
  | 'RECLAIM_PENDING'
  | 'MOMENTUM_CONFIRMED'
  | 'BREAKOUT'
  | 'TRENDING'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'TOO_LATE';

export type RecoveryTransitionReasonCode =
  | 'DUPLICATE_CANDLE_CUTOFF'
  | 'TERMINAL_STATE'
  | 'RECOVERY_EXPIRED'
  | 'OPPOSITE_STRUCTURAL_BREAK'
  | 'CONTRADICTORY_EVENT'
  | 'PRICE_BEYOND_CHASE_LIMIT'
  | 'CANDLE_UNFINISHED'
  | 'INSUFFICIENT_EXPECTED_R'
  | 'LIQUIDITY_SWEEP_CONFIRMED'
  | 'RECLAIM_LEVEL_APPROACHING'
  | 'RECLAIM_MOMENTUM_CONFIRMED'
  | 'CONDITIONS_UNCHANGED';

export interface ClosedCandleState {
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
}

export interface RecoveryEvaluationInput {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  sourceDataCutoff: Date;
  now: Date;
  expiresAt: Date;
  currentPrice: number;
  atr: number;
  persistedSupport: number;
  persistedResistance: number;
  emaReclaimLevel: number;
  closedCandle: ClosedCandleState;
  hasOppositeBreak: boolean;
  maxChaseAtr: number;
  expectedNetR: number;
  hasContradictoryEvent: boolean;
  minimumExpectedNetR?: number;
}

export interface RecoveryObservation {
  state: RecoveryState;
  direction: 'LONG' | 'SHORT';
  lastObservedCutoff: Date | null;
  invalidationPrice: number | null;
  reclaimPrice: number | null;
}

export interface RecoveryEvidence {
  sweptLevel?: number;
  reclaimLevel?: number;
  chaseDistanceAtr?: number;
  expectedNetR?: number;
  isClosedCandle: boolean;
}

export interface RecoveryTransitionResult {
  changed: boolean;
  fromState: RecoveryState;
  toState: RecoveryState;
  reasonCode: RecoveryTransitionReasonCode;
  sourceDataCutoff: Date;
  evidence: RecoveryEvidence;
}

const TERMINAL_STATES = new Set<RecoveryState>([
  'INVALIDATED',
  'EXPIRED',
  'TOO_LATE',
  'BREAKOUT',
  'TRENDING',
]);

export function evaluateRecoveryTransition(
  current: RecoveryObservation,
  input: RecoveryEvaluationInput,
): RecoveryTransitionResult {
  const sourceCutoff = new Date(input.sourceDataCutoff);
  const evidence: RecoveryEvidence = {
    sweptLevel: current.direction === 'LONG' ? input.persistedSupport : input.persistedResistance,
    reclaimLevel: input.emaReclaimLevel,
    expectedNetR: input.expectedNetR,
    isClosedCandle: input.closedCandle.isClosed,
  };

  const makeResult = (
    toState: RecoveryState,
    reasonCode: RecoveryTransitionReasonCode,
  ): RecoveryTransitionResult => ({
    changed: toState !== current.state,
    fromState: current.state,
    toState,
    reasonCode,
    sourceDataCutoff: sourceCutoff,
    evidence,
  });

  if (TERMINAL_STATES.has(current.state)) {
    return makeResult(current.state, 'TERMINAL_STATE');
  }

  if (
    current.lastObservedCutoff !== null &&
    sourceCutoff.getTime() <= current.lastObservedCutoff.getTime()
  ) {
    return makeResult(current.state, 'DUPLICATE_CANDLE_CUTOFF');
  }

  if (input.now.getTime() >= input.expiresAt.getTime()) {
    return makeResult('EXPIRED', 'RECOVERY_EXPIRED');
  }

  if (input.hasOppositeBreak) {
    return makeResult('INVALIDATED', 'OPPOSITE_STRUCTURAL_BREAK');
  }

  if (input.hasContradictoryEvent) {
    return makeResult('INVALIDATED', 'CONTRADICTORY_EVENT');
  }

  const isLong = current.direction === 'LONG';
  const candle = input.closedCandle;
  const reclaimLevel = input.emaReclaimLevel;
  const chaseDist = isLong
    ? (input.currentPrice - reclaimLevel) / Math.max(input.atr, 1e-6)
    : (reclaimLevel - input.currentPrice) / Math.max(input.atr, 1e-6);
  evidence.chaseDistanceAtr = Math.max(0, chaseDist);

  // Invalidation against structural extremes
  if (current.invalidationPrice !== null) {
    if (isLong && input.currentPrice < current.invalidationPrice) {
      return makeResult('INVALIDATED', 'OPPOSITE_STRUCTURAL_BREAK');
    }
    if (!isLong && input.currentPrice > current.invalidationPrice) {
      return makeResult('INVALIDATED', 'OPPOSITE_STRUCTURAL_BREAK');
    }
  }

  // 1. From RANGING -> LIQUIDITY_SWEEP
  if (current.state === 'RANGING') {
    if (isLong) {
      const swept = candle.low < input.persistedSupport && candle.close >= input.persistedSupport;
      if (swept && candle.isClosed) {
        return makeResult('LIQUIDITY_SWEEP', 'LIQUIDITY_SWEEP_CONFIRMED');
      }
    } else {
      const swept = candle.high > input.persistedResistance && candle.close <= input.persistedResistance;
      if (swept && candle.isClosed) {
        return makeResult('LIQUIDITY_SWEEP', 'LIQUIDITY_SWEEP_CONFIRMED');
      }
    }
    return makeResult(current.state, 'CONDITIONS_UNCHANGED');
  }

  // 2. From LIQUIDITY_SWEEP -> RECLAIM_PENDING
  if (current.state === 'LIQUIDITY_SWEEP') {
    if (isLong) {
      if (candle.close >= input.persistedSupport && candle.close < reclaimLevel) {
        return makeResult('RECLAIM_PENDING', 'RECLAIM_LEVEL_APPROACHING');
      }
      // If candle already closed above reclaim level, one step advance goes to RECLAIM_PENDING first
      if (candle.close >= reclaimLevel) {
        return makeResult('RECLAIM_PENDING', 'RECLAIM_LEVEL_APPROACHING');
      }
    } else {
      if (candle.close <= input.persistedResistance && candle.close > reclaimLevel) {
        return makeResult('RECLAIM_PENDING', 'RECLAIM_LEVEL_APPROACHING');
      }
      if (candle.close <= reclaimLevel) {
        return makeResult('RECLAIM_PENDING', 'RECLAIM_LEVEL_APPROACHING');
      }
    }
    return makeResult(current.state, 'CONDITIONS_UNCHANGED');
  }

  // 3. From RECLAIM_PENDING -> MOMENTUM_CONFIRMED
  if (current.state === 'RECLAIM_PENDING') {
    if (!candle.isClosed) {
      return makeResult(current.state, 'CANDLE_UNFINISHED');
    }

    if (evidence.chaseDistanceAtr > input.maxChaseAtr) {
      return makeResult('TOO_LATE', 'PRICE_BEYOND_CHASE_LIMIT');
    }

    const minExpectedR = input.minimumExpectedNetR ?? 1.0;
    if (input.expectedNetR < minExpectedR) {
      return makeResult(current.state, 'INSUFFICIENT_EXPECTED_R');
    }

    if (isLong) {
      if (candle.close >= reclaimLevel) {
        return makeResult('MOMENTUM_CONFIRMED', 'RECLAIM_MOMENTUM_CONFIRMED');
      }
    } else {
      if (candle.close <= reclaimLevel) {
        return makeResult('MOMENTUM_CONFIRMED', 'RECLAIM_MOMENTUM_CONFIRMED');
      }
    }

    return makeResult(current.state, 'CONDITIONS_UNCHANGED');
  }

  return makeResult(current.state, 'CONDITIONS_UNCHANGED');
}
