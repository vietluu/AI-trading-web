import type { TradeLifecycleOutcome } from '../../research/domain/trade-lifecycle';

export interface ThesisCohortKeyParams {
  symbol: string;
  timeframe: string;
  regime: string;
  direction: string;
  setup: string;
  executionPolicyVersion: string;
  configurationHash?: string;
}

/**
 * Builds standard cohort key:
 * symbol|timeframe|regime|direction|setup|executionPolicyVersion[|configurationHash]
 */
export function buildThesisCohortKey(params: ThesisCohortKeyParams): string {
  const base = `${params.symbol}|${params.timeframe}|${params.regime}|${params.direction}|${params.setup}|${params.executionPolicyVersion}`;
  return params.configurationHash ? `${base}|${params.configurationHash}` : base;
}

/**
 * Parses a standard cohort key string back into its parameters.
 */
export function parseThesisCohortKey(key: string): ThesisCohortKeyParams {
  const parts = key.split('|');
  if (parts.length !== 6 && parts.length !== 7) {
    throw new Error(`INVALID_COHORT_KEY: Expected 6 or 7 pipe-delimited segments, received: "${key}"`);
  }
  const [symbol, timeframe, regime, direction, setup, executionPolicyVersion, configurationHash] = parts;
  if (!symbol || !timeframe || !regime || !direction || !setup || !executionPolicyVersion) {
    throw new Error(`INVALID_COHORT_KEY: Expected non-empty pipe-delimited segments, received: "${key}"`);
  }
  return {
    symbol,
    timeframe,
    regime,
    direction,
    setup,
    executionPolicyVersion,
    ...(configurationHash ? { configurationHash } : {}),
  };
}

/**
 * Deduplicates overlapping lifecycle outcomes / updates by thesisId.
 * When multiple updates exist for the same thesisId, the latest finalized outcome
 * (or latest updated/closed/opened outcome) is retained, so each thesis counts exactly once.
 */
export function deduplicateLifecycleOutcomes(
  outcomes: TradeLifecycleOutcome[],
): TradeLifecycleOutcome[] {
  const map = new Map<string, TradeLifecycleOutcome>();

  for (const item of outcomes) {
    const existing = map.get(item.thesisId);
    if (!existing) {
      map.set(item.thesisId, item);
      continue;
    }

    // Prefer finalized over open
    if (existing.status !== 'FINALIZED' && item.status === 'FINALIZED') {
      map.set(item.thesisId, item);
      continue;
    }
    if (existing.status === 'FINALIZED' && item.status !== 'FINALIZED') {
      continue;
    }

    // If both finalized or both open, pick the one with later closedAt or updatedAt
    const existingTime =
      existing.closedAt?.getTime() ??
      existing.updatedAt?.getTime() ??
      existing.openedAt?.getTime() ??
      0;
    const itemTime =
      item.closedAt?.getTime() ??
      item.updatedAt?.getTime() ??
      item.openedAt?.getTime() ??
      0;

    if (itemTime >= existingTime) {
      map.set(item.thesisId, item);
    }
  }

  return Array.from(map.values());
}

export interface CohortCalibrationMetrics {
  sampleSize: number;
  winCount: number;
  lossCount: number;
  scratchCount: number;
  winRate: number;
  meanNetR: number;
  grossRProfit: number;
  grossRLoss: number;
  profitFactor: number;
  brierScore: number | null;
  status: 'CALIBRATED' | 'INSUFFICIENT_HISTORY';
}

/**
 * Calibrates cohort metrics from finalized lifecycle outcomes in net R.
 * Multiple updates for the same thesis count exactly once.
 */
