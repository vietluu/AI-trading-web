import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { BASE_WEIGHTS } from '../../agents/domain/constants/decision.constants';
import type { AnalystName } from '../../agents/domain/types/decision-service.types';
import { evaluateDecision } from '../domain/performance-calculator';

export interface ShadowPerformance {
  tradesCount: number;
  correctCount: number;
  accuracy: number;
  totalReturn: number;
}

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

function toShadowPerformanceJson(value: ShadowPerformance): Prisma.InputJsonObject {
  return {
    tradesCount: value.tradesCount,
    correctCount: value.correctCount,
    accuracy: value.accuracy,
    totalReturn: value.totalReturn,
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
    };
  }

  return {
    tradesCount: 0,
    correctCount: 0,
    accuracy: 0,
    totalReturn: 0,
  };
}

@Injectable()
export class SelfLearningService {
  private readonly logger = new Logger(SelfLearningService.name);

  constructor(private readonly prisma: PrismaService) {}

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
          shadowPerformance: toShadowPerformanceJson({
            tradesCount: 0,
            correctCount: 0,
            accuracy: 0,
            totalReturn: 0,
          }),
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
    if (!config.isEnabled || config.shadowEnabled) return;

    // Fetch last 50 performance records (MID/LONG horizons represent true outcomes)
    const records = await this.prisma.performanceRecord.findMany({
      where: { userId, horizon: { in: ['MID', 'LONG'] } },
      orderBy: { evaluatedAt: 'desc' },
      take: 50,
    });

