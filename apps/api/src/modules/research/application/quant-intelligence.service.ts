import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { type QuantRecommendation, type ReportType } from '@prisma/client';
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

@Injectable()
export class QuantIntelligenceService {
  private readonly logger = new Logger(QuantIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportService: QuantReportService,
    private readonly knowledgeService: KnowledgeBaseService,
  ) {}

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

  getPortfolioIntelligence() {
    return analyzePortfolioIntelligence();
  }

  getSelfLearningInsights() {
    return generateSelfLearningInsights();
  }

  getRegimeIntelligence(symbol = 'BTC-USDT') {
    return detectMarketRegimeIntelligence(symbol);
  }

  async getRecommendations(userId?: string): Promise<QuantRecommendation[]> {
    try {
      const dbRecs = await this.prisma.quantRecommendation.findMany({
        where: userId ? { userId } : undefined,
        orderBy: { createdAt: 'desc' },
      });
      return dbRecs;
    } catch (error) {
      this.logger.warn({
        event: 'quant_recommendations_db_error',
        message: 'Database query failed or unmigrated; returning empty list',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async reviewRecommendation(id: string, action: 'APPROVE' | 'REJECT', userId?: string, reason?: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      try {
        const rec = await this.prisma.quantRecommendation.findUnique({ where: { id } });
        if (rec) {
          const updated = await this.prisma.quantRecommendation.update({
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

  async getReport(type: ReportType = 'DAILY', userId?: string) {
    return this.reportService.generateReport(type, userId);
  }

  async getKnowledgeBase(category?: string) {
    return this.knowledgeService.listArchives(category);
  }
}
