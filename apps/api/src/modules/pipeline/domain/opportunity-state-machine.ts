import type {
  AnticipatoryMarketSnapshot,
  OpportunityState,
} from '@platform/shared';
import type {
  PersistedThesisEntryAction,
  PersistedThesisEntryDecision,
  PersistedThesisEntryReasonCode,
} from '../../risk/domain/thesis-execution';

export const OPPORTUNITY_WATCHER_POLICY = Object.freeze({
  minimumSqueezeDurationCandles: 3,
  maximumWatchDistanceAtr: 1.5,
  maximumProbeDistanceAtr: 0.75,
  maximumInvalidationDistanceAtr: 1,
  minimumProbeEvidenceGroups: 2,
  minimumDerivativesSqueezeProbability: 65,
  opportunityTtlMs: 4 * 60 * 60 * 1_000,
});

export type OpportunitySetup =
  | 'RANGE_REVERSAL'
  | 'LIQUIDITY_SWEEP_REVERSAL'
  | 'RECOVERY_RECLAIM'
  | 'SQUEEZE_PROBE'
  | 'BREAKOUT_RETEST'
  | 'TREND_PULLBACK';

export type OpportunityDirection = 'LONG' | 'SHORT' | 'WAIT';

export type OpportunityTransitionReasonCode =
  | 'DUPLICATE_CANDLE_CUTOFF'
  | 'TERMINAL_STATE'
  | 'OPPORTUNITY_EXPIRED'
  | 'CORE_EVIDENCE_INELIGIBLE'
  | 'STRUCTURAL_INVALIDATION'
  | 'PRICE_BEYOND_CHASE_LIMIT'
  | 'SQUEEZE_SETUP_FORMING'
  | 'LIQUIDITY_SWEEP_SETUP_FORMING'
  | 'RANGE_BOUNDARY_SETUP_FORMING'
  | 'BREAKOUT_SETUP_FORMING'
  | 'PROBE_ALIGNMENT_CONFIRMED'
  | 'PERSISTED_THESIS_ENTRY_READY'
  | 'PERSISTED_THESIS_ENTRY_WAITING'
  | 'PERSISTED_THESIS_ENTRY_TOO_LATE'
  | 'PERSISTED_THESIS_ENTRY_EXPIRED'
  | 'PERSISTED_THESIS_ENTRY_INVALIDATED'
  | 'CONDITIONS_UNCHANGED';

export interface OpportunityObservationState {
  state: OpportunityState;
  setup: OpportunitySetup;
  direction: OpportunityDirection;
  invalidationPrice: number | null;
  expiresAt: Date;
  lastObservedCutoff: Date | null;
}

export interface OpportunityTransition {
  changed: boolean;
  fromState: OpportunityState;
  toState: OpportunityState;
  reasonCode: OpportunityTransitionReasonCode;
  sourceDataCutoff: Date;
  entryAction?: PersistedThesisEntryAction;
  entryReasonCode?: PersistedThesisEntryReasonCode;
}

const TERMINAL_STATES = new Set<OpportunityState>([
  'INVALIDATED',
  'EXPIRED',
  'TOO_LATE',
]);

function result(
  current: OpportunityObservationState,
  sourceDataCutoff: Date,
  toState: OpportunityState,
  reasonCode: OpportunityTransitionReasonCode,
): OpportunityTransition {
  return {
    changed: current.state !== toState,
    fromState: current.state,
    toState,
    reasonCode,
    sourceDataCutoff,
  };
}

/**
 * Carries the deterministic entry result into the persisted opportunity
 * lifecycle without re-evaluating AI or changing its declared geometry.
 */
