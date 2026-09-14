import { timeframeMilliseconds } from "./adaptive-trading-policy";

export interface ExecutionCohortKey {
  symbol: string;
  strategyKey: string;
  direction: 'LONG' | 'SHORT';
  regime: string;
  timeframe: string;
  executionPolicy: string;
  configurationVersion: number;
}

export type CohortEvidenceStatus =
  | 'EXACT_MATURE_POSITIVE'
  | 'EXACT_IMMATURE'
  | 'PARTIAL_MATCH'
  | 'EXACT_MATURE_NEGATIVE'
  | 'STALE'
  | 'MISSING';

export interface ExecutionCohortRequest {
  symbol: string;
  strategyKey?: string;
  direction: 'LONG' | 'SHORT';
  regime: string;
  timeframe: string;
  executionPolicy?: string;
  configurationVersion?: number;
  userLimits?: {
    maxLeverage: number;
    riskPerTrade: number;
    riskRewardRatio: number;
  } | null;
}

export interface ValidationEvidenceRecord {
  symbol?: string;
  strategyKey?: string;
  interval?: string;
  provider?: string;
  probabilityOfProfit: number;
  probabilityOfRuin: number;
  outOfSampleSharpe: number;
  walkForwardStable: boolean;
  confidenceBrierScore?: number;
  createdAt: Date;
  metricsJson?: unknown;
}

export interface ExecutionEvidenceClassification {
  status: CohortEvidenceStatus;
  matchedCohort?: ExecutionCohortKey;
  reason?: string;
  totalTrades?: number;
  outOfSampleTrades?: number;
}

function normalizeRegime(regime: string, direction?: string): string {
  const upper = regime.toUpperCase();
  if (upper === 'BULL' || upper === 'BULLISH' || (upper === 'TRENDING' && direction === 'LONG')) return 'BULL';
  if (upper === 'BEAR' || upper === 'BEARISH' || (upper === 'TRENDING' && direction === 'SHORT')) return 'BEAR';
  if (upper === 'SIDEWAYS' || upper === 'RANGING') return 'RANGING';
  return upper;
}

