export type ExperimentType =
  | 'PROMPT'
  | 'THRESHOLD'
  | 'INDICATOR'
  | 'AGENT'
  | 'WEIGHT'
  | 'STRATEGY';

export interface SimulationRequest {
  name: string;
  experimentType: ExperimentType;
  config: Record<string, unknown>;
}

export interface SimulationResult {
  name: string;
  experimentType: ExperimentType;
  passedCriteria: boolean;
  baselineExpectedValue: number;
  simulatedExpectedValue: number;
  baselineSharpe: number;
  simulatedSharpe: number;
  baselineMaxDrawdownPct: number;
  simulatedMaxDrawdownPct: number;
  pValuetest: number;
  summary: string;
}

