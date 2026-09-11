import type { TradeLifecycleOutcome } from '../../research/domain/trade-lifecycle';

export type ModelPromotionStage =
  | 'OBSERVE'
  | 'SHADOW'
  | 'DEMO_CANARY'
  | 'ELIGIBLE'
  | 'APPROVED_LIVE_CANARY';

export interface PromotionThresholds {
  minSampleSize: number;
  minProfitFactor: number;
  minExpectancyNetR: number;
  maxDrawdownPct: number;
  maxProtectionFailures: number;
  maxChaseRate: number;
  minCohortStability: number;
  maxDriftScore: number;
}

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = Object.freeze({
  minSampleSize: 50,
  minProfitFactor: 1.3,
  minExpectancyNetR: 0.0,
  maxDrawdownPct: 10.0,
  maxProtectionFailures: 0,
  maxChaseRate: 0.25,
  minCohortStability: 0.60,
  maxDriftScore: 0.20,
});

export interface OperatorApprovalRecord {
  operatorId: string;
  approvedAt: Date | string;
  configurationHash: string;
  confirmed: boolean;
  notes?: string;
}

export interface LegacyFixedHorizonMetrics {
  accuracy?: number;
  sharpeRatio?: number;
  totalReturn?: number;
  tradesCount?: number;
}

export interface LifecyclePromotionMetrics {
  sampleSize: number;
  forwardSampleIds: string[];
  lifecycleExpectancyNetR: number;
  profitFactor: number;
  markToMarketDrawdownPct: number;
  chaseRate: number;
  cohortStabilityScore: number;
  protectionFailuresCount: number;
  modelDriftDetected?: boolean;
  driftScore?: number;
  trainingSampleIds?: string[];
  legacyFixedHorizon?: LegacyFixedHorizonMetrics;
}

export interface PromotionTransitionInput {
  currentStage: ModelPromotionStage;
  candidateVersion: number;
  configurationHash: string;
  metrics: LifecyclePromotionMetrics;
  thresholds?: Partial<PromotionThresholds>;
  operatorApproval?: OperatorApprovalRecord | null;
}

export interface PromotionTransitionResult {
  fromStage: ModelPromotionStage;
  toStage: ModelPromotionStage;
  candidateVersion: number;
  allowed: boolean;
  isRollback: boolean;
  reasons: string[];
  failures: string[];
  configurationHash?: string;
  headlineMetrics: {
    lifecycleExpectancyNetR: number;
    profitFactor: number;
    markToMarketDrawdownPct: number;
    chaseRate: number;
    cohortStabilityScore: number;
    sampleSize: number;
    protectionFailuresCount: number;
    legacyMetrics?: LegacyFixedHorizonMetrics;
  };
  evaluatedAt: string;
}

/**
 * Validates untouched forward sample IDs against contamination and duplication.
 */
function validateForwardSamples(
  forwardSampleIds: string[],
  trainingSampleIds?: string[],
): string[] {
  const failures: string[] = [];
  if (!forwardSampleIds || forwardSampleIds.length === 0) {
    failures.push('FORWARD_SAMPLE_EMPTY');
    return failures;
  }

  const seen = new Set<string>();
  let hasDuplicates = false;
  for (const id of forwardSampleIds) {
    if (seen.has(id)) {
      hasDuplicates = true;
      break;
    }
    seen.add(id);
  }
  if (hasDuplicates) {
    failures.push('FORWARD_SAMPLE_DUPLICATES');
  }

  if (trainingSampleIds && trainingSampleIds.length > 0) {
    const trainSet = new Set(trainingSampleIds);
    const hasOverlap = forwardSampleIds.some((id) => trainSet.has(id));
    if (hasOverlap) {
      failures.push('FORWARD_SAMPLE_CONTAMINATED');
    }
  }

  return failures;
}

/**
 * Evaluates core metric gates (sample size, expectancy, profit factor, drawdown, protection, drift, chase, cohort stability).
 */
