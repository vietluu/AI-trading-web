export interface RecoveryOutcomeRecord {
  id: string;
  evaluationKey: string;
  symbol: string;
  provider: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  setup: string;
  cohortKey: string;
  status: string;
  isComplete: boolean;
  isSuperseded?: boolean;
  grossPnl: number | null;
  feeCost?: number | null;
  slippageCost?: number | null;
  fundingCost?: number | null;
  signedFees?: number | null;
  signedFunding?: number | null;
  netPnl: number | null;
  netR: number | null;
  mfe?: number | null;
  mae?: number | null;
  durationCandles?: number | null;
  terminalReason?: string | null;
  createdAt: string | Date;
}

export interface RecoveryEvaluationPolicy {
  minSampleSize?: number;
  confidenceLevelZ?: number;
  targetProfitFactor?: number;
}

export interface RecoveryExclusionCounts {
  duplicateCount: number;
  incompleteCount: number;
  supersededCount: number;
  corruptedCount: number;
  totalExcluded: number;
}

export interface RecoverySensitivityReport {
  doubledCostProfitFactor: number;
  doubledCostMeanNetR: number;
  doubledCostResilient: boolean;
}

export interface RecoveryCohortReport {
  sampleSize: number;
  winCount: number;
  lossCount: number;
  scratchCount: number;
  winRate: number;
  meanNetR: number;
  lowerConfidenceBoundNetR: number;
  profitFactor: number;
  grossProfit: number;
  grossLoss: number;
  maxDrawdown: number;
  averageMfe: number;
  averageMae: number;
  stopBeforeTargetRate: number;
  exclusions: RecoveryExclusionCounts;
  sensitivity: RecoverySensitivityReport;
}

