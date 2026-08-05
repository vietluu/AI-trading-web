import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { QuantIntelligenceService } from '../application/quant-intelligence.service';
import type { ReportType } from '@prisma/client';
import type { ExperimentType } from '../domain/simulation-lab.engine';
import type { HypothesisInput } from '../domain/quant-research.engine';
import type { OptimizedWeightsResult } from '../domain/weight-threshold-optimizer.engine';

@Controller('quant-intelligence')
export class QuantIntelligenceController {
  constructor(private readonly quantService: QuantIntelligenceService) {}

  @Get('scorecard')
  getScorecard() {
    return this.quantService.getDecisionScorecard();
  }

  @Get('hypotheses')
  getHypotheses(@Query('category') category?: HypothesisInput['category'], @Query('symbol') symbol?: string) {
    return this.quantService.generateHypothesis(category, symbol);
  }

  @Get('strategies')
  getStrategies(@Query('symbol') symbol?: string) {
    return this.quantService.getDiscoveredStrategies(symbol);
  }

  @Get('factors')
  getFactors() {
    return this.quantService.getFactorEvaluations();
  }

  @Get('benchmarks')
  getBenchmarks(@Query('strategyName') strategyName?: string) {
    return this.quantService.getAutoBenchmarks(strategyName);
  }

  @Get('weights')
  getWeights(@Query('scope') scope?: OptimizedWeightsResult['scope']) {
    return this.quantService.getOptimizedWeights(scope);
  }

  @Get('thresholds')
  getThresholds() {
    return this.quantService.getOptimizedThresholds();
  }

  @Get('portfolio')
  getPortfolio() {
    return this.quantService.getPortfolioIntelligence();
  }

  @Get('self-learning')
  getSelfLearning() {
    return this.quantService.getSelfLearningInsights();
  }

  @Get('regime')
  getRegime(@Query('symbol') symbol?: string) {
    return this.quantService.getRegimeIntelligence(symbol);
  }

  @Get('recommendations')
  getRecommendations() {
    return this.quantService.getRecommendations();
  }

  @Post('recommendations/:id/review')
  reviewRecommendation(
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; reason?: string },
  ) {
    return this.quantService.reviewRecommendation(id, body.action, undefined, body.reason);
  }

  @Post('simulation')
  runSimulation(@Body() body: { name: string; experimentType: ExperimentType; config: Record<string, unknown> }) {
    return this.quantService.runSimulation(body);
  }

  @Get('reports')
  getReport(@Query('type') type?: ReportType) {
    return this.quantService.getReport(type ?? 'DAILY');
  }

  @Get('knowledge')
  getKnowledge(@Query('category') category?: string) {
    return this.quantService.getKnowledgeBase(category);
  }
}