export function calibrateCohortFromLifecycle(
  outcomes: TradeLifecycleOutcome[],
  options?: { minSampleSize?: number },
): CohortCalibrationMetrics {
  const minSampleSize = options?.minSampleSize ?? 20;
  const uniqueOutcomes = deduplicateLifecycleOutcomes(outcomes);

  // Filter strictly to finalized outcomes with valid netR
  const finalized = uniqueOutcomes.filter(
    (o) => o.status === 'FINALIZED' && o.netR !== null && typeof o.netR === 'number',
  );

  const sampleSize = finalized.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      winCount: 0,
      lossCount: 0,
      scratchCount: 0,
      winRate: 0,
      meanNetR: 0,
      grossRProfit: 0,
      grossRLoss: 0,
      profitFactor: 0,
      brierScore: null,
      status: 'INSUFFICIENT_HISTORY',
    };
  }

  let winCount = 0;
  let lossCount = 0;
  let scratchCount = 0;
  let totalNetR = 0;
  let grossRProfit = 0;
  let grossRLoss = 0;

  for (const item of finalized) {
    const r = item.netR as number;
    totalNetR += r;
    if (r > 0) {
      winCount++;
      grossRProfit += r;
    } else if (r < 0) {
      lossCount++;
      grossRLoss += Math.abs(r);
    } else {
      scratchCount++;
    }
  }

  const winRate = winCount / sampleSize;
  const meanNetR = totalNetR / sampleSize;
  const profitFactor =
    grossRLoss > 0
      ? grossRProfit / grossRLoss
      : grossRProfit > 0
        ? 99
        : 0;

  // Brier score: if confidence exists in metadata
  let brierScoreSum = 0;
  let brierCount = 0;
  for (const item of finalized) {
    const rawConf = item.metadata?.confidence;
    if (typeof rawConf === 'number') {
      const prob = Math.max(0, Math.min(1, rawConf / 100));
      const actual = (item.netR as number) > 0 ? 1 : 0;
      brierScoreSum += (prob - actual) ** 2;
      brierCount++;
    }
  }
  const brierScore = brierCount > 0 ? brierScoreSum / brierCount : null;

  return {
    sampleSize,
    winCount,
    lossCount,
    scratchCount,
    winRate,
    meanNetR: Number(meanNetR.toFixed(4)),
    grossRProfit: Number(grossRProfit.toFixed(4)),
    grossRLoss: Number(grossRLoss.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(4)),
    brierScore: brierScore !== null ? Number(brierScore.toFixed(4)) : null,
    status: sampleSize >= minSampleSize ? 'CALIBRATED' : 'INSUFFICIENT_HISTORY',
  };
}

export type ProfitAuthorityAction = 'FULL_SIZE' | 'PROBE_ONLY' | 'SUPPRESSED';

export interface ProfitAuthorityWindow {
  sampleSize: number;
  netExpectancy: number;
  profitFactor: number;
  positive: boolean;
}

export interface ProfitAuthorityResult {
  action: ProfitAuthorityAction;
  sizeFactor: number;
  sampleSize: number;
  netExpectancy: number;
  profitFactor: number;
  largestWinnerConcentration: number;
  sequentialWindows: {
    first: ProfitAuthorityWindow;
    second: ProfitAuthorityWindow;
    allPositive: boolean;
  };
  reason: string;
}

export interface EvaluateProfitAuthorityOptions {
  fullSizeMinimumSamples?: number;
  suppressionMinimumSamples?: number;
  minProfitFactor?: number;
  maxWinnerConcentration?: number;
  probeSizeFactor?: number;
}

function outcomeTimestamp(outcome: TradeLifecycleOutcome): number {
  return (
    outcome.closedAt?.getTime() ??
    outcome.updatedAt?.getTime() ??
    outcome.sourceDataCutoff?.getTime() ??
    outcome.openedAt.getTime()
  );
}

function evaluateProfitWindow(outcomes: TradeLifecycleOutcome[]): ProfitAuthorityWindow {
  const metrics = calibrateCohortFromLifecycle(outcomes, { minSampleSize: 0 });
  const positive = metrics.meanNetR > 0 && metrics.profitFactor > 1.1;
  return {
    sampleSize: metrics.sampleSize,
    netExpectancy: metrics.meanNetR,
    profitFactor: metrics.profitFactor,
    positive,
  };
}

/**
 * Grants sizing authority only to a deduplicated, exact lifecycle cohort.
 * Broader evidence is deliberately excluded: it may inform a probe elsewhere,
 * but it cannot authorize full size or suppress an unestablished symbol.
 */
