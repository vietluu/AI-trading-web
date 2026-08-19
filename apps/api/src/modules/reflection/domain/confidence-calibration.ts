export interface CalibrationRecord {
  confidence: number;
  outcome: 'CORRECT' | 'WRONG' | 'NEUTRAL';
}

export interface ReliabilityBucket {
  lower: number;
  upper: number;
  count: number;
  averageConfidence: number;
  observedAccuracy: number;
}

export function buildReliabilityCurve(records: CalibrationRecord[]): {
  sampleSize: number;
  brierScore: number | null;
  buckets: ReliabilityBucket[];
} {
  const directional = records.filter((record) => record.outcome !== 'NEUTRAL');
  const buckets = Array.from({ length: 10 }, (_, index) => {
    const lower = index * 10;
    const upper = lower + 10;
    const rows = directional.filter((record) =>
      record.confidence >= lower && (index === 9 ? record.confidence <= upper : record.confidence < upper));
    const correct = rows.filter((record) => record.outcome === 'CORRECT').length;
    return {
      lower,
      upper,
      count: rows.length,
      averageConfidence: rows.length ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length : 0,
      observedAccuracy: rows.length ? (correct + 2) / (rows.length + 4) : 0,
    };
  });
  const brierScore = directional.length
    ? directional.reduce((sum, record) => {
        const probability = Math.max(0, Math.min(1, record.confidence / 100));
        const actual = record.outcome === 'CORRECT' ? 1 : 0;
        return sum + (probability - actual) ** 2;
      }, 0) / directional.length
    : null;
  return { sampleSize: directional.length, brierScore, buckets };
}

export function calibrateConfidence(rawScore: number, records: CalibrationRecord[]) {
  const curve = buildReliabilityCurve(records);
  const bucket = curve.buckets.find((item) =>
    rawScore >= item.lower && (item.upper === 100 ? rawScore <= 100 : rawScore < item.upper));
  const ready = curve.sampleSize >= 50 && Boolean(bucket && bucket.count >= 20);
  return {
    status: ready ? 'CALIBRATED' as const : 'INSUFFICIENT_HISTORY' as const,
    rawScore,
    empiricalProbability: ready && bucket ? bucket.observedAccuracy : null,
    sampleSize: curve.sampleSize,
    bucketSampleSize: bucket?.count ?? 0,
    brierScore: curve.brierScore,
  };
}

export type CalibrationScope =
  | 'EXACT'
  | 'BLENDED'
  | 'STRATEGY_CONTEXT'
  | 'STRATEGY_TIMEFRAME'
  | 'USER_GLOBAL'
  | 'NONE';

export function calibrateConfidenceWithFallback(
  rawScore: number,
  scopes: Array<{ scope: Exclude<CalibrationScope, 'NONE'>; records: CalibrationRecord[] }>,
) {
  const evaluated = scopes.map((candidate) => ({
    ...candidate,
    calibration: calibrateConfidence(rawScore, candidate.records),
    curve: buildReliabilityCurve(candidate.records),
  }));
  const exact = evaluated.find((candidate) => candidate.scope === 'EXACT');
  if (exact?.calibration.status === 'CALIBRATED') {
    return { ...exact.calibration, scope: 'EXACT' as const, fallbackUsed: false, hardGateEligible: true };
  }
  const fallback = evaluated.find((candidate) =>
    candidate.scope !== 'EXACT' && candidate.calibration.status === 'CALIBRATED');
  const exactBucket = exact?.curve.buckets.find((item) =>
    rawScore >= item.lower && (item.upper === 100 ? rawScore <= 100 : rawScore < item.upper));
  // Blend a mature symbol bucket with its nearest calibrated parent instead
  // of discarding useful local evidence before the broad 50-sample threshold.
  if (exact && exactBucket && exactBucket.count >= 20 && fallback) {
    const exactWeight = Math.min(0.8, exactBucket.count / (exactBucket.count + 20));
    const fallbackProbability = fallback.calibration.empiricalProbability!;
    return {
      status: 'CALIBRATED' as const,
      rawScore,
      empiricalProbability: exactBucket.observedAccuracy * exactWeight + fallbackProbability * (1 - exactWeight),
      sampleSize: exact.curve.sampleSize,
      bucketSampleSize: exactBucket.count,
      brierScore: exact.curve.brierScore,
      scope: 'BLENDED' as const,
      fallbackUsed: true,
      hardGateEligible: true,
      exactProbability: exactBucket.observedAccuracy,
      fallbackProbability,
      fallbackScope: fallback.scope as Exclude<CalibrationScope, 'EXACT' | 'BLENDED' | 'NONE'>,
      exactWeight,
    };
  }
  if (fallback) {
    return { ...fallback.calibration, scope: fallback.scope, fallbackUsed: true, hardGateEligible: false };
  }
  let largest = scopes[0];
  for (const candidate of scopes) {
    if (!largest || candidate.records.length > largest.records.length) largest = candidate;
  }
  if (!largest || largest.records.length === 0) {
    return {
      ...calibrateConfidence(rawScore, []),
      scope: 'NONE' as const,
      fallbackUsed: false,
      hardGateEligible: false,
    };
  }
  const diagnostic = calibrateConfidence(rawScore, largest?.records ?? []);
  return {
    ...diagnostic,
    scope: largest.scope,
    fallbackUsed: Boolean(largest && largest.scope !== 'EXACT'),
    hardGateEligible: false,
  };
}