function evaluateMetricGates(
  metrics: LifecyclePromotionMetrics,
  thresholds: PromotionThresholds,
): string[] {
  const failures: string[] = [];

  // 1. Untouched forward sample validation
  const sampleFailures = validateForwardSamples(
    metrics.forwardSampleIds,
    metrics.trainingSampleIds,
  );
  failures.push(...sampleFailures);

  // 2. Sample size gate
  if (metrics.sampleSize < thresholds.minSampleSize || metrics.forwardSampleIds.length < thresholds.minSampleSize) {
    failures.push('INSUFFICIENT_SAMPLE_SIZE');
  }

  // 3. Lifecycle expectancy (net R must be > minExpectancyNetR)
  if (!Number.isFinite(metrics.lifecycleExpectancyNetR) || metrics.lifecycleExpectancyNetR <= thresholds.minExpectancyNetR) {
    failures.push('NEGATIVE_OR_ZERO_EXPECTANCY');
  }

  // 4. Profit factor gate
  if (!Number.isFinite(metrics.profitFactor) || metrics.profitFactor < thresholds.minProfitFactor) {
    failures.push('PROFIT_FACTOR_BELOW_THRESHOLD');
  }

  // 5. Drawdown breach gate (mark-to-market drawdown ceiling)
  if (!Number.isFinite(metrics.markToMarketDrawdownPct) || metrics.markToMarketDrawdownPct > thresholds.maxDrawdownPct) {
    failures.push('DRAWDOWN_BREACH');
  }

  // 6. Mandatory protection gate (zero tolerance for missing stopLoss)
  if (metrics.protectionFailuresCount > thresholds.maxProtectionFailures) {
    failures.push('PROTECTION_FAILURE');
  }

  // 7. Model drift gate
  if (
    metrics.modelDriftDetected === true ||
    (typeof metrics.driftScore === 'number' && metrics.driftScore > thresholds.maxDriftScore)
  ) {
    failures.push('MODEL_DRIFT_DETECTED');
  }

  // 8. Chase rate ceiling
  if (typeof metrics.chaseRate === 'number' && metrics.chaseRate > thresholds.maxChaseRate) {
    failures.push('CHASE_RATE_EXCEEDS_CEILING');
  }

  // 9. Cohort stability gate
  if (typeof metrics.cohortStabilityScore === 'number' && metrics.cohortStabilityScore < thresholds.minCohortStability) {
    failures.push('COHORT_STABILITY_BELOW_THRESHOLD');
  }

  return failures;
}

/**
 * Evaluates state transitions across release stages:
 * OBSERVE -> SHADOW -> DEMO_CANARY -> ELIGIBLE -> APPROVED_LIVE_CANARY
 * Automatic rollback returns to SHADOW on failure or breach from any active/canary stage.
 */