export function evaluateProfitAuthority(
  outcomes: TradeLifecycleOutcome[],
  options?: EvaluateProfitAuthorityOptions,
): ProfitAuthorityResult {
  const fullSizeMinimumSamples = options?.fullSizeMinimumSamples ?? 30;
  const suppressionMinimumSamples = options?.suppressionMinimumSamples ?? 20;
  const minProfitFactor = options?.minProfitFactor ?? 1.1;
  const maxWinnerConcentration = options?.maxWinnerConcentration ?? 0.35;
  const probeSizeFactor = Math.min(0.15, Math.max(0, options?.probeSizeFactor ?? 0.15));
  const finalized = deduplicateLifecycleOutcomes(outcomes)
    .filter((outcome) => outcome.status === 'FINALIZED' && typeof outcome.netR === 'number')
    .sort((left, right) => outcomeTimestamp(left) - outcomeTimestamp(right));
  const metrics = calibrateCohortFromLifecycle(finalized, { minSampleSize: 0 });
  const totalProfit = finalized.reduce(
    (sum, outcome) => sum + Math.max(0, outcome.netR as number),
    0,
  );
  const largestWinner = finalized.reduce(
    (largest, outcome) => Math.max(largest, Math.max(0, outcome.netR as number)),
    0,
  );
  const largestWinnerConcentration = totalProfit > 0 ? largestWinner / totalProfit : 0;
  const splitAt = Math.floor(finalized.length / 2);
  const first = evaluateProfitWindow(finalized.slice(0, splitAt));
  const second = evaluateProfitWindow(finalized.slice(splitAt));
  const allPositive = first.positive && second.positive;
  const base = {
    sampleSize: metrics.sampleSize,
    netExpectancy: metrics.meanNetR,
    profitFactor: metrics.profitFactor,
    largestWinnerConcentration: Number(largestWinnerConcentration.toFixed(4)),
    sequentialWindows: { first, second, allPositive },
  };

  if (metrics.sampleSize >= suppressionMinimumSamples && metrics.meanNetR < 0) {
    return {
      ...base,
      action: 'SUPPRESSED',
      sizeFactor: 0,
      reason: `NEGATIVE_EXACT_LIFECYCLE_EXPECTANCY: ${metrics.meanNetR}R across ${metrics.sampleSize} outcomes`,
    };
  }

  if (
    metrics.sampleSize >= fullSizeMinimumSamples &&
    metrics.meanNetR > 0 &&
    metrics.profitFactor > minProfitFactor &&
    largestWinnerConcentration <= maxWinnerConcentration &&
    allPositive
  ) {
    return {
      ...base,
      action: 'FULL_SIZE',
      sizeFactor: 1,
      reason: `STABLE_EXACT_LIFECYCLE_PROFITABILITY: expectancy=${metrics.meanNetR}R, PF=${metrics.profitFactor}`,
    };
  }

  return {
    ...base,
    action: 'PROBE_ONLY',
    sizeFactor: probeSizeFactor,
    reason: `EXACT_LIFECYCLE_PROBE_ONLY: samples=${metrics.sampleSize}, expectancy=${metrics.meanNetR}R, PF=${metrics.profitFactor}, concentration=${base.largestWinnerConcentration}`,
  };
}

export type CohortAction = 'APPROVE' | 'REDUCE_SIZE' | 'BLOCK';
export type CohortScope = 'EXACT' | 'BROADER' | 'FALLBACK' | 'NONE';

export interface CohortEvaluationResult {
  action: CohortAction;
  sizeFactor: number;
  scope: CohortScope;
  reason: string;
  sampleSize: number;
  metrics?: CohortCalibrationMetrics;
}

export interface EvaluateCohortOptions {
  minExactSamples?: number;
  minBroaderSamples?: number;
  maxFallbackSizeFactor?: number;
  minPositiveExpectancy?: number;
  asOf?: Date;
}

function matchesPolicyVersion(outcome: TradeLifecycleOutcome, policyVersion: string): boolean {
  if (!policyVersion) return true;
  if (outcome.configurationHash && outcome.configurationHash === policyVersion) return true;
  const cleanParam = policyVersion.trim().toLowerCase().replace(/^v/, '');
  const cleanCalc = outcome.calculationVersion?.toString().trim().toLowerCase().replace(/^v/, '');
  const cleanSchema = outcome.schemaVersion?.toString().trim().toLowerCase().replace(/^v/, '');
  return cleanParam === cleanCalc || cleanParam === cleanSchema;
}

