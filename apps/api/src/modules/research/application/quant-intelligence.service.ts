import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

type QuantRecommendation = {
  id?: string;
  title: string;
  moduleSource: string;
  problemStatement: string;
  evidenceText: string;
  historicalResult: Record<string, unknown>;
  expectedBenefit: string;
  estimatedRisk: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  implementationCost: string;
  rollbackPlan: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'DEPLOYED' | 'ROLLED_BACK';
  reviewedByUserId?: string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

interface QuantRecommendationRecord {
  id: string;
  userId?: string | null;
  title: string;
  moduleSource: string;
  problemStatement: string;
  evidenceText: string;
  historicalResult?: Prisma.InputJsonValue | null;
  expectedBenefit: string;
  estimatedRisk: string;
  priority: QuantRecommendation['priority'];
  implementationCost: string;
  rollbackPlan: string;
  status: QuantRecommendation['status'];
  reviewedByUserId?: string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
import { buildQuantRecommendation } from '../domain/explainability-governance.engine';
import { generateQuantHypothesis, type HypothesisInput } from '../domain/quant-research.engine';
import { discoverStrategies } from '../domain/strategy-discovery.engine';
import { evaluateFactors } from '../domain/factor-discovery.engine';
import { runAutoBenchmark } from '../domain/auto-benchmark.engine';
import { optimizeThresholds, optimizeWeights, type OptimizedWeightsResult } from '../domain/weight-threshold-optimizer.engine';
import { analyzePortfolioIntelligence } from '../domain/portfolio-intelligence.engine';
import { generateSelfLearningInsights } from '../domain/self-learning.engine';
import { detectMarketRegimeIntelligence } from '../domain/regime-intelligence.engine';
import { generateDefaultRecommendations } from '../domain/explainability-governance.engine';
import { runSimulationExperiment, type SimulationRequest } from '../domain/simulation-lab.engine';
import { calculateDecisionScorecard } from '../domain/decision-scorecard.engine';
import { QuantReportService } from './quant-report.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { SyntheticSimulationService } from './synthetic-simulation.service';

@Injectable()
export class QuantIntelligenceService {
  private readonly logger = new Logger(QuantIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportService: QuantReportService,
    private readonly knowledgeService: KnowledgeBaseService,
  ) {}

  private readonly syntheticSimulationService = new SyntheticSimulationService();

  getDecisionScorecard() {
    return calculateDecisionScorecard();
  }

  generateHypothesis(category?: HypothesisInput['category'], symbol = 'BTC-USDT') {
    return generateQuantHypothesis({ category: category ?? 'FACTOR_COMBINATION', symbol });
  }

  getDiscoveredStrategies(symbol = 'BTC-USDT') {
    return discoverStrategies(symbol);
  }

  getFactorEvaluations() {
    return evaluateFactors();
  }

  getAutoBenchmarks(strategyName = 'AI Multi-Agent Strategy') {
    return runAutoBenchmark(strategyName);
  }

  getOptimizedWeights(scope: OptimizedWeightsResult['scope'] = 'AGENT') {
    return optimizeWeights(scope);
  }

  getOptimizedThresholds() {
    return optimizeThresholds();
  }

  private normalizeMarketRegime(regime?: string): 'TRENDING' | 'SIDEWAYS' | 'HIGH_VOLATILITY' {
    const value = (regime ?? '').toUpperCase();
    if (['BULL', 'BEAR', 'TRENDING'].includes(value)) return 'TRENDING';
    if (['HIGH_VOLATILITY', 'PANIC', 'EUPHORIA'].includes(value)) return 'HIGH_VOLATILITY';
    return 'SIDEWAYS';
  }

  async getPortfolioIntelligence(userId?: string) {
    if (!userId) {
      return analyzePortfolioIntelligence();
    }

    const strategies = await this.prisma.portfolioStrategy.findMany({
      where: { userId },
      include: { allocation: true, performance: true, livePositions: true },
      orderBy: { createdAt: 'asc' },
    });

    const regimeReport = await this.getRegimeIntelligence();
    const marketRegime = this.normalizeMarketRegime(regimeReport.detectedRegime);

    return analyzePortfolioIntelligence(
      strategies.map((strategy) => {
        const livePositions = strategy.livePositions ?? [];
        const livePnl = livePositions.reduce((sum, item) => sum + Number(item.unrealizedPnl) + Number(item.realizedPnl ?? 0), 0);
        return {
          key: strategy.key,
          name: strategy.name,
          allocation: strategy.allocation
            ? {
                weight: Number(strategy.allocation.weight),
                allocatedCapital: Number(strategy.allocation.allocatedCapital),
              }
            : undefined,
          performance: strategy.performance
            ? {
                totalTrades: strategy.performance.totalTrades,
                winRate: strategy.performance.winRate,
                returnPct: Number(strategy.performance.returnPct),
                drawdownPct: Number(strategy.performance.drawdownPct),
                sharpeRatio: strategy.performance.sharpeRatio ? Number(strategy.performance.sharpeRatio) : null,
              }
            : undefined,
          livePerformance: {
            unrealizedPnl: livePnl,
            realizedPnl: livePositions.reduce((sum, item) => sum + Number(item.realizedPnl ?? 0), 0),
            positionCount: livePositions.length,
          },
          marketRegime,
        };
      }),
    );
  }

  getSelfLearningInsights() {
    return generateSelfLearningInsights();
  }

  async getRegimeIntelligence(symbol = 'BTC-USDT') {
    const fallback = detectMarketRegimeIntelligence(symbol);
    const persisted = await this.prisma.marketRegimeState.findFirst({
      where: { symbol },
      orderBy: { detectedAt: 'desc' },
    });

    if (!persisted?.regime) {
      return fallback;
    }

    return {
      ...fallback,
      detectedRegime: persisted.regime,
      confidence: Number(persisted.confidence ?? fallback.confidence),
    };
  }

  async getRecommendations(userId?: string): Promise<QuantRecommendation[]> {
    try {
      const dbRecs = await this.prisma.quantRecommendation.findMany({
        where: userId ? { userId } : undefined,
        orderBy: { createdAt: 'desc' },
      });
      const normalizedDbRecs: QuantRecommendation[] = (dbRecs ?? []).map((item: QuantRecommendationRecord) => ({
        ...item,
        historicalResult: (item.historicalResult ?? {}) as Record<string, unknown>,
      }));
      if (normalizedDbRecs.length > 0) {
        return normalizedDbRecs;
      }

      if (userId) {
        await this.refreshRecommendations(userId);
        const refreshed = await this.prisma.quantRecommendation.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        return (refreshed ?? []).map((item: QuantRecommendationRecord) => ({
          ...item,
          historicalResult: (item.historicalResult ?? {}) as Record<string, unknown>,
        }));
      }

      return [];
    } catch (error) {
      this.logger.warn({
        event: 'quant_recommendations_db_error',
        message: 'Database query failed or unmigrated; returning empty list',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async refreshRecommendations(userId: string) {
    const strategies = await this.prisma.portfolioStrategy.findMany({
      where: { userId },
      include: { performance: true, allocation: true, livePositions: true },
      orderBy: { createdAt: 'asc' },
    });

    const regimeReport = await this.getRegimeIntelligence();
    const marketRegime = this.normalizeMarketRegime(regimeReport.detectedRegime);

    const recommendations = strategies
      .filter((strategy) => strategy.performance || strategy.livePositions.length > 0)
      .map((strategy) => {
        const returnPct = Number(strategy.performance?.returnPct ?? 0);
        const drawdownPct = Number(strategy.performance?.drawdownPct ?? 0);
        const weight = Number(strategy.allocation?.weight ?? 0);
        const livePnl = strategy.livePositions.reduce((sum, item) => sum + Number(item.unrealizedPnl) + Number(item.realizedPnl ?? 0), 0);
        const liveSignal = livePnl > 0 ? 0.02 : livePnl < 0 ? -0.02 : 0;
        const regimeSignal = marketRegime === 'TRENDING' ? 0.03 : marketRegime === 'HIGH_VOLATILITY' ? -0.04 : 0.01;
        const delta = Math.max(-0.12, Math.min(0.12, returnPct * 0.08 - drawdownPct * 0.2 + liveSignal + regimeSignal));
        const recommendedWeight = Math.max(0.05, Math.min(0.4, weight + delta));
        return buildQuantRecommendation({
          title: `Adjust ${strategy.name} allocation to ${Math.round(recommendedWeight * 100)}%`,
          moduleSource: 'PORTFOLIO_INTELLIGENCE',
          problemStatement: `Strategy ${strategy.name} should be rebalanced based on live exchange positions and the current ${marketRegime.toLowerCase()} regime.`,
          evidenceText: `Current weight ${Math.round(weight * 100)}%, live pnl ${(livePnl).toFixed(2)}, return ${(returnPct * 100).toFixed(2)}%, drawdown ${(drawdownPct * 100).toFixed(2)}%.`,
          historicalResult: { returnPct, drawdownPct, recommendedWeight, marketRegime, livePnl },
          expectedBenefit: 'Improves portfolio risk-adjusted returns by reweighting to live performance.',
          estimatedRisk: 'Medium if market regime changes abruptly.',
          priority: drawdownPct > 0.05 || marketRegime === 'HIGH_VOLATILITY' ? 'HIGH' : 'MEDIUM',
          implementationCost: 'LOW',
          rollbackPlan: 'Revert the allocation weight using the portfolio rebalance endpoint.',
        });
      });

    const quantRecommendationModel = this.prisma.quantRecommendation;

    await quantRecommendationModel.deleteMany({ where: { userId } });
    await quantRecommendationModel.createMany({
      data: recommendations.map((item) => ({
        userId,
        title: item.title,
        moduleSource: item.moduleSource,
        problemStatement: item.problemStatement,
        evidenceText: item.evidenceText,
        historicalResult: item.historicalResult as Prisma.InputJsonValue,
        expectedBenefit: item.expectedBenefit,
        estimatedRisk: item.estimatedRisk,
        priority: item.priority,
        implementationCost: item.implementationCost,
        rollbackPlan: item.rollbackPlan,
        status: 'PENDING_APPROVAL',
      })),
    });

    return recommendations;
  }

  async applyStrategyRecommendation(userId: string, strategyKey: string, targetWeight?: number) {
    const strategies = await this.prisma.portfolioStrategy.findMany({
      where: { userId },
      include: { allocation: true },
      orderBy: { createdAt: 'asc' },
    });

    const strategy = strategies.find((item) => item.key === strategyKey);
    if (!strategy) throw new NotFoundException('Portfolio strategy not found');

    const requestedWeight = Number.isFinite(targetWeight)
      ? Math.max(0.05, Math.min(0.95, Number(targetWeight)))
      : Math.max(0.05, Math.min(0.95, Number(strategy.allocation?.weight ?? 0.2)));
    const others = strategies.filter((item) => item.id !== strategy.id);
    const remainingWeight = Math.max(0.01, 1 - requestedWeight);
    const otherCurrentWeight = others.reduce((sum, item) => sum + Math.max(0.01, Number(item.allocation?.weight ?? 0.01)), 0);
    const normalizedWeights = strategies.map((item) => {
      if (item.id === strategy.id) return requestedWeight;
      if (!others.length) return 0;
      const currentWeight = Math.max(0.01, Number(item.allocation?.weight ?? 0.01));
      const proportionalWeight = otherCurrentWeight > 0
        ? remainingWeight * currentWeight / otherCurrentWeight
        : remainingWeight / Math.max(1, others.length);
      return Math.max(0.01, proportionalWeight);
    });

    const totalWeight = normalizedWeights.reduce((sum, value) => sum + value, 0) || 1;
    const finalWeights = normalizedWeights.map((value) => value / totalWeight);
    const totalCapital = strategies.reduce((sum, item) => sum + Number(item.allocation?.allocatedCapital ?? 0), 0) || 100_000;

    await Promise.all(
      strategies.map((item, index) => {
        const weight = Number(finalWeights[index] ?? 0.01);
        const allocatedCapital = totalCapital > 0 ? totalCapital * weight : 100_000 * weight;
        return this.prisma.strategyAllocation.upsert({
          where: { strategyId: item.id },
          update: { weight, allocatedCapital },
          create: { strategyId: item.id, weight, allocatedCapital },
        });
      }),
    );

    await this.refreshRecommendations(userId);
    return { applied: true, strategyKey, targetWeight: requestedWeight };
  }

  async reviewRecommendation(id: string, action: 'APPROVE' | 'REJECT', userId?: string, reason?: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      try {
        const quantRecommendationModel = this.prisma.quantRecommendation;
        const rec = await quantRecommendationModel.findUnique({ where: { id } });
        if (rec) {
          const updated = await quantRecommendationModel.update({
            where: { id },
            data: {
              status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
              reviewedByUserId: userId ?? null,
              reviewedAt: new Date(),
              rejectionReason: reason ?? null,
            },
          });
          this.logger.log({ event: 'quant_recommendation_reviewed', id, action, userId });
          return updated;
        }
      } catch {
        // Continue to in-memory fallback below
      }
    }

    // In-memory fallback for default items (rec-1, rec-2, etc.)
    const defaults = generateDefaultRecommendations();
    const target = defaults.find((d) => d.id === id) ?? defaults[0];
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    this.logger.log({ event: 'quant_recommendation_reviewed_fallback', id, action, userId });
    return {
      ...target,
      id: id,
      status,
      reviewedByUserId: userId ?? null,
      reviewedAt: new Date(),
      rejectionReason: reason ?? null,
    };
  }

  runSimulation(request: SimulationRequest) {
    return runSimulationExperiment(request);
  }

  getSyntheticSimulationDashboard() {
    return this.syntheticSimulationService.getDashboard();
  }

  runSyntheticSimulationSuite(options?: { limit?: number }) {
    return this.syntheticSimulationService.runFullSuite(options);
  }

  runSyntheticStatisticalValidation(options?: { limit?: number; iterations?: number }) {
    return this.syntheticSimulationService.runStatisticalValidation(options);
  }

  async getReport(type: ReportType = 'DAILY', userId?: string) {
    return this.reportService.generateReport(type, userId);
  }

  async getKnowledgeBase(category?: string) {
    return this.knowledgeService.listArchives(category);
  }
}
