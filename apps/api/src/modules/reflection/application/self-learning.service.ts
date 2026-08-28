import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { BASE_WEIGHTS } from '../../agents/domain/constants/decision.constants';
import type { AnalystName } from '../../agents/domain/types/decision-service.types';
import { evaluateDecision } from '../domain/performance-calculator';
import {
  evaluateLiveEligibility,
  computeConfigurationHash,
  LIVE_ELIGIBILITY_POLICY_VERSION,
  type LiveEligibilityMetrics,
} from '../domain/live-eligibility';
import type { LiveEligibilityReviewInput } from '@platform/shared';
import { createHash } from 'node:crypto';

export interface ShadowPerformance {
  tradesCount: number;
  correctCount: number;
  accuracy: number;
  totalReturn: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  currentEquity: number;
  equityPeak: number;
  maxDrawdown: number;
  returnSumSquares: number;
  sharpeRatio: number;
}

export const EMPTY_SHADOW_PERFORMANCE: ShadowPerformance = {
  tradesCount: 0,
  correctCount: 0,
  accuracy: 0,
  totalReturn: 0,
  grossProfit: 0,
  grossLoss: 0,
  profitFactor: 0,
  currentEquity: 0,
  equityPeak: 0,
  maxDrawdown: 0,
  returnSumSquares: 0,
  sharpeRatio: 0,
};

interface AgentAnalysisSnapshot {
  dataQuality?: string;
  trend?: { direction?: string };
  focusDirection?: string;
  impact?: { direction?: string };
  sentiment?: { overall?: string };
  macroTrend?: string;
  activity?: string;
}

interface StoredContextPayload {
  analyses?: Record<string, AgentAnalysisSnapshot | undefined>;
}

interface LearningRun {
  completedAt: Date | null;
  confidence: number | null;
  storedContext: Prisma.JsonValue | null;
  performanceRecords: Array<{
    horizon: string;
    outcome: string;
    decision: string;
  }>;
}

const MIN_TUNING_DIRECTIONAL_RECORDS = 30;
const MIN_WEIGHT_OPTIMIZATION_RUNS = 30;
const MIN_AGENT_OBSERVATIONS = 20;

function toShadowPerformanceJson(value: ShadowPerformance): Prisma.InputJsonObject {
  return {
    tradesCount: value.tradesCount,
    correctCount: value.correctCount,
    accuracy: value.accuracy,
    totalReturn: value.totalReturn,
    grossProfit: value.grossProfit,
    grossLoss: value.grossLoss,
    profitFactor: value.profitFactor,
    currentEquity: value.currentEquity,
    equityPeak: value.equityPeak,
    maxDrawdown: value.maxDrawdown,
    returnSumSquares: value.returnSumSquares,
    sharpeRatio: value.sharpeRatio,
  };
}

function parseShadowPerformance(value: Prisma.JsonValue | null | undefined): ShadowPerformance {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Partial<ShadowPerformance>;
    return {
      tradesCount: typeof candidate.tradesCount === 'number' ? candidate.tradesCount : 0,
      correctCount: typeof candidate.correctCount === 'number' ? candidate.correctCount : 0,
      accuracy: typeof candidate.accuracy === 'number' ? candidate.accuracy : 0,
      totalReturn: typeof candidate.totalReturn === 'number' ? candidate.totalReturn : 0,
      grossProfit: typeof candidate.grossProfit === 'number' ? candidate.grossProfit : 0,
      grossLoss: typeof candidate.grossLoss === 'number' ? candidate.grossLoss : 0,
      profitFactor: typeof candidate.profitFactor === 'number' ? candidate.profitFactor : 0,
      currentEquity: typeof candidate.currentEquity === 'number' ? candidate.currentEquity : 0,
      equityPeak: typeof candidate.equityPeak === 'number' ? candidate.equityPeak : 0,
      maxDrawdown: typeof candidate.maxDrawdown === 'number' ? candidate.maxDrawdown : 0,
      returnSumSquares: typeof candidate.returnSumSquares === 'number' ? candidate.returnSumSquares : 0,
      sharpeRatio: typeof candidate.sharpeRatio === 'number' ? candidate.sharpeRatio : 0,
    };
  }

  return { ...EMPTY_SHADOW_PERFORMANCE };
}

export function addShadowReturn(
  current: ShadowPerformance,
  returnPct: number,
  isCorrect: boolean,
): ShadowPerformance {
  const tradesCount = current.tradesCount + 1;
  const correctCount = current.correctCount + (isCorrect ? 1 : 0);
  const grossProfit = current.grossProfit + Math.max(0, returnPct);
  const grossLoss = current.grossLoss + Math.abs(Math.min(0, returnPct));
  const currentEquity = current.currentEquity + returnPct;
  const equityPeak = Math.max(current.equityPeak, currentEquity);
  const maxDrawdown = Math.max(current.maxDrawdown, equityPeak - currentEquity);
  const totalReturn = current.totalReturn + returnPct;
  const returnSumSquares = current.returnSumSquares + returnPct * returnPct;
  const meanReturn = totalReturn / tradesCount;
  const variance = tradesCount > 1
    ? Math.max(0, (returnSumSquares - tradesCount * meanReturn * meanReturn) / (tradesCount - 1))
    : 0;
  const standardDeviation = Math.sqrt(variance);
  return {
    tradesCount,
    correctCount,
    accuracy: tradesCount > 0 ? (correctCount / tradesCount) * 100 : 0,
    totalReturn,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
    currentEquity,
    equityPeak,
    maxDrawdown,
    returnSumSquares,
    sharpeRatio: standardDeviation > 0 ? (meanReturn / standardDeviation) * Math.sqrt(tradesCount) : 0,
  };
}

export function accuracyZScore(aCorrect: number, aTotal: number, bCorrect: number, bTotal: number): number {
  if (aTotal <= 0 || bTotal <= 0) return 0;
  const pooled = (aCorrect + bCorrect) / (aTotal + bTotal);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / aTotal + 1 / bTotal));
  return standardError > 0 ? (aCorrect / aTotal - bCorrect / bTotal) / standardError : 0;
}

