import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma, type QuantRecommendation } from '@prisma/client';
import { generateQuantHypothesis } from '../domain/quant-research.engine';
import { discoverStrategies } from '../domain/strategy-discovery.engine';
import { evaluateFactors } from '../domain/factor-discovery.engine';
import { runAutoBenchmark } from '../domain/auto-benchmark.engine';
import { optimizeThresholds, optimizeWeights } from '../domain/weight-threshold-optimizer.engine';
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

  generateHypothesis(category: any, symbol = 'BTC-USDT') {
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

  getOptimizedWeights(scope: any = 'AGENT') {
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
    const dbRecs = await this.prisma.quantRecommendation.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    if (dbRecs.length === 0) {
      // Seed default recommendations
      const defaults = generateDefaultRecommendations();
      for (const d of defaults) {
        await this.prisma.quantRecommendation.create({
          data: {
            userId: userId ?? null,
            title: d.title,
            moduleSource: d.moduleSource,
            problemStatement: d.problemStatement,
            evidenceText: d.evidenceText,
            historicalResult: d.historicalResult as Prisma.InputJsonValue,
            expectedBenefit: d.expectedBenefit,
            estimatedRisk: d.estimatedRisk,
            priority: d.priority,
            implementationCost: d.implementationCost,
            rollbackPlan: d.rollbackPlan,
            status: 'PENDING_APPROVAL',
          },
        });
      }
      return this.prisma.quantRecommendation.findMany({
        where: userId ? { userId } : undefined,
        orderBy: { createdAt: 'desc' },
      });
    }

    return dbRecs;
  }

  async reviewRecommendation(id: string, action: 'APPROVE' | 'REJECT', userId?: string, reason?: string) {
    const rec = await this.prisma.quantRecommendation.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Recommendation not found');

    const updated = await this.prisma.quantRecommendation.update({
      where: { id },
      data: {
        status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reviewedByUserId: userId ?? null,
        reviewedAt: new Date(),
        rejectionReason: reason ?? null,
      },
    });

    this.logger.log({
      event: 'quant_recommendation_reviewed',
      id,
      action,
      userId,
    });

    return updated;
  }

  runSimulation(request: SimulationRequest) {
    return runSimulationExperiment(request);
  }

  async getReport(type: any = 'DAILY', userId?: string) {
    return this.reportService.generateReport(type, userId);
  }

  async getKnowledgeBase(category?: string) {
    return this.knowledgeService.listArchives(category);
  }
}