export function evaluatePromotionTransition(
  input: PromotionTransitionInput,
): PromotionTransitionResult {
  const { currentStage, candidateVersion, configurationHash, metrics, operatorApproval } = input;
  const thresholds: PromotionThresholds = {
    ...DEFAULT_PROMOTION_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };

  const headlineMetrics = {
    lifecycleExpectancyNetR: metrics.lifecycleExpectancyNetR,
    profitFactor: metrics.profitFactor,
    markToMarketDrawdownPct: metrics.markToMarketDrawdownPct,
    chaseRate: metrics.chaseRate,
    cohortStabilityScore: metrics.cohortStabilityScore,
    sampleSize: metrics.sampleSize,
    protectionFailuresCount: metrics.protectionFailuresCount,
    legacyMetrics: metrics.legacyFixedHorizon,
  };

  const evaluatedAt = new Date().toISOString();
  const reasons: string[] = [];

  // Stage 1: OBSERVE -> SHADOW
  if (currentStage === 'OBSERVE') {
    const sampleFailures = validateForwardSamples(
      metrics.forwardSampleIds,
      metrics.trainingSampleIds,
    );
    if (sampleFailures.length > 0) {
      return {
        fromStage: 'OBSERVE',
        toStage: 'OBSERVE',
        candidateVersion,
        allowed: false,
        isRollback: false,
        reasons: ['Forward sample validation failed'],
        failures: sampleFailures,
        headlineMetrics,
        evaluatedAt,
      };
    }

    reasons.push(`Candidate v${candidateVersion} configuration and untouched forward samples initialized`);
    return {
      fromStage: 'OBSERVE',
      toStage: 'SHADOW',
      candidateVersion,
      allowed: true,
      isRollback: false,
      reasons,
      failures: [],
      configurationHash,
      headlineMetrics,
      evaluatedAt,
    };
  }

  // Check metric gates for stages beyond OBSERVE
  const metricFailures = evaluateMetricGates(metrics, thresholds);

  // Active / Canary stages rollback back to SHADOW on failure or breach
  const isCanaryOrEligibleOrLive = (
    currentStage === 'DEMO_CANARY' ||
    currentStage === 'ELIGIBLE' ||
    currentStage === 'APPROVED_LIVE_CANARY'
  );

  if (isCanaryOrEligibleOrLive && metricFailures.length > 0) {
    reasons.push('AUTOMATIC_ROLLBACK_TO_SHADOW');
    reasons.push(`Breached gates in ${currentStage}: ${metricFailures.join(', ')}`);
    return {
      fromStage: currentStage,
      toStage: 'SHADOW',
      candidateVersion,
      allowed: false,
      isRollback: true,
      reasons,
      failures: metricFailures,
      configurationHash,
      headlineMetrics,
      evaluatedAt,
    };
  }

  // Stage 2: SHADOW -> DEMO_CANARY
  if (currentStage === 'SHADOW') {
    if (metricFailures.length > 0) {
      return {
        fromStage: 'SHADOW',
        toStage: 'SHADOW',
        candidateVersion,
        allowed: false,
        isRollback: false,
        reasons: [`Promotion to DEMO_CANARY blocked by ${metricFailures.length} failing gate(s)`],
        failures: metricFailures,
        configurationHash,
        headlineMetrics,
        evaluatedAt,
      };
    }

    reasons.push('Shadow lifecycle performance verified across all promotion gates');
    return {
      fromStage: 'SHADOW',
      toStage: 'DEMO_CANARY',
      candidateVersion,
      allowed: true,
      isRollback: false,
      reasons,
      failures: [],
      configurationHash,
      headlineMetrics,
      evaluatedAt,
    };
  }

  // Stage 3: DEMO_CANARY -> ELIGIBLE
  if (currentStage === 'DEMO_CANARY') {
    reasons.push('Demo canary execution passed all gates; candidate configuration frozen for review');
    return {
      fromStage: 'DEMO_CANARY',
      toStage: 'ELIGIBLE',
      candidateVersion,
      allowed: true,
      isRollback: false,
      reasons,
      failures: [],
      configurationHash,
      headlineMetrics,
      evaluatedAt,
    };
  }

  // Stage 4: ELIGIBLE -> APPROVED_LIVE_CANARY
  if (currentStage === 'ELIGIBLE') {
    const approvalFailures: string[] = [];
    if (!operatorApproval) {
      approvalFailures.push('OPERATOR_APPROVAL_REQUIRED');
    } else {
      if (operatorApproval.confirmed !== true) {
        approvalFailures.push('OPERATOR_APPROVAL_NOT_CONFIRMED');
      }
      if (operatorApproval.configurationHash !== configurationHash) {
        approvalFailures.push('OPERATOR_APPROVAL_HASH_MISMATCH');
      }
    }

    if (approvalFailures.length > 0) {
      return {
        fromStage: 'ELIGIBLE',
        toStage: 'ELIGIBLE',
        candidateVersion,
        allowed: false,
        isRollback: false,
        reasons: ['Transition to APPROVED_LIVE_CANARY requires explicit operator approval'],
        failures: approvalFailures,
        configurationHash,
        headlineMetrics,
        evaluatedAt,
      };
    }

    reasons.push('Explicit operator approval verified against frozen configuration hash');
    return {
      fromStage: 'ELIGIBLE',
      toStage: 'APPROVED_LIVE_CANARY',
      candidateVersion,
      allowed: true,
      isRollback: false,
      reasons,
      failures: [],
      configurationHash,
      headlineMetrics,
      evaluatedAt,
    };
  }

  // Stage 5: APPROVED_LIVE_CANARY (steady state health check)
  return {
    fromStage: 'APPROVED_LIVE_CANARY',
    toStage: 'APPROVED_LIVE_CANARY',
    candidateVersion,
    allowed: true,
    isRollback: false,
    reasons: ['Live canary operating within verified risk thresholds'],
    failures: [],
    configurationHash,
    headlineMetrics,
    evaluatedAt,
  };
}