export function classifyExecutionEvidence(
  request: ExecutionCohortRequest,
  validation: ValidationEvidenceRecord | null | undefined,
  now: Date = new Date(),
): ExecutionEvidenceClassification {
  if (!validation) {
    return {
      status: 'MISSING',
      reason: 'QUANT_VALIDATION_MISSING',
    };
  }

  const reqStrategy = request.strategyKey ?? 'ai-core';
  const reqPolicy = request.executionPolicy ?? 'DEFAULT';
  const reqConfigVersion = request.configurationVersion ?? 1;

  const metrics =
    validation.metricsJson &&
    typeof validation.metricsJson === 'object' &&
    !Array.isArray(validation.metricsJson)
      ? (validation.metricsJson as Record<string, unknown>)
      : {};

  const cohort =
    metrics.cohort &&
    typeof metrics.cohort === 'object' &&
    !Array.isArray(metrics.cohort)
      ? (metrics.cohort as Record<string, unknown>)
      : metrics;

  const valSymbol = validation.symbol ?? cohort.symbol ?? request.symbol;
  const valStrategy = validation.strategyKey ?? cohort.strategyKey ?? 'ai-core';
  const valInterval = validation.interval ?? cohort.timeframe ?? cohort.interval ?? request.timeframe;
  const valDirection = cohort.direction as string | undefined;
  const valRegime = cohort.regime as string | undefined;
  const valPolicy = (cohort.executionPolicy ?? cohort.executionPolicyVersion ?? (cohort.direction && cohort.regime ? 'DEFAULT' : undefined)) as string | undefined;
  const valVersion =
    cohort.configurationVersion !== undefined
      ? Number(cohort.configurationVersion)
      : (cohort.direction && cohort.regime ? 1 : undefined);

  // Missing identity fields cannot be exact
  if (
    !valDirection ||
    !valRegime ||
    valPolicy === undefined ||
    valVersion === undefined ||
    !valInterval
  ) {
    return {
      status: 'PARTIAL_MATCH',
      reason: 'IDENTITY_FIELDS_MISSING',
    };
  }

  const normalizePolicy = (p?: string) => {
    if (!p) return 'DEFAULT';
    const upper = String(p).toUpperCase();
    return upper === 'STANDARD' ? 'DEFAULT' : upper;
  };

  const normalizeVersion = (v?: string | number) => {
    if (v === undefined || v === null) return 1;
    if (typeof v === 'number') return v;
    const stripped = String(v).replace(/^v/i, '');
    const num = Number(stripped);
    return Number.isFinite(num) ? num : v;
  };

  // Exact match check
  const directionMatches =
    valDirection.toUpperCase() === 'BOTH' ||
    valDirection.toUpperCase() === 'ANY' ||
    valDirection.toUpperCase() === request.direction.toUpperCase();

  const regimeMatches =
    valRegime.toUpperCase() === 'ANY' ||
    valRegime.toUpperCase() === 'ALL' ||
    normalizeRegime(valRegime, request.direction) ===
      normalizeRegime(request.regime, request.direction);

  const policyMatches = normalizePolicy(valPolicy) === normalizePolicy(reqPolicy);
  const versionMatches = normalizeVersion(valVersion) === normalizeVersion(reqConfigVersion);

  const isExactCohort =
    valSymbol === request.symbol &&
    valStrategy === reqStrategy &&
    valInterval === request.timeframe &&
    directionMatches &&
    regimeMatches &&
    policyMatches &&
    versionMatches;

  if (!isExactCohort) {
    return {
      status: 'PARTIAL_MATCH',
      reason: 'COHORT_IDENTITY_MISMATCH',
    };
  }

  const matchedCohort: ExecutionCohortKey = {
    symbol: request.symbol,
    strategyKey: reqStrategy,
    direction: request.direction,
    regime: request.regime,
    timeframe: request.timeframe,
    executionPolicy: reqPolicy,
    configurationVersion: reqConfigVersion,
  };

  // Execution cost assumptions check
  if (request.userLimits !== null && request.userLimits !== undefined) {
    const assumptions =
      metrics.executionAssumptions &&
      typeof metrics.executionAssumptions === 'object' &&
      !Array.isArray(metrics.executionAssumptions)
        ? (metrics.executionAssumptions as Record<string, unknown>)
        : undefined;

    const invalidAssumptions =
      !assumptions ||
      ['leverage', 'riskPerTrade', 'riskRewardRatio'].some(
        (key) => !Number.isFinite(Number(assumptions[key])),
      ) ||
      Number(assumptions.leverage) !== request.userLimits.maxLeverage ||
      Math.abs(Number(assumptions.riskPerTrade) - request.userLimits.riskPerTrade) > 1e-9 ||
      Math.abs(Number(assumptions.riskRewardRatio) - request.userLimits.riskRewardRatio) > 1e-9;

    if (invalidAssumptions) {
      return {
        status: 'PARTIAL_MATCH',
        matchedCohort,
        reason: 'QUANT_ASSUMPTION_MISMATCH',
      };
    }
  }

  // Staleness check
  const maxAge = Math.max(36 * 3_600_000, timeframeMilliseconds(request.timeframe) * 12);
  const isStale = now.getTime() - validation.createdAt.getTime() > maxAge;
  if (isStale) {
    return {
      status: 'STALE',
      matchedCohort,
      reason: 'QUANT_VALIDATION_STALE',
    };
  }

  // Maturity check
  const sampleEvidence =
    metrics.sampleEvidence &&
    typeof metrics.sampleEvidence === 'object' &&
    !Array.isArray(metrics.sampleEvidence)
      ? (metrics.sampleEvidence as Record<string, unknown>)
      : {};
  const outOfSample =
    metrics.outOfSample &&
    typeof metrics.outOfSample === 'object' &&
    !Array.isArray(metrics.outOfSample)
      ? (metrics.outOfSample as Record<string, unknown>)
      : {};

  const totalTrades = Number(sampleEvidence.totalTrades ?? 0);
  const outOfSampleTrades = Number(
    sampleEvidence.outOfSampleTrades ?? outOfSample.outOfSampleTrades ?? 0,
  );

  const isImmature = totalTrades < 30 || outOfSampleTrades < 10;
  if (isImmature) {
    return {
      status: 'EXACT_IMMATURE',
      matchedCohort,
      totalTrades,
      outOfSampleTrades,
      reason: 'QUANT_SAMPLE_TOO_SMALL',
    };
  }

  // Mature negative check
  const isNegative =
    !validation.walkForwardStable ||
    validation.probabilityOfProfit < 52 ||
    validation.probabilityOfRuin > 15 ||
    validation.outOfSampleSharpe <= 0.8;

  if (isNegative) {
    return {
      status: 'EXACT_MATURE_NEGATIVE',
      matchedCohort,
      totalTrades,
      outOfSampleTrades,
      reason: !validation.walkForwardStable
        ? 'QUANT_WALK_FORWARD_UNSTABLE'
        : validation.probabilityOfProfit < 52
          ? 'QUANT_PROBABILITY_TOO_LOW'
          : validation.probabilityOfRuin > 15
            ? 'QUANT_RUIN_RISK_TOO_HIGH'
            : 'QUANT_OUT_OF_SAMPLE_EDGE_MISSING',
    };
  }

  return {
    status: 'EXACT_MATURE_POSITIVE',
    matchedCohort,
    totalTrades,
    outOfSampleTrades,
  };
}
