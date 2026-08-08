import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { QuantIntelligenceService } from '../application/quant-intelligence.service';
import type { ExperimentType } from '../domain/simulation-lab.engine';
import type { HypothesisInput } from '../domain/quant-research.engine';
import type { OptimizedWeightsResult } from '../domain/weight-threshold-optimizer.engine';

type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

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
  getPortfolio(@CurrentUser() user: { id: string }) {
    return this.quantService.getPortfolioIntelligence(user.id);
  }

  @Post('portfolio/strategies/:key/apply')
  applyStrategyRecommendation(
    @CurrentUser() user: { id: string },
    @Param('key') key: string,
    @Body() body: { targetWeight?: number },
  ) {
    return this.quantService.applyStrategyRecommendation(user.id, key, body.targetWeight);
  }

  @Get('self-learning')
  getSelfLearning(@CurrentUser() user: { id: string }) {
    return this.quantService.getSelfLearningInsights(user.id);
  }

  @Get('regime')
  getRegime(@Query('symbol') symbol?: string) {
    return this.quantService.getRegimeIntelligence(symbol);
  }

  @Get('recommendations')
  getRecommendations(@CurrentUser() user?: { id: string }) {
    return this.quantService.getRecommendations(user?.id);
  }

  @Post('recommendations/:id/review')
  reviewRecommendation(
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; reason?: string },
  ) {
    return this.quantService.reviewRecommendation(id, body.action, user?.id, body.reason);
  }

  @Post('simulation')
  runSimulation(@Body() body: { name: string; experimentType: ExperimentType; config: Record<string, unknown> }) {
    return this.quantService.runSimulation(body);
  }

  @Get('synthetic-simulation/dashboard')
  getSyntheticSimulationDashboard() {
    return this.quantService.getSyntheticSimulationDashboard();
  }

  @Get('synthetic-simulation/run')
  runSyntheticSimulationSuite(@Query('limit') limit?: string) {
    return this.quantService.runSyntheticSimulationSuite({ limit: limit ? Number(limit) : undefined });
  }

  @Get('synthetic-simulation/statistics')
  runSyntheticStatisticalValidation(@Query('limit') limit?: string, @Query('iterations') iterations?: string) {
    return this.quantService.runSyntheticStatisticalValidation({
      limit: limit ? Number(limit) : undefined,
      iterations: iterations ? Number(iterations) : undefined,
    });
  }

  @Get('reports')
  getReport(@CurrentUser() user: { id: string }, @Query('type') type?: ReportType) {
    return this.quantService.getReport(type ?? 'DAILY', user.id);
  }

  @Get('knowledge')
  getKnowledge(@Query('category') category?: string) {
    return this.quantService.getKnowledgeBase(category);
  }
}
