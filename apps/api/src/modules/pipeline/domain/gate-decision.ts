export type GateStage =
  | 'SIGNAL_FILTER'
  | 'EXECUTION_READINESS'
  | 'JUDGE'
  | 'QUANT'
  | 'MULTI_TIMEFRAME'
  | 'RISK'
  | 'EXECUTION';

export type GateDisposition = 'PASS' | 'ADVISORY' | 'REDUCE_SIZE' | 'BLOCK';

export interface GateDecisionRecord {
  stage: GateStage;
  disposition: GateDisposition;
  reasonCodes: string[];
  selectedBlockingReason?: string;
}

export function selectBlockingGate(records: GateDecisionRecord[]) {
  const hit = records.find((record) => record.disposition === 'BLOCK');
  if (!hit || !hit.reasonCodes[0]) return undefined;
  hit.selectedBlockingReason = hit.reasonCodes[0];
  return { stage: hit.stage, reason: hit.reasonCodes[0] };
}