export function evaluateRecoveryCohort(
  outcomes: RecoveryOutcomeRecord[],
  policy: RecoveryEvaluationPolicy = {},
): RecoveryCohortReport {
  const z = policy.confidenceLevelZ ?? 1.96;
  const exclusions: RecoveryExclusionCounts = {
    duplicateCount: 0,
    incompleteCount: 0,
    supersededCount: 0,
    corruptedCount: 0,
    totalExcluded: 0,
  };

  const seenEvaluationKeys = new Set<string>();
  const validRecords: RecoveryOutcomeRecord[] = [];

  for (const record of outcomes) {
    if (!record.evaluationKey) {
      exclusions.corruptedCount++;
      continue;
    }

    if (seenEvaluationKeys.has(record.evaluationKey)) {
      exclusions.duplicateCount++;
      continue;
    }

    if (!record.isComplete) {
      exclusions.incompleteCount++;
      continue;
    }

    if (record.isSuperseded) {
      exclusions.supersededCount++;
      continue;
    }

    if (
      record.grossPnl === null ||
      record.grossPnl === undefined ||
      !Number.isFinite(record.grossPnl) ||
      record.netPnl === null ||
      record.netPnl === undefined ||
      !Number.isFinite(record.netPnl) ||
      record.netR === null ||
      record.netR === undefined ||
      !Number.isFinite(record.netR)
    ) {
      exclusions.corruptedCount++;
      continue;
    }

    seenEvaluationKeys.add(record.evaluationKey);
    validRecords.push(record);
  }

  exclusions.totalExcluded =
    exclusions.duplicateCount +
    exclusions.incompleteCount +
    exclusions.supersededCount +
    exclusions.corruptedCount;

  const sampleSize = validRecords.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      winCount: 0,
      lossCount: 0,
      scratchCount: 0,
      winRate: 0,
      meanNetR: 0,
      lowerConfidenceBoundNetR: 0,
      profitFactor: 0,
      grossProfit: 0,
      grossLoss: 0,
      maxDrawdown: 0,
      averageMfe: 0,
      averageMae: 0,
      stopBeforeTargetRate: 0,
      exclusions,
      sensitivity: {
        doubledCostProfitFactor: 0,
        doubledCostMeanNetR: 0,
        doubledCostResilient: false,
      },
    };
  }

  let winCount = 0;
  let lossCount = 0;
  let scratchCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalNetR = 0;
  let totalMfe = 0;
  let totalMae = 0;
  let stopCount = 0;
  let targetCount = 0;

  let cumPnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;

  let doubledCostGrossProfit = 0;
  let doubledCostGrossLoss = 0;
  let doubledCostTotalNetR = 0;

  for (const record of validRecords) {
    const netPnl = record.netPnl!;
    const netR = record.netR!;

    totalNetR += netR;
    totalMfe += record.mfe ?? 0;
    totalMae += record.mae ?? 0;

    if (netR > 0) {
      winCount++;
    } else if (netR < 0) {
      lossCount++;
    } else {
      scratchCount++;
    }

    if (netPnl > 0) {
      grossProfit += netPnl;
    } else if (netPnl < 0) {
      grossLoss += Math.abs(netPnl);
    }

    if (record.terminalReason === 'STOP_LOSS') {
      stopCount++;
    } else if (record.terminalReason === 'TAKE_PROFIT') {
      targetCount++;
    }

    cumPnl += netPnl;
    if (cumPnl > peakPnl) {
      peakPnl = cumPnl;
    }
    const currentDrawdown = peakPnl - cumPnl;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    const fee = record.feeCost ?? (record.signedFees !== undefined && record.signedFees !== null ? Math.abs(record.signedFees) : 0);
    const slippage = record.slippageCost ?? 0;
    const funding = record.fundingCost ?? (record.signedFunding !== undefined && record.signedFunding !== null ? Math.abs(record.signedFunding) : 0);
    const totalCosts = fee + slippage + funding;

    const doubledNetPnl = record.grossPnl! - 2 * totalCosts;
    if (doubledNetPnl > 0) {
      doubledCostGrossProfit += doubledNetPnl;
    } else if (doubledNetPnl < 0) {
      doubledCostGrossLoss += Math.abs(doubledNetPnl);
    }
    const initialRisk = netPnl !== 0 && netR !== 0 ? Math.abs(netPnl / netR) : 1;
    const doubledNetR = doubledNetPnl / initialRisk;
    doubledCostTotalNetR += doubledNetR;
  }

  const round = (val: number, d = 4): number =>
    Number(Math.round(Number(`${val}e${d}`)) + `e-${d}`);

  const winRate = round(winCount / sampleSize);
  const meanNetR = round(totalNetR / sampleSize);
  const profitFactor = round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0);

  let varianceSum = 0;
  for (const record of validRecords) {
    varianceSum += (record.netR! - meanNetR) ** 2;
  }
  const variance = sampleSize > 1 ? varianceSum / (sampleSize - 1) : 0;
  const standardError = Math.sqrt(variance) / Math.sqrt(sampleSize);
  const lowerConfidenceBoundNetR = round(meanNetR - z * standardError);

  const averageMfe = round(totalMfe / sampleSize);
  const averageMae = round(totalMae / sampleSize);

  const terminalTradesCount = stopCount + targetCount;
  const stopBeforeTargetRate = round(terminalTradesCount > 0 ? stopCount / terminalTradesCount : 0);

  const doubledCostProfitFactor = round(doubledCostGrossLoss > 0
    ? doubledCostGrossProfit / doubledCostGrossLoss
    : doubledCostGrossProfit > 0 ? 99 : 0);
  const doubledCostMeanNetR = round(doubledCostTotalNetR / sampleSize);
  const doubledCostResilient = doubledCostProfitFactor >= 1.0 && doubledCostMeanNetR > 0;

  return {
    sampleSize,
    winCount,
    lossCount,
    scratchCount,
    winRate,
    meanNetR,
    lowerConfidenceBoundNetR,
    profitFactor,
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    maxDrawdown: round(maxDrawdown),
    averageMfe,
    averageMae,
    stopBeforeTargetRate,
    exclusions,
    sensitivity: {
      doubledCostProfitFactor,
      doubledCostMeanNetR,
      doubledCostResilient,
    },
  };
}