export function transitionPersistedThesisEntry(
  current: OpportunityObservationState,
  sourceDataCutoff: Date,
  decision: PersistedThesisEntryDecision,
): OpportunityTransition {
  const target = decision.action === 'ENTER'
    ? 'PROBE_READY'
    : decision.action === 'TOO_LATE'
      ? 'TOO_LATE'
      : decision.action === 'EXPIRED'
        ? 'EXPIRED'
        : decision.action === 'INVALIDATED'
          ? 'INVALIDATED'
          : current.state;
  const reasonCode = decision.action === 'ENTER'
    ? 'PERSISTED_THESIS_ENTRY_READY'
    : decision.action === 'TOO_LATE'
      ? 'PERSISTED_THESIS_ENTRY_TOO_LATE'
      : decision.action === 'EXPIRED'
        ? 'PERSISTED_THESIS_ENTRY_EXPIRED'
        : decision.action === 'INVALIDATED'
          ? 'PERSISTED_THESIS_ENTRY_INVALIDATED'
          : 'PERSISTED_THESIS_ENTRY_WAITING';
  return {
    ...result(current, sourceDataCutoff, target, reasonCode),
    entryAction: decision.action,
    entryReasonCode: decision.reasonCode,
  };
}

function isStructurallyInvalidated(
  current: OpportunityObservationState,
  snapshot: AnticipatoryMarketSnapshot,
): boolean {
  if (
    current.invalidationPrice === null ||
    current.direction === 'WAIT' ||
    snapshot.execution.coverage !== 'AVAILABLE'
  ) return false;

  return current.direction === 'LONG'
    ? snapshot.execution.currentPrice <= current.invalidationPrice
    : snapshot.execution.currentPrice >= current.invalidationPrice;
}

function formingReason(
  current: OpportunityObservationState,
  snapshot: AnticipatoryMarketSnapshot,
): OpportunityTransitionReasonCode | undefined {
  if (snapshot.structure.coverage !== 'AVAILABLE') return undefined;

  if (
    current.setup === 'BREAKOUT_RETEST' &&
    snapshot.volatility.coverage === 'AVAILABLE' &&
    (snapshot.volatility.expansionState === 'EXPANDING' ||
      snapshot.volatility.expansionState === 'EXPANDED')
  ) {
    return 'BREAKOUT_SETUP_FORMING';
  }

  if (
    snapshot.structure.distanceToNearestBoundaryAtr >
      OPPORTUNITY_WATCHER_POLICY.maximumWatchDistanceAtr
  ) return undefined;

  if (
    current.setup === 'SQUEEZE_PROBE' &&
    snapshot.volatility.coverage === 'AVAILABLE' &&
    snapshot.volatility.squeezeState === 'SQUEEZING' &&
    snapshot.volatility.squeezeDurationCandles >=
      OPPORTUNITY_WATCHER_POLICY.minimumSqueezeDurationCandles
  ) return 'SQUEEZE_SETUP_FORMING';

  if (
    current.setup === 'LIQUIDITY_SWEEP_REVERSAL' &&
    snapshot.structure.liquiditySweep.coverage === 'AVAILABLE' &&
    snapshot.structure.liquiditySweep.detected &&
    snapshot.structure.liquiditySweep.reclaimed
  ) return 'LIQUIDITY_SWEEP_SETUP_FORMING';

  if (
    current.setup === 'RANGE_REVERSAL' &&
    snapshot.structure.distanceToNearestBoundaryAtr <=
      OPPORTUNITY_WATCHER_POLICY.maximumProbeDistanceAtr
  ) return 'RANGE_BOUNDARY_SETUP_FORMING';

  return undefined;
}