    if (records.length < 10) {
      this.logger.log(`Skipping auto-tuning for user ${userId}: not enough history (${records.length}/10 records).`);
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

    // Never mutate live parameters directly. The candidate threshold is tested
    // by the same shadow promotion gate as candidate weights.
    await this.prisma.selfLearningConfiguration.update({
      where: { userId },
      data: {
        shadowThreshold: nextThreshold,
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
    if (!config.isEnabled || config.shadowEnabled) return;

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
      take: 30,
    });

    if (runs.length < 5) return;

    const agentScores: Record<AnalystName, { correct: number; total: number }> = {
      market: { correct: 0, total: 0 },
      technical: { correct: 0, total: 0 },
      news: { correct: 0, total: 0 },
      sentiment: { correct: 0, total: 0 },
      macro: { correct: 0, total: 0 },
      onchain: { correct: 0, total: 0 },
    };

    for (const run of runs) {
      const stored = run.storedContext as StoredContextPayload | null;
      if (!stored?.analyses) continue;

      // Find actual outcome (MID or LONG horizon preferred, fallback to SHORT)
      const record = run.performanceRecords.find((r) => r.horizon === 'LONG') ||
                     run.performanceRecords.find((r) => r.horizon === 'MID') ||
                     run.performanceRecords.find((r) => r.horizon === 'SHORT');
      if (!record || record.outcome === 'NEUTRAL') continue;

      // Actual direction is matching decision if CORRECT, or opposite if WRONG
      const actualDirection = record.outcome === 'CORRECT'
        ? record.decision
        : (record.decision === 'LONG' ? 'SHORT' : 'LONG');

      const agents = Object.keys(agentScores) as AnalystName[];
      for (const agent of agents) {
        const analysis = stored.analyses[agent];
        if (!analysis || analysis.dataQuality === 'INSUFFICIENT') continue;

        let agentVote: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
        if (agent === 'market' || agent === 'technical') {
          agentVote = analysis.trend?.direction === 'UP' ? 'LONG' : analysis.trend?.direction === 'DOWN' ? 'SHORT' : 'WAIT';
        } else if (agent === 'news') {
          agentVote = analysis.focusDirection === 'BULLISH' || analysis.impact?.direction === 'POSITIVE' ? 'LONG' : analysis.focusDirection === 'BEARISH' || analysis.impact?.direction === 'NEGATIVE' ? 'SHORT' : 'WAIT';
        } else if (agent === 'sentiment') {
          const overall = analysis.sentiment?.overall;
          agentVote = overall === 'BULLISH' ? 'LONG' : overall === 'BEARISH' ? 'SHORT' : 'WAIT';
        } else if (agent === 'macro') {
          agentVote = analysis.macroTrend === 'RISK_ON' ? 'LONG' : analysis.macroTrend === 'RISK_OFF' ? 'SHORT' : 'WAIT';
        } else if (agent === 'onchain') {
          const activity = analysis.activity;
          agentVote = activity === 'HIGH' ? 'LONG' : activity === 'LOW' ? 'SHORT' : 'WAIT';
        }

        if (agentVote !== 'WAIT') {
          agentScores[agent].total++;
          if (agentVote === actualDirection) {
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
      const accuracy = score.total > 0 ? score.correct / score.total : 0.5; // default 50%
      // Modulate weight: base weight scale factor based on performance
      const performanceMultiplier = 0.5 + accuracy; // range [0.5, 1.5]
      const rawWeight = BASE_WEIGHTS[agent] * performanceMultiplier;
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

    // Phase C: Shadow Mode Setup
    // Save new configuration as a candidate (shadow) config instead of replacing live weights immediately
    await this.prisma.selfLearningConfiguration.update({
      where: { userId },
      data: {
        shadowWeightsJson: newWeights,
        shadowThreshold: config.shadowThreshold ?? config.confidenceThreshold,
        shadowEnabled: true,
        shadowVersion: config.liveVersion + 1,
        shadowStartedAt: new Date(),
        shadowPerformance: toShadowPerformanceJson({
          tradesCount: 0,
          correctCount: 0,
          accuracy: 0,
          totalReturn: 0,
        }),
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

    const pendingSignals = await this.prisma.paperSignal.findMany({
      where: { userId, mode: 'SHADOW', outcome: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingSignals.length === 0) return;

    let evaluatedCount = 0;
    let correctCount = 0;
    let totalReturn = 0;

    const shadowPerf = parseShadowPerformance(config.shadowPerformance);

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

      evaluatedCount++;
      if (evalRes.outcome === 'CORRECT') correctCount++;
      totalReturn += evalRes.returnPct;

      await this.prisma.paperSignal.update({
        where: { id: signal.id },
        data: { outcome: evalRes.outcome },
      });
    }

    if (evaluatedCount > 0) {
      const nextTradesCount = shadowPerf.tradesCount + evaluatedCount;
      const nextCorrectCount = shadowPerf.correctCount + correctCount;
      const nextAccuracy = nextTradesCount > 0 ? (nextCorrectCount / nextTradesCount) * 100 : 0;
      const nextTotalReturn = shadowPerf.totalReturn + totalReturn;

      const updatedPerf: ShadowPerformance = {
        tradesCount: nextTradesCount,
        correctCount: nextCorrectCount,
        accuracy: nextAccuracy,
        totalReturn: nextTotalReturn,
      };

      // Auto-Promote check:
      // Promotion requires a useful sample, positive virtual return, and a
      // measurable improvement over directional live decisions.
      const liveRecords = await this.prisma.performanceRecord.findMany({
        where: { userId, horizon: 'MID' },
        orderBy: { evaluatedAt: 'desc' },
        take: 30,
      });

      const liveDirectional = liveRecords.filter((r) => r.decision !== 'WAIT' && r.outcome !== 'NEUTRAL');
      const liveCorrect = liveDirectional.filter((r) => r.outcome === 'CORRECT').length;
      const liveAccuracy = liveDirectional.length > 0 ? (liveCorrect / liveDirectional.length) * 100 : 60;

      const shouldPromote = nextTradesCount >= 50 && nextAccuracy > liveAccuracy + 3.0 && nextTotalReturn > 0;
      const shouldReject = nextTradesCount >= 200 && !shouldPromote;

      if (shouldPromote) {
        this.logger.log(`Auto-Promoting shadow config to Live! Shadow accuracy: ${nextAccuracy.toFixed(1)}% vs Live: ${liveAccuracy.toFixed(1)}%`);
        await this.prisma.selfLearningConfiguration.update({
          where: { userId },
          data: {
            weightsJson: config.shadowWeightsJson ?? BASE_WEIGHTS,
            confidenceThreshold: config.shadowThreshold ?? config.confidenceThreshold,
            shadowEnabled: false, // Turn off shadow testing until next optimization
            liveVersion: config.shadowVersion ?? config.liveVersion + 1,
            shadowVersion: null,
            shadowStartedAt: null,
            lastPromotionAt: new Date(),
            shadowPerformance: toShadowPerformanceJson({
              tradesCount: 0,
              correctCount: 0,
              accuracy: 0,
              totalReturn: 0,
            }),
          },
        });
      } else if (shouldReject) {
        this.logger.warn(`Rejecting shadow config after ${nextTradesCount} trades without sufficient improvement.`);
        await this.prisma.selfLearningConfiguration.update({
          where: { userId },
          data: {
            shadowEnabled: false,
            shadowVersion: null,
            shadowStartedAt: null,
            shadowWeightsJson: config.weightsJson ?? BASE_WEIGHTS,
            shadowThreshold: config.confidenceThreshold,
            shadowPerformance: toShadowPerformanceJson({ tradesCount: 0, correctCount: 0, accuracy: 0, totalReturn: 0 }),
          },
        });
      } else {
        await this.prisma.selfLearningConfiguration.update({
          where: { userId },
          data: {
            shadowPerformance: toShadowPerformanceJson(updatedPerf),
          },
        });
      }
    }
  }
}