export function evaluateShadowPromotion(
  shadow: ShadowPerformance,
  live: ShadowPerformance,
  rules: {
    minTrades: number;
    minAccuracyLift: number;
    minProfitFactor: number;
    minSharpeRatio: number;
    maxDrawdown: number;
  },
): { promote: boolean; accuracyZScore: number } {
  const zScore = accuracyZScore(
    shadow.correctCount,
    shadow.tradesCount,
    live.correctCount,
    live.tradesCount,
  );
  const shadowAverageReturn = shadow.tradesCount > 0 ? shadow.totalReturn / shadow.tradesCount : 0;
  const liveAverageReturn = live.tradesCount > 0 ? live.totalReturn / live.tradesCount : 0;
  const hasComparableLiveSample = live.tradesCount >= rules.minTrades;
  return {
    promote:
      shadow.tradesCount >= rules.minTrades &&
      hasComparableLiveSample &&
      shadow.accuracy >= live.accuracy + rules.minAccuracyLift &&
      zScore >= 1.645 &&
      shadowAverageReturn > Math.max(0, liveAverageReturn) &&
      shadow.profitFactor >= rules.minProfitFactor &&
      shadow.sharpeRatio >= Math.max(rules.minSharpeRatio, live.sharpeRatio) &&
      shadow.maxDrawdown <= Math.min(rules.maxDrawdown, live.maxDrawdown || rules.maxDrawdown),
    accuracyZScore: zScore,
  };
}