export interface CalculateLifecycleHeadlineOptions {
  legacyHorizonRecords?: Array<{ outcome: string; returnPct: number }>;
  initialCapital?: number;
}

/**
 * Calculates lifecycle headline metrics (expectancy, profit factor, mark-to-market drawdown,
 * chase rate, cohort stability, protection failures) from finalized TradeLifecycleOutcome records.
 * Keeps legacy fixed-horizon metrics labeled separately during migration.
 */
export function calculateLifecycleHeadlineMetrics(
  outcomes: TradeLifecycleOutcome[],
  options?: CalculateLifecycleHeadlineOptions,
): LifecyclePromotionMetrics {
  const sampleSize = outcomes.length;
  const forwardSampleIds = outcomes.map((o) => o.thesisId || o.id || '');

  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      forwardSampleIds: [],
      lifecycleExpectancyNetR: 0,
      profitFactor: 0,
      markToMarketDrawdownPct: 0,
      chaseRate: 0,
      cohortStabilityScore: 1.0,
      protectionFailuresCount: 0,
      modelDriftDetected: false,
      driftScore: 0,
      legacyFixedHorizon: options?.legacyHorizonRecords
        ? calculateLegacyHorizon(options.legacyHorizonRecords)
        : undefined,
    };
  }

  // 1. Lifecycle expectancy in net R
  const validNetR = outcomes
    .map((o) => (typeof o.netR === 'number' ? o.netR : null))
    .filter((r): r is number => r !== null && Number.isFinite(r));
  const lifecycleExpectancyNetR = validNetR.length > 0
    ? validNetR.reduce((sum, r) => sum + r, 0) / validNetR.length
    : 0;

  // 2. Profit Factor from realized net PnL
  let grossProfit = 0;
  let grossLoss = 0;
  for (const o of outcomes) {
    const net = Number(o.realizedNetPnl);
    if (net > 0) grossProfit += net;
    else if (net < 0) grossLoss += Math.abs(net);
  }
  const profitFactor = grossLoss > 0
    ? grossProfit / grossLoss
    : grossProfit > 0
      ? 99
      : 0;

  // 3. Mark-to-market drawdown % (percentage drawdown relative to initial/peak equity curve or reported intra-trade mark drawdown %)
  const initialCapital = options?.initialCapital && options.initialCapital > 0
    ? options.initialCapital
    : 10_000;
  let currentEquity = initialCapital;
  let peakEquity = initialCapital;
  let maxCumulativeDrawdownPct = 0;
  let maxReportedMarkDrawdownPct = 0;

  for (const o of outcomes) {
    currentEquity += Number(o.realizedNetPnl);
    peakEquity = Math.max(peakEquity, currentEquity);
    if (peakEquity > 0) {
      const dropPct = ((peakEquity - currentEquity) / peakEquity) * 100;
      maxCumulativeDrawdownPct = Math.max(maxCumulativeDrawdownPct, dropPct);
    }

    const m = o.metadata;
    const reportedDd = typeof m?.maxDrawdownPct === 'number'
      ? m.maxDrawdownPct
      : typeof m?.markToMarketDrawdownPct === 'number'
        ? m.markToMarketDrawdownPct
        : null;
    if (reportedDd !== null && Number.isFinite(reportedDd)) {
      maxReportedMarkDrawdownPct = Math.max(maxReportedMarkDrawdownPct, reportedDd);
    }
  }
  const markToMarketDrawdownPct = Math.max(maxCumulativeDrawdownPct, maxReportedMarkDrawdownPct);

  // 4. Chase rate (fraction of trades entering on chase)
  const chaseCount = outcomes.filter((o) => {
    const m = o.metadata;
    return m?.isChase === true || o.setup === 'CHASE';
  }).length;
  const chaseRate = sampleSize > 0 ? chaseCount / sampleSize : 0;

  // 5. Protection failures count (any omitted mandatory stopLoss)
  const protectionFailuresCount = outcomes.filter((o) => {
    const m = o.metadata;
    if (m?.omittedStopLoss === true) return true;
    return o.finalStopLoss == null && (m?.stopLoss == null);
  }).length;

  // 6. Cohort stability score
  // Measure stability across unique cohort keys (e.g. BTCUSDT|1h|BULL|...)
  const cohortGroups: Record<string, number[]> = {};
  for (const o of outcomes) {
    const m = o.metadata;
    const key = (typeof m?.cohortKey === 'string' ? m.cohortKey : null) || `${o.symbol}|${o.timeframe}|${o.setup || 'DEFAULT'}`;
    cohortGroups[key] = cohortGroups[key] || [];
    if (typeof o.netR === 'number') {
      cohortGroups[key].push(o.netR);
    }
  }

  const cohortAvgs = Object.values(cohortGroups)
    .filter((arr) => arr.length > 0)
    .map((arr) => arr.reduce((a, b) => a + b, 0) / arr.length);

  let cohortStabilityScore = 1.0;
  if (cohortAvgs.length > 1) {
    const mean = cohortAvgs.reduce((a, b) => a + b, 0) / cohortAvgs.length;
    const variance = cohortAvgs.reduce((sum, val) => sum + (val - mean) ** 2, 0) / cohortAvgs.length;
    // Higher variance -> lower stability score, scaled to (0, 1]
    cohortStabilityScore = Number((1 / (1 + Math.sqrt(variance))).toFixed(4));
  }

  // 7. Legacy fixed-horizon metrics labeled separately
  const legacyFixedHorizon = options?.legacyHorizonRecords
    ? calculateLegacyHorizon(options.legacyHorizonRecords)
    : undefined;

  return {
    sampleSize,
    forwardSampleIds,
    lifecycleExpectancyNetR: Number(lifecycleExpectancyNetR.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(4)),
    markToMarketDrawdownPct: Number(markToMarketDrawdownPct.toFixed(4)),
    chaseRate: Number(chaseRate.toFixed(4)),
    cohortStabilityScore,
    protectionFailuresCount,
    modelDriftDetected: false,
    driftScore: 0,
    legacyFixedHorizon,
  };
}

function calculateLegacyHorizon(
  rows: Array<{ outcome: string; returnPct: number }>,
): LegacyFixedHorizonMetrics {
  const tradesCount = rows.length;
  if (tradesCount === 0) {
    return { accuracy: 0, sharpeRatio: 0, totalReturn: 0, tradesCount: 0 };
  }
  const correct = rows.filter((r) => r.outcome === 'CORRECT').length;
  const accuracy = Number(((correct / tradesCount) * 100).toFixed(2));
  const totalReturn = Number(rows.reduce((sum, r) => sum + r.returnPct, 0).toFixed(4));
  const meanReturn = totalReturn / tradesCount;
  const variance = tradesCount > 1
    ? rows.reduce((sum, r) => sum + (r.returnPct - meanReturn) ** 2, 0) / (tradesCount - 1)
    : 0;
  const sd = Math.sqrt(variance);
  const sharpeRatio = sd > 0 ? Number(((meanReturn / sd) * Math.sqrt(tradesCount)).toFixed(4)) : 0;

  return { accuracy, sharpeRatio, totalReturn, tradesCount };
}