export function selectExactCohortOutcomes(
  params: ThesisCohortKeyParams,
  outcomes: TradeLifecycleOutcome[],
): TradeLifecycleOutcome[] {
  return deduplicateLifecycleOutcomes(outcomes).filter((outcome) => {
    if (outcome.status !== 'FINALIZED' || typeof outcome.netR !== 'number') return false;
    const symbolMatch = outcome.symbol === params.symbol;
    const timeframeMatch = outcome.timeframe === params.timeframe;
    const regimeMatch = outcome.regime === params.regime;
    const directionMatch = outcome.direction === params.direction;
    const setupMatch = outcome.setup === params.setup;
    const policyMatch = matchesPolicyVersion(outcome, params.executionPolicyVersion);
    const configHashMatch = !params.configurationHash || outcome.configurationHash === params.configurationHash;
    return symbolMatch && timeframeMatch && regimeMatch && directionMatch && setupMatch && policyMatch && configHashMatch;
  });
}

/**
 * Evaluates thesis cohort evidence with hierarchical fallback:
 * 1. Checks exact cohort match:
 *    - If mature (sample >= minExactSamples) and negative expectancy -> BLOCK (sizeFactor: 0)
 *    - If mature and positive expectancy -> APPROVE (sizeFactor: 1.0)
 *    - If mature and neutral/marginal -> REDUCE_SIZE (sizeFactor: 0.5)
 * 2. Hierarchical fallback (sample < minExactSamples):
 *    - CRITICAL SPEC REQUIREMENT: Returns REDUCE_SIZE (bounded size factor), NEVER APPROVE!
 *    - CRITICAL SPEC REQUIREMENT: Unrelated symbol history (e.g. BNB/SOL) cannot hard-block
 *      another symbol (e.g. ZEC). Fallback NEVER hard-blocks an unestablished symbol.
 */
export function evaluateThesisCohort(
  target: string | ThesisCohortKeyParams,
  allOutcomes: TradeLifecycleOutcome[],
  options?: EvaluateCohortOptions,
): CohortEvaluationResult {
  const params = typeof target === 'string' ? parseThesisCohortKey(target) : target;
  const minExactSamples = options?.minExactSamples ?? 20;
  const minBroaderSamples = options?.minBroaderSamples ?? 20;
  const maxFallbackSizeFactor = Math.min(0.15, Math.max(0, options?.maxFallbackSizeFactor ?? 0.15));

  // Enforce point-in-time cutoff if asOf is provided
  const timeFilteredOutcomes = options?.asOf
    ? allOutcomes.filter((o) => {
        const time = o.closedAt?.getTime() ?? o.sourceDataCutoff?.getTime() ?? o.openedAt.getTime();
        return time <= options.asOf!.getTime();
      })
    : allOutcomes;

  const deduplicated = deduplicateLifecycleOutcomes(timeFilteredOutcomes);
  const finalized = deduplicated.filter(
    (o) => o.status === 'FINALIZED' && o.netR !== null && typeof o.netR === 'number',
  );

  // Exact cohort partition: same symbol, timeframe, regime, direction, setup, policy, configurationHash
  const exactOutcomes = selectExactCohortOutcomes(params, timeFilteredOutcomes);

  const exactMetrics = calibrateCohortFromLifecycle(exactOutcomes, { minSampleSize: minExactSamples });
  const exactAuthority = evaluateProfitAuthority(exactOutcomes);

  // Exact lifecycle evidence is the sole source of full-size and suppression authority.
  if (exactAuthority.action === 'SUPPRESSED') {
      return {
        action: 'BLOCK',
        sizeFactor: 0,
        scope: 'EXACT',
        reason: exactAuthority.reason,
        sampleSize: exactMetrics.sampleSize,
        metrics: exactMetrics,
      };
  }

  if (exactAuthority.action === 'FULL_SIZE') {
    return {
      action: 'APPROVE',
      sizeFactor: 1,
      scope: 'EXACT',
      reason: exactAuthority.reason,
      sampleSize: exactMetrics.sampleSize,
      metrics: exactMetrics,
    };
  }

  // 2. Hierarchical fallback: exact sample is insufficient (< minExactSamples).
  // Check broader cross-symbol cohort (same timeframe, regime, direction, setup, policy across ALL symbols)
  const broaderOutcomes = finalized.filter((o) => {
    const timeframeMatch = !params.timeframe || !o.timeframe || o.timeframe === params.timeframe;
    const regimeMatch = !o.regime || o.regime === params.regime;
    const directionMatch = o.direction === params.direction;
    const setupMatch = !o.setup || o.setup === params.setup;
    const policyMatch = matchesPolicyVersion(o, params.executionPolicyVersion);
    const configHashMatch = !params.configurationHash || !o.configurationHash || o.configurationHash === params.configurationHash;
    return timeframeMatch && regimeMatch && directionMatch && setupMatch && policyMatch && configHashMatch;
  });

  const broaderMetrics = calibrateCohortFromLifecycle(broaderOutcomes, { minSampleSize: minBroaderSamples });

  // Fallback MUST NEVER return APPROVE (full size 1.0) and MUST NEVER return BLOCK on an unrelated symbol!
  // It returns REDUCE_SIZE with bounded size factor.
  if (broaderMetrics.sampleSize >= minBroaderSamples) {
    return {
      action: 'REDUCE_SIZE',
      sizeFactor: maxFallbackSizeFactor,
      scope: 'BROADER',
      reason: `HIERARCHICAL_FALLBACK_PROBE_ONLY: exact lifecycle authority=${exactAuthority.action}; broader sample=${broaderMetrics.sampleSize}`,
      sampleSize: broaderMetrics.sampleSize,
      metrics: broaderMetrics,
    };
  }

  // Global / Cold start fallback
  return {
    action: 'REDUCE_SIZE',
    sizeFactor: maxFallbackSizeFactor,
    scope: broaderMetrics.sampleSize > 0 ? 'FALLBACK' : 'NONE',
    reason: `HIERARCHICAL_FALLBACK_PROBE_ONLY: exact lifecycle authority=${exactAuthority.action}; broader sample=${broaderMetrics.sampleSize}`,
    sampleSize: exactMetrics.sampleSize,
    metrics: exactMetrics,
  };
}