@Injectable()
export class SelfLearningService {
  private readonly logger = new Logger(SelfLearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  listExperiments(userId: string) {
    return this.prisma.selfLearningExperiment.findMany({
      where: { userId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async activeLifecycleUserIds(): Promise<string[]> {
    const rows = await this.prisma.selfLearningConfiguration.findMany({
      where: {
        isEnabled: true,
        OR: [
          { shadowEnabled: true },
          { canaryEnabled: true },
          { previousVersion: { not: null } },
        ],
      },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  async lifecycleStatus(userId: string) {
    const config = await this.getOrCreateConfig(userId);
    const canaryPercent = this.config.get<number>('SELF_LEARNING_CANARY_PERCENT', 10);
    const [pendingShadowSignals, evaluatedShadowSignals, canaryRecords, liveRecords, experiment] = await Promise.all([
      this.prisma.paperSignal.count({ where: { userId, mode: 'SHADOW', outcome: 'PENDING', configurationVersion: config.shadowVersion ?? undefined } }),
      this.prisma.paperSignal.count({ where: { userId, mode: 'SHADOW', outcome: { in: ['CORRECT', 'WRONG'] }, configurationVersion: config.shadowVersion ?? undefined } }),
      config.canaryVersion ? this.prisma.performanceRecord.count({ where: { userId, horizon: 'MID', run: { configurationVersion: config.canaryVersion, learningStage: 'CANARY' } } }) : 0,
      this.prisma.performanceRecord.count({ where: { userId, horizon: 'MID', run: { configurationVersion: config.liveVersion, learningStage: 'LIVE' } } }),
      this.prisma.selfLearningExperiment.findFirst({
        where: { userId, version: config.canaryVersion ?? config.shadowVersion ?? config.liveVersion },
        include: { recommendation: { select: { id: true, status: true, title: true } }, events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
    ]);
    const stage = config.canaryEnabled
      ? 'CANARY'
      : config.shadowEnabled
        ? 'SHADOW'
        : config.eligibleVersion
          ? 'LIVE_ELIGIBLE'
          : 'LIVE';
    const eligibleCandidate = config.eligibleVersion && config.eligibleConfigurationHash ? {
      version: config.eligibleVersion,
      weights: config.eligibleWeightsJson as Record<string, number>,
      threshold: config.eligibleThreshold ?? 60.0,
      metrics: config.eligibleMetricsJson as unknown as LiveEligibilityMetrics,
      configurationHash: config.eligibleConfigurationHash,
      eligibleAt: config.eligibleAt?.toISOString() ?? new Date().toISOString(),
    } : null;
    const approvedCandidate = config.approvedVersion && config.approvedConfigurationHash && config.approvedAt ? {
      version: config.approvedVersion,
      configurationHash: config.approvedConfigurationHash,
      approvedAt: config.approvedAt.toISOString(),
    } : null;
    return {
      stage,
      isEnabled: config.isEnabled,
      liveVersion: config.liveVersion,
      candidateVersion: config.canaryVersion ?? config.shadowVersion ?? config.eligibleVersion,
      liveImpactPct: stage === 'CANARY' ? 100 - canaryPercent : 100,
      candidateImpactPct: stage === 'CANARY' ? canaryPercent : 0,
      shadowPerformance: stage === 'SHADOW' ? parseShadowPerformance(config.shadowPerformance) : null,
      evidence: { pendingShadowSignals, evaluatedShadowSignals, canaryRecords, liveRecords },
      startedAt: config.canaryStartedAt ?? config.shadowStartedAt ?? config.eligibleAt,
      lastPromotionAt: config.lastPromotionAt,
      eligibleCandidate,
      approvedCandidate,
      experiment,
    };
  }

  /**
   * Get or create self-learning configuration for a user.
   */
  async getOrCreateConfig(userId: string) {
    let config = await this.prisma.selfLearningConfiguration.findUnique({
      where: { userId },
    });
    if (!config) {
      config = await this.prisma.selfLearningConfiguration.create({
        data: {
          userId,
          confidenceThreshold: 60.0,
          volatilityPenalty: 20.0,
          weightsJson: BASE_WEIGHTS,
          shadowWeightsJson: BASE_WEIGHTS,
          shadowThreshold: 60.0,
          shadowEnabled: false,
          shadowPerformance: toShadowPerformanceJson(EMPTY_SHADOW_PERFORMANCE),
        },
      });
    } else if (config.shadowEnabled && config.shadowVersion === null) {
      config = await this.prisma.selfLearningConfiguration.update({
        where: { userId },
        data: {
          shadowVersion: config.liveVersion + 1,
          shadowStartedAt: config.shadowStartedAt ?? new Date(),
          shadowPerformance: toShadowPerformanceJson(EMPTY_SHADOW_PERFORMANCE),
        },
      });
    }
    return config;
  }

  /**
   * Phase A: Parameter Auto-Tuner & Feedback Loop
   * Reads recent performance metrics and dynamically tunes confidence threshold and volatility penalties.
   */
  async tuneParameters(userId: string): Promise<void> {
    const config = await this.getOrCreateConfig(userId);
    if (!config.isEnabled || config.shadowEnabled || config.canaryEnabled) return;

    // Use one fixed horizon so the same decision is not counted twice.
    const records = await this.prisma.performanceRecord.findMany({
      where: { userId, horizon: 'MID', decision: { in: ['LONG', 'SHORT'] } },
      orderBy: { evaluatedAt: 'desc' },
      take: 100,
    });

    if (records.length < MIN_TUNING_DIRECTIONAL_RECORDS) {
      this.logger.log(`Skipping auto-tuning for user ${userId}: not enough directional MID history (${records.length}/${MIN_TUNING_DIRECTIONAL_RECORDS}).`);
      return;
    }

    const correctCount = records.filter((r) => r.outcome === 'CORRECT').length;
    const directionalCount = records.filter((r) => r.decision !== 'WAIT').length;
    const accuracy = directionalCount > 0 ? (correctCount / directionalCount) * 100 : 100;

    let nextThreshold = config.confidenceThreshold;

    // 1. Tune Confidence Threshold based on Accuracy
    if (accuracy < 55) {
      // Lower accuracy -> raise threshold to be more conservative (max 75)
      nextThreshold = Math.min(75, config.confidenceThreshold + 5);
      this.logger.log(`Tuning: Accuracy is low (${accuracy.toFixed(1)}%). Raising confidence threshold from ${config.confidenceThreshold} to ${nextThreshold}`);
    } else if (accuracy >= 70) {
      // High accuracy -> lower threshold to capture more opportunities (min 55)
      nextThreshold = Math.max(55, config.confidenceThreshold - 3);
      this.logger.log(`Tuning: Accuracy is high (${accuracy.toFixed(1)}%). Lowering confidence threshold from ${config.confidenceThreshold} to ${nextThreshold}`);
    }

    // 2. Tune Volatility Penalty based on Drawdown & Volatile performance
    const volatileRecords = records.filter((r) => r.highVolatility && r.decision !== 'WAIT');
    const volatileCorrect = volatileRecords.filter((r) => r.outcome === 'CORRECT').length;
    const volatileAccuracy = volatileRecords.length > 0 ? (volatileCorrect / volatileRecords.length) * 100 : 100;

    if (volatileRecords.length >= 3 && volatileAccuracy < 50) {
      // Underperforming during volatility -> increase penalty (max 40)
      this.logger.log(`Tuning: Volatility accuracy is low (${volatileAccuracy.toFixed(1)}%). Keeping the live volatility penalty unchanged until a shadow field is available.`);
    }

    // Record that tuning was evaluated, but do not construct a candidate from
    // this recent window. Candidate thresholds are selected only from the
    // non-overlapping training window in optimizeAgentWeights().
    await this.prisma.selfLearningConfiguration.update({
      where: { userId },
      data: {
        lastOptimizedAt: new Date(),
      },
    });
  }

  /**
   * Phase B: Agent Weight Optimizer
   * Computes the predictive accuracy of individual agents and updates their weights dynamically.
   */
  async optimizeAgentWeights(userId: string): Promise<void> {
    const config = await this.getOrCreateConfig(userId);
    // A shadow experiment is immutable. Mixing decisions from several
    // candidates would make its performance statistically meaningless.
    if (!config.isEnabled || config.shadowEnabled || config.canaryEnabled) return;

    // Fetch recent completed runs with stored contexts to retrieve individual agent votes
    const runs = await this.prisma.pipelineRun.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        performanceRecords: { some: { outcome: { in: ['CORRECT', 'WRONG'] } } },
      },
      include: {
        performanceRecords: true,
      },
      orderBy: { completedAt: 'desc' },
      take: 200,
    });

    if (runs.length < MIN_WEIGHT_OPTIMIZATION_RUNS) return;
    const chronologicalRuns = [...runs].reverse();
    const splitIndex = Math.floor(chronologicalRuns.length * 0.7);
    const trainingRuns = chronologicalRuns.slice(0, splitIndex);
    const validationRuns = chronologicalRuns.slice(splitIndex);
    if (trainingRuns.length < MIN_WEIGHT_OPTIMIZATION_RUNS || validationRuns.length < 20) return;

    const agentScores: Record<AnalystName, { correct: number; total: number }> = {
      market: { correct: 0, total: 0 },
      technical: { correct: 0, total: 0 },
      news: { correct: 0, total: 0 },
      sentiment: { correct: 0, total: 0 },
      macro: { correct: 0, total: 0 },
      onchain: { correct: 0, total: 0 },
    };

    for (const run of trainingRuns) {
      const observation = this.learningObservation(run);
      if (!observation) continue;
      const agents = Object.keys(agentScores) as AnalystName[];
      for (const agent of agents) {
        const agentVote = observation.votes[agent];
        if (agentVote !== 'WAIT') {
          agentScores[agent].total++;
          if (agentVote === observation.actualDirection) {
            agentScores[agent].correct++;
          }
        }
      }
    }

    // Adjust weights based on agent accuracy
    const newWeights = { ...BASE_WEIGHTS };
    const agents = Object.keys(agentScores) as AnalystName[];
    let totalAdjusted = 0;

    const computedWeights = agents.reduce((acc, agent) => {
      const score = agentScores[agent];
      // Keep the base weight until the agent has enough observations. Once
      // eligible, apply Beta-prior shrinkage to reduce small-sample overfit.
      const rawWeight = score.total >= MIN_AGENT_OBSERVATIONS
        ? BASE_WEIGHTS[agent] * (0.75 + ((score.correct + 10) / (score.total + 20)) * 0.5)
        : BASE_WEIGHTS[agent];
      totalAdjusted += rawWeight;
      acc[agent] = rawWeight;
      return acc;
    }, {} as Record<AnalystName, number>);

    // Normalize weights to sum up to exactly 100
    agents.forEach((agent) => {
      newWeights[agent] = Math.round((computedWeights[agent] / totalAdjusted) * 100);
    });

    // Fix rounding discrepancies on the least heavy weight (onchain)
    const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      newWeights.onchain += (100 - sum);
    }

    this.logger.log(`Optimized agent weights: ${JSON.stringify(newWeights)}`);

    const candidateValidation = this.scoreWeights(validationRuns, newWeights);
    const baselineValidation = this.scoreWeights(validationRuns, BASE_WEIGHTS);
    const latestExperiment = await this.prisma.selfLearningExperiment.findFirst({
      where: { userId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const candidateVersion = Math.max(config.liveVersion + 1, (latestExperiment?.version ?? 0) + 1);
    const candidateThreshold = this.selectThreshold(trainingRuns, config.confidenceThreshold);
    const candidateThresholdValidation = this.scoreThreshold(validationRuns, candidateThreshold);
    const baselineThresholdValidation = this.scoreThreshold(validationRuns, config.confidenceThreshold);
    const trainStartedAt = trainingRuns[0]?.completedAt ?? new Date();
    const trainEndedAt = trainingRuns.at(-1)?.completedAt ?? new Date();
    const validationStartedAt = validationRuns[0]?.completedAt ?? new Date();
    const validationEndedAt = validationRuns.at(-1)?.completedAt ?? new Date();
    const reproducibleHash = createHash('sha256').update(JSON.stringify({
      userId,
      candidateVersion,
      baseVersion: config.liveVersion,
      newWeights,
      candidateThreshold,
      trainStartedAt: trainStartedAt.toISOString(),
      trainEndedAt: trainEndedAt.toISOString(),
      validationStartedAt: validationStartedAt.toISOString(),
      validationEndedAt: validationEndedAt.toISOString(),
    })).digest('hex');
    const validationPassed = candidateValidation.total >= 20 &&
      candidateValidation.accuracy >= baselineValidation.accuracy &&
      candidateThresholdValidation.total >= 10 &&
      candidateThresholdValidation.accuracy >= baselineThresholdValidation.accuracy;
    const recommendation = await this.prisma.quantRecommendation.create({
      data: {
        userId,
        title: `Self-learning configuration v${candidateVersion}`,
        moduleSource: 'SELF_LEARNING_AUTO',
        problemStatement: 'Continuously improve governed decision weights and confidence threshold from evaluated pipeline outcomes.',
        evidenceText: `${trainingRuns.length} training runs and ${validationRuns.length} non-overlapping validation runs.`,
        historicalResult: {
          candidateVersion,
          baseVersion: config.liveVersion,
          candidate: candidateValidation,
          baseline: baselineValidation,
          candidateThreshold: candidateThresholdValidation,
          baselineThreshold: baselineThresholdValidation,
        },
        expectedBenefit: 'Improve decision quality under measured live market regimes.',
        estimatedRisk: 'Recent samples may not generalize to a future regime.',
        priority: 'MEDIUM',
        implementationCost: 'AUTOMATED',
        rollbackPlan: 'Reject shadow, roll back canary, or restore the previous live version automatically.',
        status: validationPassed ? 'SHADOW' : 'REJECTED',
        reviewedAt: new Date(),
        rejectionReason: validationPassed ? null : 'NON_OVERLAPPING_VALIDATION_FAILED',
      },
    });
    const experiment = await this.prisma.selfLearningExperiment.create({
      data: {
        userId,
        version: candidateVersion,
        baseVersion: config.liveVersion,
        candidateWeightsJson: newWeights,
        candidateThreshold,
        trainStartedAt,
        trainEndedAt,
        validationStartedAt,
        validationEndedAt,
        trainMetricsJson: { runs: trainingRuns.length, agentScores },
        validationMetricsJson: {
          candidate: candidateValidation,
          baseline: baselineValidation,
          candidateThreshold: candidateThresholdValidation,
          baselineThreshold: baselineThresholdValidation,
        },
        reproducibleHash,
        recommendationId: recommendation.id,
      },
    });
    await this.appendExperimentEvent(
      experiment.id,
      validationPassed ? 'VALIDATION_PASSED_SHADOW_STARTED' : 'VALIDATION_REJECTED',
      { candidate: candidateValidation, baseline: baselineValidation, candidateThreshold: candidateThresholdValidation, baselineThreshold: baselineThresholdValidation },
    );
    if (!validationPassed) return;

    // Phase C: Shadow Mode Setup
    // Save new configuration as a candidate (shadow) config instead of replacing live weights immediately
    await this.prisma.paperSignal.updateMany({
      where: { userId, mode: 'SHADOW', outcome: 'PENDING' },
      data: { outcome: 'SUPERSEDED' },
    });
    await this.prisma.selfLearningConfiguration.update({
      where: { userId },
      data: {
        shadowWeightsJson: newWeights,
        shadowThreshold: candidateThreshold,
        shadowEnabled: true,
        shadowVersion: candidateVersion,
        shadowStartedAt: new Date(),
        shadowPerformance: toShadowPerformanceJson(EMPTY_SHADOW_PERFORMANCE),
      },
    });
  }

  /**
   * Phase C: Shadow Testing Evaluator
   * Evaluates pending shadow signals against real market data and triggers auto-promotion if successful.
   */
  async evaluateShadowSignals(userId: string): Promise<void> {
    const config = await this.getOrCreateConfig(userId);
    if (!config.shadowEnabled) return;

    const candidateVersion = config.shadowVersion ?? config.liveVersion + 1;
    const minTrades = this.config.get<number>('SELF_LEARNING_MIN_SHADOW_TRADES', 100);
    const rejectAfterTrades = Math.max(
      minTrades,
      this.config.get<number>('SELF_LEARNING_REJECT_AFTER_TRADES', 300),
    );
    const minAccuracyLift = this.config.get<number>('SELF_LEARNING_MIN_ACCURACY_LIFT_PCT', 3);
    const minProfitFactor = this.config.get<number>('SELF_LEARNING_MIN_PROFIT_FACTOR', 1.2);
    const minSharpeRatio = this.config.get<number>('SELF_LEARNING_MIN_SHARPE_RATIO', 0.5);
    const maxDrawdown = this.config.get<number>('SELF_LEARNING_MAX_DRAWDOWN_PCT', 10);
    const maxShadowDays = this.config.get<number>('SELF_LEARNING_MAX_SHADOW_DAYS', 30);

    const pendingSignals = await this.prisma.paperSignal.findMany({
      where: {
        userId,
        mode: 'SHADOW',
        outcome: 'PENDING',
        configurationVersion: candidateVersion,
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    let updatedPerf = parseShadowPerformance(config.shadowPerformance);

    for (const signal of pendingSignals) {
      // Find historical candle at completion to see actual outcome
      const targetTime = new Date(signal.createdAt.getTime() + 60 * 60_000); // Evaluated over 1 Hour horizon
      if (targetTime.getTime() > Date.now()) continue; // Not due yet

      // Lookup price at evaluation time
      const candle = await this.prisma.marketCandle.findFirst({
        where: {
          symbol: signal.symbol,
          ...(signal.provider ? { provider: signal.provider } : {}),
          isClosed: true,
          closeTime: { gte: targetTime },
        },
        orderBy: { closeTime: 'asc' },
        select: { close: true },
      });

      if (!candle) continue;

      const priceAtDecision = Number(signal.referencePrice);
      const priceAfter = Number(candle.close);

      const decision = signal.decision;
      if (decision !== 'LONG' && decision !== 'SHORT' && decision !== 'WAIT') continue;

      const evalRes = evaluateDecision(
        decision,
        priceAtDecision,
        priceAfter,
        0.1,
      );

      updatedPerf = addShadowReturn(
        updatedPerf,
        evalRes.returnPct,
        evalRes.outcome === 'CORRECT',
      );

      await this.prisma.paperSignal.update({
        where: { id: signal.id },
        data: { outcome: evalRes.outcome, returnPct: evalRes.returnPct },
      });
    }

    const liveRecords = await this.prisma.performanceRecord.findMany({
      where: {
        userId,
        horizon: 'MID',
        decision: { in: ['LONG', 'SHORT'] },
        outcome: { in: ['CORRECT', 'WRONG'] },
      },
      orderBy: { evaluatedAt: 'desc' },
      take: Math.min(500, Math.max(minTrades, updatedPerf.tradesCount)),
    });
    const livePerf = liveRecords.reduce(
      (performance, record) => addShadowReturn(
        performance,
        Number(record.returnPct),
        record.outcome === 'CORRECT',
      ),
      { ...EMPTY_SHADOW_PERFORMANCE },
    );
    const promotion = evaluateShadowPromotion(updatedPerf, livePerf, {
      minTrades,
      minAccuracyLift,
      minProfitFactor,
      minSharpeRatio,
      maxDrawdown,
    });
    const [shadowRegimeSignals, liveRegimeRecords] = await Promise.all([
      this.prisma.paperSignal.findMany({
        where: {
          userId,
          mode: 'SHADOW',
          configurationVersion: candidateVersion,
          outcome: { in: ['CORRECT', 'WRONG'] },
          returnPct: { not: null },
          marketRegime: { not: null },
        },
        select: { marketRegime: true, outcome: true, returnPct: true },
        take: 2_000,
      }),
      this.prisma.performanceRecord.findMany({
        where: {
          userId,
          horizon: 'MID',
          decision: { in: ['LONG', 'SHORT'] },
          outcome: { in: ['CORRECT', 'WRONG'] },
          marketRegime: { not: null },
        },
        select: { marketRegime: true, outcome: true, returnPct: true },
        orderBy: { evaluatedAt: 'desc' },
        take: 2_000,
      }),
    ]);
    const shadowByRegime = this.performanceByRegime(shadowRegimeSignals);
    const liveByRegime = this.performanceByRegime(liveRegimeRecords);
    const comparableRegimes = Object.keys(shadowByRegime).filter((regime) =>
      shadowByRegime[regime]!.tradesCount >= 20 && (liveByRegime[regime]?.tradesCount ?? 0) >= 20);
    const regimeGatePassed = comparableRegimes.length >= 2 && comparableRegimes.every((regime) => {
      const shadow = shadowByRegime[regime]!;
      const live = liveByRegime[regime]!;
      return shadow.accuracy >= live.accuracy &&
        shadow.totalReturn / shadow.tradesCount >= live.totalReturn / live.tradesCount;
    });
    const shouldPromote = promotion.promote && regimeGatePassed;
    const shadowExpired = Boolean(
      config.shadowStartedAt &&
      Date.now() - config.shadowStartedAt.getTime() >= maxShadowDays * 24 * 60 * 60_000,
    );
    const shouldReject = !shouldPromote &&
      (updatedPerf.tradesCount >= rejectAfterTrades || shadowExpired);

    if (shouldPromote) {
      this.logger.log({
        event: 'shadow_configuration_advanced_to_canary',
        userId,
        candidateVersion,
        shadow: updatedPerf,
        live: livePerf,
        accuracyZScore: promotion.accuracyZScore,
      });
      const experiment = await this.prisma.selfLearningExperiment.findUnique({
        where: { userId_version: { userId, version: candidateVersion } },
        select: { id: true, recommendationId: true },
      });
      await this.prisma.selfLearningConfiguration.update({
        where: { userId },
        data: {
          shadowEnabled: false,
          shadowVersion: null,
          shadowStartedAt: null,
          candidateShadowTrades: updatedPerf.tradesCount,
          canaryEnabled: true,
          canaryVersion: candidateVersion,
          canaryWeightsJson: config.shadowWeightsJson ?? BASE_WEIGHTS,
          canaryThreshold: config.shadowThreshold ?? config.confidenceThreshold,
          canaryStartedAt: new Date(),
          previousWeightsJson: config.weightsJson ?? BASE_WEIGHTS,
          previousThreshold: config.confidenceThreshold,
          previousVersion: config.liveVersion,
          shadowPerformance: toShadowPerformanceJson(EMPTY_SHADOW_PERFORMANCE),
        },
      });
      if (experiment) await this.prisma.selfLearningExperimentEvent.create({
        data: {
          experimentId: experiment.id,
          eventType: 'SHADOW_PASSED_CANARY_STARTED',
          payloadJson: { shadow: toShadowPerformanceJson(updatedPerf), live: toShadowPerformanceJson(livePerf), shadowByRegime, liveByRegime } as unknown as Prisma.InputJsonObject,
        },
      });
      if (experiment?.recommendationId) await this.prisma.quantRecommendation.update({ where: { id: experiment.recommendationId }, data: { status: 'CANARY' } });
    } else if (shouldReject) {
      this.logger.warn({
        event: 'shadow_configuration_rejected',
        userId,
        candidateVersion,
        tradesCount: updatedPerf.tradesCount,
        shadowExpired,
        accuracyZScore: promotion.accuracyZScore,
      });
      await this.prisma.paperSignal.updateMany({
        where: {
          userId,
          mode: 'SHADOW',
          outcome: 'PENDING',
          configurationVersion: candidateVersion,
        },
        data: { outcome: 'SUPERSEDED' },
      });
      await this.prisma.selfLearningConfiguration.update({
        where: { userId },
        data: {
          shadowEnabled: false,
          shadowVersion: null,
          shadowStartedAt: null,
          shadowWeightsJson: config.weightsJson ?? BASE_WEIGHTS,
          shadowThreshold: config.confidenceThreshold,
          shadowPerformance: toShadowPerformanceJson(EMPTY_SHADOW_PERFORMANCE),
        },
      });
      const experiment = await this.prisma.selfLearningExperiment.findUnique({
        where: { userId_version: { userId, version: candidateVersion } },
        select: { id: true, recommendationId: true },
      });
      if (experiment) await this.prisma.selfLearningExperimentEvent.create({
        data: {
          experimentId: experiment.id,
          eventType: 'SHADOW_REJECTED',
          payloadJson: { shadow: toShadowPerformanceJson(updatedPerf), shadowExpired, regimeGatePassed },
        },
      });
      if (experiment?.recommendationId) await this.prisma.quantRecommendation.update({ where: { id: experiment.recommendationId }, data: { status: 'REJECTED', rejectionReason: shadowExpired ? 'SHADOW_EXPIRED' : 'SHADOW_PERFORMANCE_FAILED' } });
    } else {
      await this.prisma.selfLearningConfiguration.update({
        where: { userId },
        data: { shadowPerformance: toShadowPerformanceJson(updatedPerf) },
      });
    }
  }

  async evaluateCanary(userId: string): Promise<void> {
    const config = await this.getOrCreateConfig(userId);
    if (!config.canaryEnabled || !config.canaryVersion || !config.canaryStartedAt) return;
    const maxDays = this.config.get<number>('SELF_LEARNING_MAX_CANARY_DAYS', 14);
    const maxDrawdown = this.config.get<number>('SELF_LEARNING_MAX_DRAWDOWN_PCT', 10);
    const commonWhere: Prisma.PerformanceRecordWhereInput = {
      userId,
      horizon: 'MID' as const,
      decision: { in: ['LONG', 'SHORT'] },
      outcome: { in: ['CORRECT', 'WRONG'] },
    };
    const [canaryRows, liveRows] = await Promise.all([
      this.prisma.performanceRecord.findMany({
        where: {
          ...commonWhere,
          run: { configurationVersion: config.canaryVersion, learningStage: 'CANARY' },
        },
        orderBy: { evaluatedAt: 'desc' },
        take: 500,
      }),
      this.prisma.performanceRecord.findMany({
        where: {
          ...commonWhere,
          run: { configurationVersion: config.liveVersion, learningStage: 'LIVE' },
        },
        orderBy: { evaluatedAt: 'desc' },
        take: 500,
      }),
    ]);
    const canary = this.performanceFromRows(canaryRows);
    const live = this.performanceFromRows(liveRows);
    const canaryByRegime = this.performanceByRegime(canaryRows);
    const liveByRegime = this.performanceByRegime(liveRows);
    const regimes = Object.keys(canaryByRegime).filter((regime) =>
      canaryByRegime[regime]!.tradesCount >= 10 && (liveByRegime[regime]?.tradesCount ?? 0) >= 10);
    const regimeGate = regimes.length >= 2 && regimes.every((regime) => {
      const candidate = canaryByRegime[regime]!;
      const baseline = liveByRegime[regime]!;
      return candidate.accuracy >= baseline.accuracy &&
        candidate.totalReturn / candidate.tradesCount >= baseline.totalReturn / baseline.tradesCount;
    });
    const canaryExpectancy = canary.tradesCount > 0 ? canary.totalReturn / canary.tradesCount : 0;
    const eligibilityMetrics: LiveEligibilityMetrics = {
      outOfSampleAccuracy: canary.accuracy / 100,
      expectancy: canaryExpectancy,
      profitFactor: canary.profitFactor,
      sharpeRatio: canary.sharpeRatio,
      maxDrawdownPct: canary.maxDrawdown,
      shadowTrades: config.candidateShadowTrades || 0,
      canaryTrades: canary.tradesCount,
    };
    const eligibility = evaluateLiveEligibility(eligibilityMetrics);
    const canAdvanceToEligible = eligibility.eligible && regimeGate;
    const severeRegression = canary.tradesCount >= 20 && (
      canary.accuracy < live.accuracy - 8 ||
      canary.profitFactor < 0.8 ||
      canary.sharpeRatio < -0.5 ||
      canary.maxDrawdown > maxDrawdown * 1.25
    );
    const expired = Date.now() - config.canaryStartedAt.getTime() >= maxDays * 86_400_000;
    const experiment = await this.prisma.selfLearningExperiment.findUnique({
      where: { userId_version: { userId, version: config.canaryVersion } },
      select: { id: true, recommendationId: true },
    });

    if (canAdvanceToEligible) {
      const candidateWeights = (config.canaryWeightsJson ?? config.weightsJson ?? BASE_WEIGHTS) as Record<string, number>;
      const candidateThreshold = config.canaryThreshold ?? config.confidenceThreshold;
      const configurationHash = computeConfigurationHash({
        version: config.canaryVersion,
        weights: candidateWeights,
        confidenceThreshold: candidateThreshold,
        policyVersion: LIVE_ELIGIBILITY_POLICY_VERSION,
        advisoryPolicyHash: 'advisory-disabled',
      });

      await this.prisma.selfLearningConfiguration.update({
        where: { userId },
        data: {
          eligibleVersion: config.canaryVersion,
          eligibleWeightsJson: candidateWeights,
          eligibleThreshold: candidateThreshold,
          eligibleMetricsJson: eligibilityMetrics as unknown as Prisma.InputJsonObject,
          eligibleConfigurationHash: configurationHash,
          eligibleAt: new Date(),
          canaryEnabled: false,
          canaryVersion: null,
          canaryWeightsJson: Prisma.DbNull,
          canaryThreshold: null,
          canaryStartedAt: null,
        },
      });
      if (experiment) {
        await this.appendExperimentEvent(experiment.id, 'CANARY_PASSED_LIVE_ELIGIBLE', {
          candidateVersion: config.canaryVersion,
          configurationHash,
          eligibilityMetrics,
          canary,
          live,
          canaryByRegime,
          liveByRegime,
        });
      }
      if (experiment?.recommendationId) {
        await this.prisma.quantRecommendation.update({
          where: { id: experiment.recommendationId },
          data: { status: 'PENDING_APPROVAL' },
        });
      }
    } else if (severeRegression || expired) {
      await this.prisma.selfLearningConfiguration.update({
        where: { userId },
        data: {
          canaryEnabled: false,
          canaryVersion: null,
          canaryWeightsJson: Prisma.DbNull,
          canaryThreshold: null,
          canaryStartedAt: null,
          previousWeightsJson: Prisma.DbNull,
          previousThreshold: null,
          previousVersion: null,
        },
      });
      if (experiment) await this.appendExperimentEvent(experiment.id, 'CANARY_ROLLED_BACK', { canary, live, severeRegression, expired });
      if (experiment?.recommendationId) await this.prisma.quantRecommendation.update({ where: { id: experiment.recommendationId }, data: { status: 'ROLLED_BACK', rejectionReason: expired ? 'CANARY_EXPIRED' : 'CANARY_REGRESSION' } });
    }
  }

  async reviewLiveEligibility(userId: string, dto: LiveEligibilityReviewInput) {
    const { action, version, configurationHash, confirmed, reason } = dto;
    if (!confirmed) throw new BadRequestException('Explicit confirmation is required');

    return await this.prisma.$transaction(async (tx) => {
      const config = await tx.selfLearningConfiguration.findUnique({
        where: { userId },
      });
      if (!config || !config.eligibleVersion || !config.eligibleConfigurationHash) {
        throw new ConflictException('No candidate is currently eligible for live review');
      }
      if (config.eligibleVersion !== version || config.eligibleConfigurationHash !== configurationHash) {
        throw new ConflictException('Candidate version or configuration hash mismatch (stale review)');
      }

      const eligibleWeights = (config.eligibleWeightsJson ?? BASE_WEIGHTS) as Record<string, number>;
      const eligibleThreshold = config.eligibleThreshold ?? 60.0;
      const recomputedHash = computeConfigurationHash({
        version: config.eligibleVersion,
        weights: eligibleWeights,
        confidenceThreshold: eligibleThreshold,
        policyVersion: LIVE_ELIGIBILITY_POLICY_VERSION,
        advisoryPolicyHash: 'advisory-disabled',
      });
      if (recomputedHash !== configurationHash) {
        throw new ConflictException('Recomputed configuration hash does not match candidate hash');
      }

      const experiment = await tx.selfLearningExperiment.findUnique({
        where: { userId_version: { userId, version } },
        select: { id: true, recommendationId: true },
      });

      if (action === 'APPROVE') {
        const updateResult = await tx.selfLearningConfiguration.updateMany({
          where: {
            userId,
            eligibleVersion: version,
            eligibleConfigurationHash: configurationHash,
          },
          data: {
            previousWeightsJson: config.weightsJson ?? BASE_WEIGHTS,
            previousThreshold: config.confidenceThreshold,
            previousVersion: config.liveVersion,
            weightsJson: eligibleWeights,
            confidenceThreshold: eligibleThreshold,
            liveVersion: version,
            approvedVersion: version,
            approvedConfigurationHash: configurationHash,
            approvedAt: new Date(),
            lastPromotionAt: new Date(),
            eligibleVersion: null,
            eligibleWeightsJson: Prisma.DbNull,
            eligibleThreshold: null,
            eligibleMetricsJson: Prisma.DbNull,
            eligibleConfigurationHash: null,
            eligibleAt: null,
            candidateShadowTrades: 0,
          },
        });

        if (updateResult.count !== 1) {
          throw new ConflictException('Concurrent modification detected during promotion');
        }

        if (experiment) {
          await tx.selfLearningExperimentEvent.create({
            data: {
              experimentId: experiment.id,
              eventType: 'LIVE_ELIGIBILITY_APPROVED',
              payloadJson: {
                version,
                configurationHash,
                approvedAt: new Date().toISOString(),
                reason: reason ?? 'User approved live strategy promotion',
              },
            },
          });
          if (experiment.recommendationId) {
            await tx.quantRecommendation.update({
              where: { id: experiment.recommendationId },
              data: { status: 'DEPLOYED' },
            });
          }
        }
      } else {
        const updateResult = await tx.selfLearningConfiguration.updateMany({
          where: {
            userId,
            eligibleVersion: version,
            eligibleConfigurationHash: configurationHash,
          },
          data: {
            eligibleVersion: null,
            eligibleWeightsJson: Prisma.DbNull,
            eligibleThreshold: null,
            eligibleMetricsJson: Prisma.DbNull,
            eligibleConfigurationHash: null,
            eligibleAt: null,
            candidateShadowTrades: 0,
          },
        });

        if (updateResult.count !== 1) {
          throw new ConflictException('Concurrent modification detected during rejection');
        }

        if (experiment) {
          await tx.selfLearningExperimentEvent.create({
            data: {
              experimentId: experiment.id,
              eventType: 'LIVE_ELIGIBILITY_REJECTED',
              payloadJson: {
                version,
                configurationHash,
                rejectedAt: new Date().toISOString(),
                reason: reason ?? 'User rejected live strategy candidate',
              },
            },
          });
          if (experiment.recommendationId) {
            await tx.quantRecommendation.update({
              where: { id: experiment.recommendationId },
              data: { status: 'REJECTED', rejectionReason: reason ?? 'USER_REJECTED' },
            });
          }
        }
      }

      return this.lifecycleStatus(userId);
    });
  }

  async evaluateLiveRollback(userId: string): Promise<boolean> {
    const config = await this.getOrCreateConfig(userId);
    if (config.canaryEnabled || !config.previousVersion || !config.previousWeightsJson || !config.lastPromotionAt) return false;
    const commonWhere: Prisma.PerformanceRecordWhereInput = {
      userId,
      horizon: 'MID' as const,
      decision: { in: ['LONG', 'SHORT'] },
      outcome: { in: ['CORRECT', 'WRONG'] },
    };
    const [currentRows, previousRows] = await Promise.all([
      this.prisma.performanceRecord.findMany({
        where: { ...commonWhere, evaluatedAt: { gte: config.lastPromotionAt }, run: { configurationVersion: config.liveVersion } },
        orderBy: { evaluatedAt: 'desc' },
        take: 200,
      }),
      this.prisma.performanceRecord.findMany({
        where: { ...commonWhere, run: { configurationVersion: config.previousVersion } },
        orderBy: { evaluatedAt: 'desc' },
        take: 200,
      }),
    ]);
    const current = this.performanceFromRows(currentRows);
    const previous = this.performanceFromRows(previousRows);
    if (current.tradesCount < 30 || previous.tradesCount < 30) return false;
    const shouldRollback = current.accuracy < previous.accuracy - 8 ||
      current.profitFactor < Math.max(0.8, previous.profitFactor * 0.7) ||
      current.maxDrawdown > Math.max(10, previous.maxDrawdown * 1.5);
    if (!shouldRollback) {
      if (current.tradesCount >= 100) {
        await this.prisma.selfLearningConfiguration.update({
          where: { userId },
          data: {
            previousWeightsJson: Prisma.DbNull,
            previousThreshold: null,
            previousVersion: null,
          },
        });
        const stableExperiment = await this.prisma.selfLearningExperiment.findUnique({
          where: { userId_version: { userId, version: config.liveVersion } },
          select: { id: true },
        });
        if (stableExperiment) await this.appendExperimentEvent(stableExperiment.id, 'LIVE_STABILIZED', { current, previous });
      }
      return false;
    }

    const failedVersion = config.liveVersion;
    await this.prisma.selfLearningConfiguration.update({
      where: { userId },
      data: {
        weightsJson: config.previousWeightsJson,
        confidenceThreshold: config.previousThreshold ?? config.confidenceThreshold,
        liveVersion: config.previousVersion,
        previousWeightsJson: Prisma.DbNull,
        previousThreshold: null,
        previousVersion: null,
      },
    });
    const experiment = await this.prisma.selfLearningExperiment.findUnique({
      where: { userId_version: { userId, version: failedVersion } },
      select: { id: true, recommendationId: true },
    });
    if (experiment) await this.appendExperimentEvent(experiment.id, 'LIVE_AUTO_ROLLED_BACK', { current, previous });
    if (experiment?.recommendationId) await this.prisma.quantRecommendation.update({ where: { id: experiment.recommendationId }, data: { status: 'ROLLED_BACK', rejectionReason: 'LIVE_REGRESSION' } });
    return true;
  }

  private learningObservation(run: LearningRun): {
    actualDirection: 'LONG' | 'SHORT';
    decision: 'LONG' | 'SHORT';
    votes: Record<AnalystName, 'LONG' | 'SHORT' | 'WAIT'>;
  } | undefined {
    const stored = run.storedContext as StoredContextPayload | null;
    if (!stored?.analyses) return undefined;
    const record = run.performanceRecords.find((item) => item.horizon === 'LONG') ??
      run.performanceRecords.find((item) => item.horizon === 'MID') ??
      run.performanceRecords.find((item) => item.horizon === 'SHORT');
    if (!record || record.outcome === 'NEUTRAL' || !['LONG', 'SHORT'].includes(record.decision)) return undefined;
    const actualDirection = record.outcome === 'CORRECT'
      ? record.decision as 'LONG' | 'SHORT'
      : record.decision === 'LONG' ? 'SHORT' : 'LONG';
    const agents = Object.keys(BASE_WEIGHTS) as AnalystName[];
    const votes = Object.fromEntries(agents.map((agent) => [
      agent,
      this.agentVote(agent, stored.analyses?.[agent]),
    ])) as Record<AnalystName, 'LONG' | 'SHORT' | 'WAIT'>;
    return { actualDirection, decision: record.decision as 'LONG' | 'SHORT', votes };
  }

  private agentVote(agent: AnalystName, analysis?: AgentAnalysisSnapshot): 'LONG' | 'SHORT' | 'WAIT' {
    if (!analysis || analysis.dataQuality === 'INSUFFICIENT') return 'WAIT';
    if (agent === 'market' || agent === 'technical') {
      return analysis.trend?.direction === 'UP' ? 'LONG' : analysis.trend?.direction === 'DOWN' ? 'SHORT' : 'WAIT';
    }
    if (agent === 'news') {
      return analysis.focusDirection === 'BULLISH' || analysis.impact?.direction === 'POSITIVE'
        ? 'LONG'
        : analysis.focusDirection === 'BEARISH' || analysis.impact?.direction === 'NEGATIVE' ? 'SHORT' : 'WAIT';
    }
    if (agent === 'sentiment') {
      return analysis.sentiment?.overall === 'BULLISH' ? 'LONG' : analysis.sentiment?.overall === 'BEARISH' ? 'SHORT' : 'WAIT';
    }
    if (agent === 'macro') {
      return analysis.macroTrend === 'RISK_ON' ? 'LONG' : analysis.macroTrend === 'RISK_OFF' ? 'SHORT' : 'WAIT';
    }
    return analysis.activity === 'HIGH' ? 'LONG' : analysis.activity === 'LOW' ? 'SHORT' : 'WAIT';
  }

  private scoreWeights(runs: LearningRun[], weights: Record<AnalystName, number>): { total: number; correct: number; accuracy: number } {
    let total = 0;
    let correct = 0;
    for (const run of runs) {
      const observation = this.learningObservation(run);
      if (!observation) continue;
      const score = (Object.keys(weights) as AnalystName[]).reduce((sum, agent) => {
        const vote = observation.votes[agent];
        return sum + (vote === 'LONG' ? weights[agent] : vote === 'SHORT' ? -weights[agent] : 0);
      }, 0);
      if (score === 0) continue;
      total++;
      if ((score > 0 ? 'LONG' : 'SHORT') === observation.actualDirection) correct++;
    }
    return { total, correct, accuracy: total ? correct / total * 100 : 0 };
  }

  private scoreThreshold(runs: LearningRun[], threshold: number): { total: number; correct: number; accuracy: number } {
    let total = 0;
    let correct = 0;
    for (const run of runs) {
      if (run.confidence === null || run.confidence < threshold) continue;
      const observation = this.learningObservation(run);
      if (!observation) continue;
      total++;
      if (observation.decision === observation.actualDirection) correct++;
    }
    return { total, correct, accuracy: total ? correct / total * 100 : 0 };
  }

  private selectThreshold(trainingRuns: LearningRun[], liveThreshold: number): number {
    const candidates = [55, 60, 65, 70, 75];
    const eligible = candidates
      .map((threshold) => ({ threshold, result: this.scoreThreshold(trainingRuns, threshold) }))
      .filter(({ result }) => result.total >= 20)
      .sort((a, b) => b.result.accuracy - a.result.accuracy || b.result.total - a.result.total);
    return eligible[0]?.threshold ?? liveThreshold;
  }

  private performanceFromRows(rows: Array<{ outcome: string; returnPct: number }>): ShadowPerformance {
    return rows.reduce((performance, row) => addShadowReturn(
      performance,
      Number(row.returnPct),
      row.outcome === 'CORRECT',
    ), { ...EMPTY_SHADOW_PERFORMANCE });
  }

  private appendExperimentEvent(experimentId: string, eventType: string, payload: unknown) {
    return this.prisma.selfLearningExperimentEvent.create({
      data: { experimentId, eventType, payloadJson: payload as Prisma.InputJsonObject },
    });
  }

  private performanceByRegime(rows: Array<{ marketRegime: string | null; outcome: string; returnPct: number | null }>): Record<string, ShadowPerformance> {
    const grouped: Record<string, ShadowPerformance> = {};
    for (const row of rows) {
      if (!row.marketRegime || row.returnPct === null || !['CORRECT', 'WRONG'].includes(row.outcome)) continue;
      grouped[row.marketRegime] = addShadowReturn(
        grouped[row.marketRegime] ?? EMPTY_SHADOW_PERFORMANCE,
        Number(row.returnPct),
        row.outcome === 'CORRECT',
      );
    }
    return grouped;
  }
}
