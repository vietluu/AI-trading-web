export type GateStage =
  | 'SIGNAL_FILTER'
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
  return hit?.reasonCodes[0]
    ? { stage: hit.stage, reason: hit.reasonCodes[0] }
    : undefined;
}