export interface PairedCandidateLiftInput {
  candidateId: string;
  symbol: string;
  rulesNetR?: number | null;
  aiResearcherNetR: number;
  criticAction: 'APPROVE' | 'REDUCE_SIZE' | 'BLOCK' | 'CANCEL' | 'REQUIRE_TRIGGER';
  criticSizeFactor?: number;
}

export interface PairedCandidateLift {
  candidateId: string;
  symbol: string;
  rulesNetR: number;
  aiResearcherNetR: number;
  criticAction: 'APPROVE' | 'REDUCE_SIZE' | 'BLOCK' | 'CANCEL' | 'REQUIRE_TRIGGER';
  criticSizeFactor: number;
  aiWithCriticNetR: number;
  avoidedLossR: number;
  missedWinR: number;
  netCriticLiftR: number;
}

export interface ModeSummaryMetrics {
  tradeCount: number;
  totalNetR: number;
  averageNetR: number;
  winRate: number;
  profitFactor: number;
}

export interface CriticLiftReport {
  totalCandidates: number;
  totalAvoidedLossR: number;
  totalMissedWinR: number;
  netLiftR: number; // totalAvoidedLossR - totalMissedWinR
  candidates: PairedCandidateLift[];
  rules: ModeSummaryMetrics;
  aiResearcher: ModeSummaryMetrics;
  aiWithCritic: ModeSummaryMetrics & {
    approvedCount: number;
    reducedCount: number;
    blockedCount: number;
  };
  liftVsRules: {
    aiResearcherLiftR: number;
    aiWithCriticLiftR: number;
  };
}

