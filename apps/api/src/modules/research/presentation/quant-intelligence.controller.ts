import { BadRequestException, Body, Controller, Get, Param, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../../session/session.guard';
import { QuantIntelligenceService } from '../application/quant-intelligence.service';
import type { ExperimentType } from '../domain/simulation-lab.engine';
import type { HypothesisInput } from '../domain/quant-research.engine';
import type { OptimizedWeightsResult } from '../domain/weight-threshold-optimizer.engine';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { PublicExchangeService } from '../../../exchange/application/public-exchange.service';
import { ResearchRateLimitGuard } from './research-rate-limit.guard';

type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

@Controller('quant-intelligence')
@UseGuards(SessionGuard, ResearchRateLimitGuard)
export class QuantIntelligenceController {
  constructor(
    private readonly quantService: QuantIntelligenceService,
    private readonly publicExchange: PublicExchangeService,
  ) {}

  @Get('scorecard')
  getScorecard(@CurrentUser() user?: { id: string }) {
    return this.quantService.getDecisionScorecard(this.requireUserId(user));
  }

  @Get('hypotheses')
  getHypotheses(@CurrentUser() user: { id: string } | undefined, @Query('category') category?: HypothesisInput['category'], @Query('symbol') symbol?: string) {
    return this.quantService.generateSelectedHypotheses(this.requireUserId(user), category, symbol);
  }

  @Get('strategies')
  getStrategies(
    @CurrentUser() user: { id: string } | undefined,
    @Query('symbol') symbol?: string,
    @Query('provider') provider?: ExchangeProvider,
    @Query('interval') interval?: ExchangeInterval,
    @Query('lookbackCandles') lookbackCandles?: string,
  ) {
    return this.quantService.getDiscoveredStrategies(
      this.requireUserId(user),
      symbol,
      provider,
      interval,
      lookbackCandles ? Number(lookbackCandles) : undefined,
    );
  }

  @Get('factors')
  getFactors(@CurrentUser() user?: { id: string }) {
    return this.quantService.getFactorEvaluations(this.requireUserId(user));
  }

  @Get('benchmarks')
  getBenchmarks(@CurrentUser() user: { id: string } | undefined, @Query('strategyName') strategyName?: string, @Query('symbol') symbol?: string) {
    return this.quantService.getAutoBenchmarks(this.requireUserId(user), strategyName, symbol);
  }

  @Get('weights')
  getWeights(@CurrentUser() user: { id: string } | undefined, @Query('scope') scope?: OptimizedWeightsResult['scope']) {
    return this.quantService.getOptimizedWeights(this.requireUserId(user), scope);
  }

  @Get('thresholds')
  getThresholds(@CurrentUser() user?: { id: string }) {
    return this.quantService.getOptimizedThresholds(this.requireUserId(user));
  }

  @Get('portfolio')
  getPortfolio(@CurrentUser() user?: { id: string }) {
    return this.quantService.getPortfolioIntelligence(this.requireUserId(user));
  }

  @Post('portfolio/strategies/:key/apply')
  applyStrategyRecommendation(
    @CurrentUser() user: { id: string } | undefined,
    @Param('key') key: string,
    @Body() body: { targetWeight?: number },
  ) {
    return this.quantService.applyStrategyRecommendation(this.requireUserId(user), key, body.targetWeight);
  }

  @Post('portfolio/strategies/:key/refresh-validations')
  refreshStrategyValidations(
    @CurrentUser() user: { id: string } | undefined,
    @Param('key') key: string,
  ) {
    return this.quantService.refreshStrategyValidations(this.requireUserId(user), key);
  }

  @Get('self-learning')
  getSelfLearning(@CurrentUser() user?: { id: string }) {
    return this.quantService.getSelfLearningInsights(this.requireUserId(user));
  }

  @Get('regime')
  getRegime(@CurrentUser() user: { id: string } | undefined, @Query('symbol') symbol?: string, @Query('provider') provider?: ExchangeProvider, @Query('interval') interval?: ExchangeInterval) {
    return this.quantService.getSelectedRegimeIntelligence(this.requireUserId(user), symbol, provider, interval);
  }

  @Get('recommendations')
  getRecommendations(@CurrentUser() user?: { id: string }) {
    return this.quantService.getRecommendations(this.requireUserId(user));
  }

  @Post('recommendations/refresh')
  async refreshRecommendations(@CurrentUser() user?: { id: string }) {
    const userId = this.requireUserId(user);
    await this.quantService.refreshRecommendations(userId);
    return this.quantService.getRecommendations(userId);
  }

  @Get('scope')
  getResearchScope(@CurrentUser() user?: { id: string }) {
    return this.quantService.getSelectedResearchScope(this.requireUserId(user));
  }

  @Get('opportunities')
  async getSelectedSymbolOpportunities(
    @CurrentUser() user: { id: string } | undefined,
    @Query('provider') provider?: ExchangeProvider,
    @Query('limit') limit?: string,
  ) {
    const scope = await this.quantService.getSelectedResearchSymbols(this.requireUserId(user));
    if (!scope.symbols.length) throw new BadRequestException('NO_SYMBOLS_SELECTED: configure preferred symbols or trigger a pipeline first');
    return this.publicExchange.recommendTopSymbols({
      provider,
      limit: limit ? Number(limit) : 10,
      symbols: scope.symbols,
    });
  }

  @Post('recommendations/:id/review')
  reviewRecommendation(
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; reason?: string },
  ) {
    return this.quantService.reviewRecommendation(id, body.action, this.requireUserId(user), body.reason);
  }

  @Post('simulation')
  runSimulation(@CurrentUser() user: { id: string } | undefined, @Body() body: { name: string; experimentType: ExperimentType; config: Record<string, unknown>; symbol?: string; provider?: ExchangeProvider; interval?: ExchangeInterval; lookbackCandles?: number }) {
    return this.quantService.runSimulation(this.requireUserId(user), body);
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
  getReport(@CurrentUser() user?: { id: string }, @Query('type') type?: ReportType) {
    return this.quantService.getReport(type ?? 'DAILY', this.requireUserId(user));
  }

  @Get('knowledge')
  getKnowledge(@CurrentUser() user?: { id: string }, @Query('category') category?: string) {
    return this.quantService.getKnowledgeBase(this.requireUserId(user), category);
  }

  private requireUserId(user?: { id: string }): string {
    if (!user?.id) throw new UnauthorizedException('Authentication required');
    return user.id;
  }
}
