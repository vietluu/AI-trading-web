import type { DecisionOutput } from '@platform/shared';

import {
  validateSetupLocation,
  type SetupLocationValidationReason,
} from './execution-context';

export type ExecutionReadinessReason =
  | 'DECISION_IS_WAIT'
  | 'ENTRY_ACTION_NOT_EXECUTABLE'
  | SetupLocationValidationReason;

export interface ExecutionReadinessResult {
  allowed: boolean;
  reasonCodes: ExecutionReadinessReason[];
}

function block(reason: ExecutionReadinessReason): ExecutionReadinessResult {
  return { allowed: false, reasonCodes: [reason] };
}

export function evaluateExecutionReadiness(
  decision: DecisionOutput,
): ExecutionReadinessResult {
  if (decision.decision === 'WAIT') return block('DECISION_IS_WAIT');

  const context = decision.executionContext;
  if (!context || !['ENTER', 'PROBE'].includes(context.action)) {
    return block('ENTRY_ACTION_NOT_EXECUTABLE');
  }
  if (!context.triggerConfirmed) return block('ENTRY_TRIGGER_NOT_CONFIRMED');
  if (!context.usesClosedPrimaryCandle) return block('PRIMARY_CANDLE_NOT_CLOSED');

  const reasons = validateSetupLocation(context, decision.decision);
  return reasons.length
    ? { allowed: false, reasonCodes: reasons }
    : { allowed: true, reasonCodes: [] };
}