function calculateModeMetrics(rs: number[]): ModeSummaryMetrics {
  const tradeCount = rs.length;
  if (tradeCount === 0) {
    return { tradeCount: 0, totalNetR: 0, averageNetR: 0, winRate: 0, profitFactor: 0 };
  }
  const totalNetR = rs.reduce((sum, r) => sum + r, 0);
  const winCount = rs.filter((r) => r > 0).length;
  const grossProfit = rs.filter((r) => r > 0).reduce((sum, r) => sum + r, 0);
  const grossLoss = rs.filter((r) => r < 0).reduce((sum, r) => sum + Math.abs(r), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  return {
    tradeCount,
    totalNetR: Number(totalNetR.toFixed(4)),
    averageNetR: Number((totalNetR / tradeCount).toFixed(4)),
    winRate: Number((winCount / tradeCount).toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(4)),
  };
}

/**
 * Calculates Critic Lift metrics and compares Rules vs AI Researcher vs AI+Critic:
 * - avoided-loss: critic rejected/reduced what would have been a loss (R < 0)
 * - missed-win: critic rejected/reduced what would have been a win (R > 0)
 * - net lift: totalAvoidedLossR - totalMissedWinR (identical to aiWithCriticNetR - aiResearcherNetR)
 */
export function calculateCriticLift(
  candidates: PairedCandidateLiftInput[],
): CriticLiftReport {
  const evaluatedCandidates: PairedCandidateLift[] = [];
  let totalAvoidedLossR = 0;
  let totalMissedWinR = 0;
  let approvedCount = 0;
  let reducedCount = 0;
  let blockedCount = 0;

  for (const c of candidates) {
    const rawR = c.aiResearcherNetR;
    const rulesR = c.rulesNetR ?? 0;

    let effectiveSize = 1.0;
    if (c.criticAction === 'BLOCK' || c.criticAction === 'CANCEL') {
      effectiveSize = 0;
      blockedCount++;
    } else if (c.criticAction === 'REDUCE_SIZE' || c.criticAction === 'REQUIRE_TRIGGER') {
      effectiveSize = Math.max(0, Math.min(1, c.criticSizeFactor ?? 0.5));
      reducedCount++;
    } else {
      effectiveSize = 1.0;
      approvedCount++;
    }


    const aiWithCriticNetR = Number((rawR * effectiveSize).toFixed(4));
    let avoidedLossR = 0;
    let missedWinR = 0;

    if (effectiveSize < 1.0) {
      const reduction = 1 - effectiveSize;
      if (rawR < 0) {
        avoidedLossR = Number((reduction * Math.abs(rawR)).toFixed(4));
      } else if (rawR > 0) {
        missedWinR = Number((reduction * rawR).toFixed(4));
      }
    }

    totalAvoidedLossR += avoidedLossR;
    totalMissedWinR += missedWinR;

    const netCriticLiftR = Number((aiWithCriticNetR - rawR).toFixed(4));

    evaluatedCandidates.push({
      candidateId: c.candidateId,
      symbol: c.symbol,
      rulesNetR: rulesR,
      aiResearcherNetR: rawR,
      criticAction: c.criticAction,
      criticSizeFactor: effectiveSize,
      aiWithCriticNetR,
      avoidedLossR,
      missedWinR,
      netCriticLiftR,
    });
  }

  const roundedAvoidedLoss = Number(totalAvoidedLossR.toFixed(4));
  const roundedMissedWin = Number(totalMissedWinR.toFixed(4));
  const netLiftR = Number((roundedAvoidedLoss - roundedMissedWin).toFixed(4));

  const rulesMetrics = calculateModeMetrics(evaluatedCandidates.map((c) => c.rulesNetR));
  const aiMetrics = calculateModeMetrics(evaluatedCandidates.map((c) => c.aiResearcherNetR));
  const criticMetrics = calculateModeMetrics(evaluatedCandidates.map((c) => c.aiWithCriticNetR));

  return {
    totalCandidates: candidates.length,
    totalAvoidedLossR: roundedAvoidedLoss,
    totalMissedWinR: roundedMissedWin,
    netLiftR,
    candidates: evaluatedCandidates,
    rules: rulesMetrics,
    aiResearcher: aiMetrics,
    aiWithCritic: {
      ...criticMetrics,
      approvedCount,
      reducedCount,
      blockedCount,
    },
    liftVsRules: {
      aiResearcherLiftR: Number((aiMetrics.totalNetR - rulesMetrics.totalNetR).toFixed(4)),
      aiWithCriticLiftR: Number((criticMetrics.totalNetR - rulesMetrics.totalNetR).toFixed(4)),
    },
  };
}
