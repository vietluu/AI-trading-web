import type { DecisionInput, DecisionOutput, DecisionRunInput, FusionInput } from '@platform/shared';
import type { AgentInvocationSource } from '../../domain/enums';

export type AnalystName = keyof FusionInput;
export type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type ConflictLevel = DecisionOutput['conflictLevel'];
export type Weighting = DecisionOutput['weighting'];

export interface RunDecisionOptions {
  input: DecisionRunInput;
  userId?: string;
  sessionId?: string;
  invocationSource: AgentInvocationSource;
  correlationId?: string;
}