function probeIsReady(
  current: OpportunityObservationState,
  snapshot: AnticipatoryMarketSnapshot,
): boolean {
  if (
    current.direction === 'WAIT' ||
    current.invalidationPrice === null ||
    snapshot.structure.coverage !== 'AVAILABLE' ||
    snapshot.volatility.coverage !== 'AVAILABLE' ||
    snapshot.execution.coverage !== 'AVAILABLE'
  ) return false;

  if (
    current.setup !== 'BREAKOUT_RETEST' &&
    snapshot.structure.distanceToNearestBoundaryAtr >
      OPPORTUNITY_WATCHER_POLICY.maximumProbeDistanceAtr
  ) return false;

  const invalidationDistanceAtr = Math.abs(
    snapshot.execution.currentPrice - current.invalidationPrice,
  ) / snapshot.volatility.atr;
  if (
    invalidationDistanceAtr >
    OPPORTUNITY_WATCHER_POLICY.maximumInvalidationDistanceAtr * 1.5
  ) return false;

  const evidenceGroups = [
    snapshot.momentum?.coverage === 'AVAILABLE' &&
      snapshot.momentum.momentumState === 'ACCELERATING',
    snapshot.participation?.coverage === 'AVAILABLE' &&
      snapshot.participation.volumeState === 'EXPANDING',
    snapshot.derivatives?.coverage === 'AVAILABLE' &&
      snapshot.derivatives.derivativesImbalance?.coverage === 'AVAILABLE' &&
      snapshot.derivatives.derivativesImbalance.squeezeDirection !== 'NONE' &&
      snapshot.derivatives.derivativesImbalance.squeezeProbability >=
        OPPORTUNITY_WATCHER_POLICY.minimumDerivativesSqueezeProbability,
    snapshot.structure?.liquiditySweep?.coverage === 'AVAILABLE' &&
      snapshot.structure.liquiditySweep.detected &&
      snapshot.structure.liquiditySweep.reclaimed,
    current.setup === 'BREAKOUT_RETEST' &&
      (snapshot.volatility?.expansionState === 'EXPANDING' ||
        snapshot.volatility?.expansionState === 'EXPANDED'),
  ].filter(Boolean).length;

  return evidenceGroups >= OPPORTUNITY_WATCHER_POLICY.minimumProbeEvidenceGroups;
}



export function transitionOpportunity(
  current: OpportunityObservationState,
  snapshot: AnticipatoryMarketSnapshot,
  now: Date,
): OpportunityTransition {
  const sourceDataCutoff = new Date(snapshot.sourceDataCutoff);
  if (!Number.isFinite(sourceDataCutoff.getTime())) {
    throw new Error('snapshot sourceDataCutoff must be a valid timestamp');
  }

  if (TERMINAL_STATES.has(current.state)) {
    return result(current, sourceDataCutoff, current.state, 'TERMINAL_STATE');
  }
  if (
    current.lastObservedCutoff !== null &&
    sourceDataCutoff <= current.lastObservedCutoff
  ) {
    return result(
      current,
      sourceDataCutoff,
      current.state,
      'DUPLICATE_CANDLE_CUTOFF',
    );
  }
  if (now >= current.expiresAt) {
    return result(current, sourceDataCutoff, 'EXPIRED', 'OPPORTUNITY_EXPIRED');
  }
  if (snapshot.eligibility.status === 'INELIGIBLE') {
    return result(
      current,
      sourceDataCutoff,
      'INVALIDATED',
      'CORE_EVIDENCE_INELIGIBLE',
    );
  }
  if (isStructurallyInvalidated(current, snapshot)) {
    return result(
      current,
      sourceDataCutoff,
      'INVALIDATED',
      'STRUCTURAL_INVALIDATION',
    );
  }
  if (
    snapshot.execution.coverage === 'AVAILABLE' &&
    snapshot.execution.priceTooFarFromCandidateZones
  ) {
    return result(
      current,
      sourceDataCutoff,
      'TOO_LATE',
      'PRICE_BEYOND_CHASE_LIMIT',
    );
  }
  if (current.state === 'OBSERVING') {
    const reason = formingReason(current, snapshot);
    if (reason !== undefined) {
      return result(current, sourceDataCutoff, 'WATCHING', reason);
    }
  }
  if (current.state === 'WATCHING' && probeIsReady(current, snapshot)) {
    return result(
      current,
      sourceDataCutoff,
      'PROBE_READY',
      'PROBE_ALIGNMENT_CONFIRMED',
    );
  }
  return result(
    current,
    sourceDataCutoff,
    current.state,
    'CONDITIONS_UNCHANGED',
  );
}
