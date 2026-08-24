import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { MarketDataService } from '../../../market-data/application/market-data.service';
import { aggregateClosedTradeCycles } from '../../live-trading/domain/closed-trade-cycle';
import { timeframeMilliseconds } from '../../pipeline/domain/adaptive-trading-policy';

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
  status: 'VALIDATION_REQUIRED' | 'PENDING_APPROVAL' | 'APPROVED' | 'SHADOW' | 'CANARY' | 'REJECTED' | 'DEPLOYED' | 'ROLLED_BACK';
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

export function calculateLedgerPortfolioMetrics(
  trades: Array<{
    id?: string;
    connectionId?: string;
    strategyId?: string | null;
    symbol?: string;
    side?: string;
    positionSide?: string | null;
    quantity?: unknown;
    entryPrice?: unknown;
    grossPnl?: unknown;
    fee?: unknown;
    netPnl: Prisma.Decimal | number;
    returnPct: number | null;
    sourceDataComplete?: boolean;
    openedAt?: Date | null;
    closedAt?: Date;
  }>,
) {
  const cycles = aggregateClosedTradeCycles(trades);
  const netPnls = cycles.map((trade) => trade.netPnl);
  const returns = cycles
    .flatMap((trade) => trade.returnPct === null ? [] : [Number(trade.returnPct)])
    .filter(Number.isFinite);
  const grossProfit = netPnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(netPnls.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const meanReturn = returns.length
    ? returns.reduce((sum, value) => sum + value, 0) / returns.length
    : null;
  const variance = meanReturn !== null && returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / (returns.length - 1)
    : null;
  const deviation = variance === null ? null : Math.sqrt(variance);

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + Math.max(-0.999999, value);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
  }

  return {
    sharpeRatio: meanReturn !== null && deviation !== null && deviation > 0
      ? Number((meanReturn / deviation * Math.sqrt(returns.length)).toFixed(4))
      : null,
    profitFactor: grossLoss > 0
      ? Number((grossProfit / grossLoss).toFixed(4))
      : grossProfit > 0 ? null : 0,
    expectedValuePct: meanReturn === null ? null : Number((meanReturn * 100).toFixed(4)),
    maxDrawdownPct: returns.length ? Number((maxDrawdown * 100).toFixed(4)) : null,
  };
}

export function resolveStrategyAllocationTarget(input: {
  requestedWeight: number;
  currentWeight: number;
  verifiedAttributedTrades: number;
  maxStrategyExposure?: number;
  canaryDelta?: number;
}) {
  const minimumWeight = 0.05;
  const maximumWeight = Math.max(
    minimumWeight,
    Math.min(0.95, input.maxStrategyExposure ?? 0.25),
  );
  const requestedWeight = Math.max(
    minimumWeight,
    Math.min(maximumWeight, input.requestedWeight),
  );
  if (input.verifiedAttributedTrades >= 5) {
    return { mode: 'FULL' as const, targetWeight: requestedWeight, requestedWeight };
  }
  const currentWeight = Math.max(
    minimumWeight,
    Math.min(maximumWeight, input.currentWeight),
  );
  const canaryDelta = Math.max(0.005, Math.min(0.05, input.canaryDelta ?? 0.02));
  return {
    mode: 'CANARY' as const,
    targetWeight: Number(Math.max(
      minimumWeight,
      Math.min(
        maximumWeight,
        Math.max(currentWeight - canaryDelta, Math.min(requestedWeight, currentWeight + canaryDelta)),
      ),
    ).toFixed(6)),
    requestedWeight,
  };
}

export function portfolioRecommendationStatus(input: {
  validationPassed: boolean;
  verifiedAttributedTrades: number;
  isAlreadyApplied: boolean;
}): QuantRecommendation['status'] {
  if (!input.validationPassed) return 'VALIDATION_REQUIRED';
  if (!input.isAlreadyApplied) return 'PENDING_APPROVAL';
  return input.verifiedAttributedTrades < 5 ? 'CANARY' : 'DEPLOYED';
}

type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
import { buildQuantRecommendation } from '../domain/explainability-governance.engine';
import type { HypothesisInput } from '../domain/quant-research.engine';
import type { OptimizedWeightsResult } from '../domain/weight-threshold-optimizer.engine';
import { analyzePortfolioIntelligence } from '../domain/portfolio-intelligence.engine';
import type { SimulationRequest } from '../domain/simulation-lab.engine';
import { QuantReportService } from './quant-report.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { runBenchmarkSuite, detectMarketRegime } from '../domain/benchmark-engine';
import { runHistoricalBacktest } from '../domain/backtest-engine';
import { BASE_WEIGHTS } from '../../agents/domain/constants/decision.constants';
import { ResearchService, validationBacktestStrategy } from './research.service';
import { DistributedTaskLockService } from '../../../redis/distributed-task-lock.service';

@Injectable()
export class QuantIntelligenceService {
  private readonly logger = new Logger(QuantIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly reportService: QuantReportService,
    private readonly knowledgeService: KnowledgeBaseService,
    @Optional() private readonly research?: ResearchService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}

  async getDecisionScorecard(userId: string) {
    const [closedTrades, pipelineTotal, pipelineCompleted, pipelineFailed, riskTotal, riskApproved, liveOrders, validationEvidence] = await Promise.all([
      this.prisma.closedTrade.findMany({ where: { userId }, orderBy: { closedAt: 'asc' } }),
      this.prisma.pipelineRun.count({ where: { userId } }),
      this.prisma.pipelineRun.count({ where: { userId, status: 'COMPLETED' } }),
      this.prisma.pipelineRun.count({ where: { userId, status: 'FAILED' } }),
      this.prisma.riskAssessment.count({ where: { userId } }),
      this.prisma.riskAssessment.count({ where: { userId, approved: true } }),
      this.prisma.liveOrder.count({ where: { userId } }),
      this.multiSymbolValidationEvidence(userId, []),
    ]);
    const tradeCycles = aggregateClosedTradeCycles(closedTrades);
    const ledger = calculateLedgerPortfolioMetrics(closedTrades);
    const clampPct = (value: number) => Math.max(0, Math.min(100, value));
    const researchValidationScore = validationEvidence.requiredPairs
      ? validationEvidence.coveragePct * 0.4
        + validationEvidence.passRatePct * 0.4
        + clampPct((validationEvidence.averageOutOfSampleSharpe ?? 0) * 50) * 0.2
      : 0;
    const dimensions = {
      dataEvidence: Math.min(100, tradeCycles.length / 30 * 100),
      pipelineReliability: pipelineTotal ? pipelineCompleted / pipelineTotal * 100 : 0,
      executionEvidence: riskApproved ? Math.min(100, liveOrders / riskApproved * 100) : 0,
      riskCoverage: liveOrders ? Math.min(100, riskTotal / liveOrders * 100) : 0,
      researchValidation: Number(researchValidationScore.toFixed(2)),
    };
    const overallScore = Number((Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.keys(dimensions).length).toFixed(1));
    const netPnl = tradeCycles.reduce((sum, trade) => sum + trade.netPnl, 0);
    const calmar = ledger.maxDrawdownPct && ledger.maxDrawdownPct > 0
      ? Number(((ledger.expectedValuePct ?? 0) / ledger.maxDrawdownPct).toFixed(4))
      : null;
    return {
      overallScore,
      grade: overallScore >= 90 ? 'A' : overallScore >= 75 ? 'B' : overallScore >= 60 ? 'C' : 'INSUFFICIENT_EVIDENCE',
      dimensions,
      expectedValue: ledger.expectedValuePct,
      profitFactor: ledger.profitFactor,
      sharpeRatio: ledger.sharpeRatio,
      calmarRatio: calmar,
      maxDrawdownPct: ledger.maxDrawdownPct,
      walkForwardStability: validationEvidence.requiredPairs ? validationEvidence.passRatePct : null,
      monteCarloSurvivalRate: null,
      evidence: {
        source: 'EXCHANGE_LEDGER_PIPELINE_RUNTIME_AND_RESEARCH_DB',
        closedTrades: tradeCycles.length,
        closingOrders: closedTrades.length,
        netPnl: Number(netPnl.toFixed(8)),
        pipelineTotal,
        pipelineCompleted,
        pipelineFailed,
        riskAssessments: riskTotal,
        riskApproved,
        liveOrders,
        validationRunIds: validationEvidence.validationRunIds,
        validationScope: { symbols: validationEvidence.symbols, timeframes: validationEvidence.timeframes },
        validationCoveragePct: validationEvidence.coveragePct,
        validationPassRatePct: validationEvidence.passRatePct,
        validationPassed: validationEvidence.passed,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }

  async getSelectedResearchSymbols(userId: string): Promise<{ symbols: string[]; settings: string[]; pipelineTriggers: string[] }> {
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const [setting, schedules, triggeredRuns] = await Promise.all([
      this.prisma.userSetting.findUnique({ where: { userId }, select: { preferredSymbols: true } }),
      this.prisma.pipelineSchedule.findMany({
        where: { userId, enabled: true },
        select: { symbols: true },
      }),
      this.prisma.pipelineRun.findMany({
        where: { userId, createdAt: { gte: recentCutoff } },
        select: { symbol: true },
        distinct: ['symbol'],
        orderBy: { symbol: 'asc' },
        take: 100,
      }),
    ]);
    const normalize = (value: string) => value.trim().toUpperCase().replace(/[/_]/g, '-');
    const valid = (value: string) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(value);
    const settings = [...new Set((setting?.preferredSymbols ?? []).map(normalize).filter(valid))];
    const pipelineTriggers = [...new Set([
      ...schedules.flatMap((schedule) => schedule.symbols),
      ...triggeredRuns.map((item) => item.symbol),
    ].map(normalize).filter(valid))];
    const userSymbols = [...new Set([...settings, ...pipelineTriggers])];
    return {
      settings,
      pipelineTriggers,
      symbols: userSymbols,
    };
  }

  async getSelectedResearchScope(userId: string) {
    const selected = await this.getSelectedResearchSymbols(userId);
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const [setting, runs] = await Promise.all([
      this.prisma.userSetting.findUnique({ where: { userId }, select: { preferredTimeframes: true } }),
      this.prisma.pipelineRun.findMany({
        where: { userId, createdAt: { gte: recentCutoff } },
        select: { symbol: true, provider: true, timeframe: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);
    const supported = new Set<string>(Object.values(ExchangeInterval));
    const settingsTimeframes = [...new Set((setting?.preferredTimeframes ?? []).filter((value) => supported.has(value)))];
    const pipelineTimeframes = [...new Set(runs.flatMap((run) => run.timeframe && supported.has(run.timeframe) ? [run.timeframe] : []))];
    return {
      ...selected,
      timeframes: [...new Set([...settingsTimeframes, ...pipelineTimeframes])] as ExchangeInterval[],
      settingsTimeframes,
      pipelineTimeframes,
      recentRuns: runs,
    };
  }

  private async resolveResearchTarget(
    userId: string,
    requestedSymbol?: string,
    requestedProvider?: ExchangeProvider,
    requestedInterval?: ExchangeInterval,
  ) {
    const scope = await this.getSelectedResearchScope(userId);
    const normalized = requestedSymbol?.trim().toUpperCase().replace(/[/_]/g, '-');
    if (normalized && !scope.symbols.includes(normalized)) {
      throw new BadRequestException(`SYMBOL_NOT_SELECTED: ${normalized} is outside the configured or recently triggered investment universe`);
    }
    const symbol = normalized && /^[A-Z0-9]+-[A-Z0-9]+$/.test(normalized) ? normalized : scope.symbols[0];
    if (!symbol) throw new BadRequestException('NO_SYMBOLS_SELECTED: select a symbol in Settings or trigger a symbol pipeline first');
    const interval = requestedInterval ?? scope.timeframes[0];
    if (!interval) throw new BadRequestException('NO_TIMEFRAMES_SELECTED: select a timeframe in Settings or run a pipeline with a timeframe first');
    const runProvider = scope.recentRuns.find((run) => run.symbol === symbol)?.provider;
    const connection = await this.prisma.exchangeConnection.findFirst({
      where: { userId, isEnabled: true, isVerified: true, ...((requestedProvider ?? runProvider) ? { provider: requestedProvider ?? runProvider! } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    if (!connection && !requestedProvider) throw new BadRequestException('NO_VERIFIED_EXCHANGE_CONNECTION: no provider is available for the selected symbol');
    const provider = requestedProvider ?? (connection?.provider === 'BINANCE_FUTURES' ? ExchangeProvider.BINANCE_FUTURES : ExchangeProvider.OKX_FUTURES);
    return { symbol, provider, interval, scope };
  }

  async generateSelectedHypotheses(userId: string, category?: HypothesisInput['category'], requestedSymbol?: string) {
    const selected = await this.getSelectedResearchSymbols(userId);
    const requested = requestedSymbol?.trim().toUpperCase().replace(/[/_]/g, '-');
    if (requested && !selected.symbols.includes(requested)) {
      throw new BadRequestException(`SYMBOL_NOT_SELECTED: ${requested} is outside the configured or recently triggered investment universe`);
    }
    const symbols = requested && /^[A-Z0-9]+-[A-Z0-9]+$/.test(requested) ? [requested] : selected.symbols;
    if (!symbols.length) {
      return { status: 'NO_SYMBOLS_SELECTED', symbols: [], sources: selected, hypotheses: [] };
    }
    const hypotheses = await Promise.all(symbols.map((symbol) => this.generateHypothesis(userId, category, symbol)));
    return { status: 'COMPLETED', symbols, sources: selected, hypotheses };
  }

  async generateHypothesis(userId: string, category: HypothesisInput['category'] | undefined, symbol: string) {
    const records = await this.prisma.performanceRecord.findMany({
      where: { userId, symbol, decision: { in: ['LONG', 'SHORT'] } },
      orderBy: { evaluatedAt: 'desc' },
      take: 2000,
    });
    if (records.length < 10) {
      return { status: 'DATA_UNAVAILABLE', symbol, category: category ?? 'FACTOR_COMBINATION', reason: 'At least 10 evaluated directional pipeline records are required.', statisticalProof: { sampleSize: records.length, source: 'performance_records' } };
    }
    const hypothesisCategory = category ?? 'FACTOR_COMBINATION';
    const latest = await this.prisma.quantHypothesis.findFirst({
      where: { userId, symbol, category: hypothesisCategory },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.createdAt >= records[0]!.evaluatedAt) return latest;
    const returns = records.map((record) => record.returnPct);
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
    const standardError = Math.sqrt(variance) / Math.sqrt(returns.length);
    const tStatistic = standardError > 0 ? mean / standardError : 0;
    const pValue = Number((2 * (1 - normalCdf(Math.abs(tStatistic)))).toFixed(6));
    const grossProfit = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
    const deviation = Math.sqrt(variance);
    const result = {
      symbol,
      title: `Evidence-backed ${hypothesisCategory.toLowerCase().replace(/_/g, ' ')} hypothesis for ${symbol}`,
      category: hypothesisCategory,
      description: `Measured from ${records.length} evaluated pipeline outcomes for ${symbol}.`,
      hypothesisText: mean > 0 ? 'The evaluated directional policy has positive historical expectancy.' : 'The evaluated directional policy does not currently demonstrate positive expectancy.',
      expectedValue: Number(mean.toFixed(6)),
      profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(4)) : null,
      sharpeRatio: deviation > 0 ? Number((mean / deviation * Math.sqrt(records.length)).toFixed(4)) : null,
      statisticalProof: {
        pValue,
        sampleSize: records.length,
        tStatistic: Number(tStatistic.toFixed(4)),
        confidenceInterval: [Number((mean - 1.96 * standardError).toFixed(6)), Number((mean + 1.96 * standardError).toFixed(6))] as [number, number],
        source: 'performance_records',
        recordIds: records.slice(0, 100).map((record) => record.id),
      },
      status: pValue <= 0.05 && mean > 0 ? 'TESTED' : 'RESEARCHING',
    };
    await this.prisma.quantHypothesis.create({ data: { userId, ...result, profitFactor: result.profitFactor ?? 0, sharpeRatio: result.sharpeRatio ?? 0, statisticalProof: result.statisticalProof, provenance: { source: 'performance_records', symbol, recordIds: records.slice(0, 100).map((record) => record.id) } } });
    return result;
  }

  async getDiscoveredStrategies(userId: string, requestedSymbol?: string, requestedProvider?: ExchangeProvider, requestedInterval?: ExchangeInterval, lookbackCandles = 500) {
    const { symbol, provider, interval } = await this.resolveResearchTarget(userId, requestedSymbol, requestedProvider, requestedInterval);
    const candles = await this.marketData.getHistoricalCandles({ provider, symbol, interval, limit: Math.max(100, Math.min(1000, lookbackCandles)) });
    if (candles.length < 100) throw new BadRequestException(`DATA_UNAVAILABLE: only ${candles.length} real candles are available`);
    const suite = runBenchmarkSuite({ candles, provider, symbol, interval, initialBalance: 10_000, leverage: 2, riskPerTrade: 0.01, riskRewardRatio: 2 });
    const ranked = [...suite.benchmarks].sort((left, right) => right.metrics.rankingScore - left.metrics.rankingScore);
    const strategies = ranked.map((item, index) => ({
      key: `${item.strategyName.toLowerCase().replace(/_/g, '-')}-${symbol.toLowerCase()}-${provider.toLowerCase()}-${interval}`,
      name: `${item.strategyName.replace(/_/g, ' ')} (${symbol} · ${provider} · ${interval})`,
      kind: item.strategyName,
      score: Number(Math.max(0, 100 - index * (100 / Math.max(1, ranked.length - 1))).toFixed(2)),
      expectedValue: item.metrics.expectancy,
      profitFactor: item.metrics.profitFactor,
      sharpeRatio: item.metrics.sharpeRatio,
      calmarRatio: item.metrics.calmarRatio,
      maxDrawdown: item.metrics.maximumDrawdown * 100,
      trades: item.trades,
      rules: strategyRules(item.strategyName),
      parameters: { provider, symbol, interval, lookbackCandles: candles.length, feeRate: 0.0005, slippageRate: 0.0002, leverage: 2, riskPerTrade: 0.01 },
      provenance: { source: 'REAL_EXCHANGE_CANDLES', firstCandleAt: candles[0]?.openTime.toISOString(), lastCandleAt: candles.at(-1)?.closeTime.toISOString() },
      status: item.trades >= 5 ? 'DISCOVERED' : 'INSUFFICIENT_TRADES',
    }));
    await this.prisma.discoveredStrategy.deleteMany({ where: { userId, key: { in: strategies.map((item) => item.key) } } });
    await this.prisma.discoveredStrategy.createMany({ data: strategies.map((item) => ({ userId, key: item.key, name: item.name, kind: item.kind, score: item.score, expectedValue: item.expectedValue, profitFactor: item.profitFactor, sharpeRatio: item.sharpeRatio, calmarRatio: item.calmarRatio, maxDrawdown: item.maxDrawdown, rulesJson: item.rules, parametersJson: item.parameters, provenance: item.provenance, status: item.status })) });
    return strategies;
  }

  async getFactorEvaluations(userId: string) {
    const records = await this.prisma.performanceRecord.findMany({ where: { userId, decision: { in: ['LONG', 'SHORT'] } }, include: { run: { select: { storedContext: true } } }, orderBy: { evaluatedAt: 'desc' }, take: 3000 });
    const names = ['market', 'technical', 'news', 'sentiment', 'macro', 'onchain'] as const;
    const categories = { market: 'STRUCTURE', technical: 'TECHNICAL', news: 'NEWS', sentiment: 'SENTIMENT', macro: 'MACRO', onchain: 'ONCHAIN' } as const;
    const factors = names.map((name) => {
      const observations = records.flatMap((record) => {
        const context = jsonObject(record.run.storedContext);
        const analyses = jsonObject(context.analyses);
        const bias = analysisBias(name, jsonObject(analyses[name]));
        if (!bias) return [];
        const actual = record.outcome === 'NEUTRAL' ? 'NEUTRAL' : record.outcome === 'CORRECT' ? record.decision : record.decision === 'LONG' ? 'SHORT' : 'LONG';
        return [{ bias, actual }];
      });
      const correct = observations.filter((item) => item.bias === item.actual).length;
      const power = observations.length ? correct / observations.length * 100 : 0;
      return {
        factorName: `${name.toUpperCase()} analyst directional evidence`,
        category: categories[name],
        predictivePower: Number(power.toFixed(2)),
        contribution: records.length ? Number((observations.length / records.length * 100).toFixed(2)) : 0,
        noiseScore: Number((100 - power).toFixed(2)),
        redundancyScore: 0,
        sampleSize: observations.length,
        source: 'pipeline_runs.storedContext + performance_records',
      };
    });
    await this.prisma.factorEvaluation.deleteMany({ where: { userId } });
    if (factors.length) await this.prisma.factorEvaluation.createMany({ data: factors.map((item) => ({ userId, factorName: item.factorName, category: item.category, predictivePower: item.predictivePower, contribution: item.contribution, noiseScore: item.noiseScore, redundancyScore: item.redundancyScore, sampleSize: item.sampleSize, provenance: { source: item.source } })) });
    return factors;
  }

  async getAutoBenchmarks(userId: string, strategyName = 'HYBRID_QUANT', requestedSymbol?: string) {
    const { symbol, provider, interval } = await this.resolveResearchTarget(userId, requestedSymbol);
    const strategies = await this.getDiscoveredStrategies(userId, symbol, provider, interval);
    const selected = strategies.find((item) => item.kind === strategyName || item.name === strategyName) ?? strategies[0];
    if (!selected) throw new BadRequestException('DATA_UNAVAILABLE: no evidence-backed strategy was discovered');
    const comparisons = strategies.filter((item) => item.key !== selected.key).map((item, index) => ({
      strategyName: selected.name,
      benchmarkTarget: item.kind,
      rank: index + 1,
      aiExpectedValue: selected.expectedValue,
      benchmarkExpectedValue: item.expectedValue,
      aiSharpe: selected.sharpeRatio,
      benchmarkSharpe: item.sharpeRatio,
      aiMaxDrawdown: selected.maxDrawdown,
      benchmarkMaxDrawdown: item.maxDrawdown,
      outperformancePct: item.expectedValue !== 0 ? Number(((selected.expectedValue - item.expectedValue) / Math.abs(item.expectedValue) * 100).toFixed(2)) : null,
      source: 'REAL_EXCHANGE_CANDLE_BACKTEST',
    }));
    await this.prisma.autoBenchmarkRecord.deleteMany({ where: { userId, strategyName: selected.name } });
    if (comparisons.length) await this.prisma.autoBenchmarkRecord.createMany({ data: comparisons.map((item) => ({ userId, strategyName: selected.name, benchmarkTarget: item.benchmarkTarget, rank: item.rank, metricsJson: item, provenance: { source: item.source, symbol } })) });
    return comparisons;
  }

  async getOptimizedWeights(userId: string, scope: OptimizedWeightsResult['scope'] = 'AGENT') {
    if (scope !== 'AGENT') throw new BadRequestException(`DATA_UNAVAILABLE: ${scope} optimization has no verified evidence source`);
    const factors = await this.getFactorEvaluations(userId);
    const usable = factors.filter((item) => item.sampleSize >= 10);
    if (!usable.length) throw new BadRequestException('DATA_UNAVAILABLE: at least 10 observations per agent are required');
    const agentNames = Object.keys(BASE_WEIGHTS) as Array<keyof typeof BASE_WEIGHTS>;
    const configuration = await this.prisma.selfLearningConfiguration.findUnique({ where: { userId } });
    const configured = jsonObject(configuration?.weightsJson);
    const currentWeights = Object.fromEntries(agentNames.map((name) => {
      const value = Number(configured[name]);
      return [name, Number.isFinite(value) && value >= 0 ? value : BASE_WEIGHTS[name]];
    })) as Record<keyof typeof BASE_WEIGHTS, number>;
    const evidenceByAgent = new Map(factors.map((item) => [item.factorName.split(' ')[0]!.toLowerCase(), item]));
    const insufficientAgents = agentNames.filter((name) => (evidenceByAgent.get(name)?.sampleSize ?? 0) < 10);
    const reservedWeight = insufficientAgents.reduce((sum, name) => sum + currentWeights[name], 0);
    const optimizableWeight = Math.max(0, 100 - reservedWeight);
    const raw = Object.fromEntries(usable.map((item) => [item.factorName.split(' ')[0]!.toLowerCase(), Math.max(0.001, item.predictivePower * item.contribution / Math.max(1, item.noiseScore))]));
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
    const weights = Object.fromEntries(agentNames.map((name) => {
      if (insufficientAgents.includes(name)) return [name, Number(currentWeights[name].toFixed(2))];
      return [name, Number(((raw[name] ?? 0) / total * optimizableWeight).toFixed(2))];
    }));
    const records = await this.prisma.performanceRecord.findMany({ where: { userId, decision: { in: ['LONG', 'SHORT'] } }, take: 3000 });
    const returns = records.map((record) => record.returnPct);
    const metrics = returnMetrics(returns);
    const result = { scope, weights, expectedValue: metrics.mean, sharpeRatio: metrics.sharpe, profitFactor: metrics.profitFactor, sampleSize: records.length, insufficientAgents, source: 'performance_records + pipeline agent outputs' };
    await this.prisma.weightOptimizationRecord.create({ data: { userId, scope, optimizedWeights: weights, expectedValue: metrics.mean, sharpeRatio: metrics.sharpe, sampleSize: records.length, evidenceJson: { source: result.source, factors, insufficientAgents, policy: 'Agents with fewer than 10 observations retain their governed live weight' } } });
    const validation = await this.multiSymbolValidationEvidence(userId, []);
    await this.prisma.quantRecommendation.deleteMany({ where: { userId, moduleSource: 'WEIGHT_OPTIMIZER', status: 'PENDING_APPROVAL' } });
    await this.prisma.quantRecommendation.create({ data: {
      userId,
      title: 'Promote evidence-backed agent weights to shadow evaluation',
      moduleSource: 'WEIGHT_OPTIMIZER',
      problemStatement: 'Agent weights should reflect measured directional contribution rather than static defaults.',
      evidenceText: `${records.length} evaluated pipeline decisions; multi-symbol validation coverage ${validation.coveragePct}%.`,
      historicalResult: { ...result, symbols: validation.symbols, validationEvidence: validation },
      expectedBenefit: 'Shadow-test higher-evidence agent weighting without changing live decisions.',
      estimatedRisk: 'Weights may overfit recent market regimes.',
      priority: 'MEDIUM',
      implementationCost: 'LOW',
      rollbackPlan: 'Disable shadow mode; live weights remain unchanged until governed promotion.',
      status: validation.passed ? 'PENDING_APPROVAL' : 'VALIDATION_REQUIRED',
    } });
    return result;
  }

  async getOptimizedThresholds(userId: string) {
    const records = await this.prisma.performanceRecord.findMany({ where: { userId, decision: { in: ['LONG', 'SHORT'] } }, orderBy: { evaluatedAt: 'desc' }, take: 3000 });
    const candidates = [50, 55, 60, 65, 70, 75, 80, 85].map((threshold) => {
      const sample = records.filter((record) => record.confidence >= threshold);
      const mean = sample.length ? sample.reduce((sum, record) => sum + record.returnPct, 0) / sample.length : Number.NEGATIVE_INFINITY;
      const accuracy = sample.length ? sample.filter((record) => record.outcome === 'CORRECT').length / sample.length : 0;
      return { threshold, sampleSize: sample.length, mean, accuracy };
    }).filter((item) => item.sampleSize >= 20);
    if (!candidates.length) throw new BadRequestException('DATA_UNAVAILABLE: at least 20 evaluated directional decisions are required');
    const best = [...candidates].sort((left, right) => right.mean - left.mean || right.accuracy - left.accuracy)[0]!;
    const config = await this.prisma.selfLearningConfiguration.findUnique({ where: { userId } });
    const previousValue = config?.confidenceThreshold ?? 60;
    const baseline = candidates.find((item) => item.threshold === Math.round(previousValue / 5) * 5);
    const expectedImprovement = baseline && Number.isFinite(baseline.mean) ? best.mean - baseline.mean : 0;
    const result = [{ thresholdName: 'CONFIDENCE' as const, previousValue, optimizedValue: best.threshold, expectedImprovement: Number(expectedImprovement.toFixed(6)), sampleSize: best.sampleSize, observedAccuracy: Number((best.accuracy * 100).toFixed(2)), source: 'performance_records' }];
    await this.prisma.thresholdOptimizationRecord.create({ data: { userId, thresholdName: 'CONFIDENCE', previousValue, optimizedValue: best.threshold, expectedImprovement, sampleSize: best.sampleSize, evidenceJson: { source: 'performance_records', candidates } } });
    const validation = await this.multiSymbolValidationEvidence(userId, []);
    await this.prisma.quantRecommendation.deleteMany({ where: { userId, moduleSource: 'THRESHOLD_OPTIMIZER', status: 'PENDING_APPROVAL' } });
    await this.prisma.quantRecommendation.create({ data: {
      userId,
      title: `Shadow-test confidence threshold ${best.threshold}`,
      moduleSource: 'THRESHOLD_OPTIMIZER',
      problemStatement: 'The current threshold is not the highest-expectancy candidate in verified pipeline evaluations.',
      evidenceText: `${best.sampleSize} decisions above threshold; observed accuracy ${(best.accuracy * 100).toFixed(2)}%.`,
      historicalResult: { ...result[0], symbols: validation.symbols, validationEvidence: validation },
      expectedBenefit: 'Evaluate the measured threshold in shadow mode before live promotion.',
      estimatedRisk: 'The optimum can drift as the market regime changes.',
      priority: 'MEDIUM',
      implementationCost: 'LOW',
      rollbackPlan: 'Disable shadow mode; the live confidence threshold is unchanged.',
      status: validation.passed ? 'PENDING_APPROVAL' : 'VALIDATION_REQUIRED',
    } });
    return result;
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

    const [strategies, allClosedTrades] = await Promise.all([
      this.prisma.portfolioStrategy.findMany({
        where: { userId },
        include: { allocation: true, performance: true, livePositions: true, closedTrades: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.closedTrade.findMany({ where: { userId }, orderBy: { closedAt: 'asc' } }),
    ]);

    const selectedScope = await this.getSelectedResearchScope(userId);
    const regimeRows = selectedScope.symbols.length ? await this.prisma.marketRegimeState.findMany({
      where: { symbol: { in: selectedScope.symbols }, interval: { in: selectedScope.timeframes } },
      orderBy: { detectedAt: 'desc' },
    }) : [];
    const latestRegimes = new Map<string, string>();
    for (const row of regimeRows) {
      const key = `${row.symbol}:${row.provider ?? 'UNKNOWN'}:${row.interval ?? 'UNKNOWN'}`;
      if (!latestRegimes.has(key)) latestRegimes.set(key, row.regime);
    }
    const regimes = [...latestRegimes.values()];
    const marketRegime = regimes.some((regime) => ['HIGH_VOLATILITY', 'PANIC', 'EUPHORIA'].includes(regime))
      ? 'HIGH_VOLATILITY'
      : regimes.filter((regime) => ['BULL', 'BEAR', 'TRENDING'].includes(regime)).length > regimes.length / 2
        ? 'TRENDING'
        : 'SIDEWAYS';

    const configuredStrategyCap = Number(process.env.MAX_STRATEGY_EXPOSURE ?? 0.25);
    const maxStrategyAllocation = Number.isFinite(configuredStrategyCap)
      ? Math.max(0.05, Math.min(1, configuredStrategyCap))
      : 0.25;
    const analysis = analyzePortfolioIntelligence(
      strategies.map((strategy) => {
        const livePositions = strategy.livePositions ?? [];
        const tradeCycles = aggregateClosedTradeCycles(strategy.closedTrades);
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
          returns: tradeCycles
            .filter((trade) => trade.returnPct !== null)
            .map((trade) => ({ at: trade.closedAt!.toISOString(), returnPct: trade.returnPct! })),
          marketRegime,
        };
      }),
      maxStrategyAllocation,
    );
    const allocationValidation = await Promise.all(
      strategies.map(async (strategy) => {
        const validation = await this.multiSymbolValidationEvidence(
          userId,
          strategy.symbols,
          strategy.key,
        );
        const verifiedAttributedTrades = aggregateClosedTradeCycles(strategy.closedTrades).filter(
          (trade) => trade.sourceDataComplete,
        ).length;
        return {
          strategyKey: strategy.key,
          validationStatus: !validation.passed
            ? 'VALIDATION_REQUIRED' as const
            : verifiedAttributedTrades < 5
              ? 'CANARY' as const
              : 'FULL' as const,
          canApply: validation.passed,
          verifiedAttributedTrades,
          tradesRequiredForFullAllocation: Math.max(0, 5 - verifiedAttributedTrades),
          validation: {
            coveragePct: validation.coveragePct,
            passRatePct: validation.passRatePct,
            passingPairs: validation.passingPairs,
            requiredPairs: validation.requiredPairs,
            pairs: validation.pairs,
          },
        };
      }),
    );
    const validationByStrategy = new Map(
      allocationValidation.map((item) => [item.strategyKey, item]),
    );
    const allTradeCycles = aggregateClosedTradeCycles(allClosedTrades);
    const ledgerMetrics = calculateLedgerPortfolioMetrics(allClosedTrades);
    return {
      ...analysis,
      allocations: analysis.allocations.map((allocation) => {
        const lifecycle = validationByStrategy.get(allocation.strategyKey);
        return {
          ...allocation,
          ...lifecycle,
          canApply: Boolean(lifecycle?.canApply) &&
            Math.abs(
              allocation.recommendedCapitalAllocationPct -
              allocation.currentCapitalAllocationPct,
            ) >= 0.01,
        };
      }),
      overallSharpeRatio: ledgerMetrics.sharpeRatio,
      overallProfitFactor: ledgerMetrics.profitFactor,
      expectedValue: ledgerMetrics.expectedValuePct,
      maxPortfolioDrawdownPct: ledgerMetrics.maxDrawdownPct,
      actualTrading: {
        source: 'EXCHANGE_CLOSED_TRADE_LEDGER',
        totalTrades: allTradeCycles.length,
        closingOrders: allClosedTrades.length,
        completeTrades: allTradeCycles.filter((trade) => trade.sourceDataComplete).length,
        assignedTrades: allTradeCycles.filter((trade) => trade.strategyId).length,
        unassignedTrades: allTradeCycles.filter((trade) => !trade.strategyId).length,
        netPnl: Number(allTradeCycles.reduce((sum, trade) => sum + trade.netPnl, 0).toFixed(8)),
        winRate: allTradeCycles.length
          ? Number((allTradeCycles.filter((trade) => trade.netPnl > 0).length / allTradeCycles.length * 100).toFixed(2))
          : 0,
        profitFactor: ledgerMetrics.profitFactor,
        sharpeRatio: ledgerMetrics.sharpeRatio,
        expectedValuePct: ledgerMetrics.expectedValuePct,
        maxDrawdownPct: ledgerMetrics.maxDrawdownPct,
      },
    };
  }

  async getSelfLearningInsights(userId: string) {
    return this.prisma.selfLearningInsight.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getRegimeIntelligence(symbol: string, provider: ExchangeProvider, interval: ExchangeInterval) {
    const candles = await this.marketData.getHistoricalCandles({ provider, symbol, interval, limit: 200 });
    if (candles.length < 50) throw new BadRequestException(`DATA_UNAVAILABLE: only ${candles.length} real candles are available for regime detection`);
    const detected = detectMarketRegime(candles);
    const regimeMap: Record<string, string> = { BULL_TREND: 'BULL', BEAR_TREND: 'BEAR', SIDEWAYS: 'SIDEWAYS', HIGH_VOLATILITY: 'HIGH_VOLATILITY', LOW_VOLATILITY: 'LOW_VOLATILITY', NEWS_SHOCK: 'HIGH_VOLATILITY', LIQUIDITY_CRISIS: 'HIGH_VOLATILITY', FUNDING_EXTREME: 'HIGH_VOLATILITY' };
    const detectedRegime = regimeMap[detected.type] ?? 'SIDEWAYS';
    const recommendedConfig = {
      strategy: detectedRegime === 'BULL' || detectedRegime === 'BEAR' ? 'TREND_FOLLOWING' : detectedRegime === 'SIDEWAYS' ? 'MEAN_REVERSION' : 'CONSERVATIVE',
      confidenceThreshold: detectedRegime === 'HIGH_VOLATILITY' ? 75 : 65,
      atrMultiplier: detectedRegime === 'HIGH_VOLATILITY' ? 2.5 : 1.5,
      source: 'REAL_EXCHANGE_CANDLES',
      provider,
      interval,
      firstCandleAt: candles[0]?.openTime.toISOString(),
      lastCandleAt: candles.at(-1)?.closeTime.toISOString(),
    };
    const row = await this.prisma.marketRegimeState.create({ data: { symbol, provider, interval, regime: detectedRegime, confidence: detected.confidence * 100, recommendedConfig } });
    return { symbol, detectedRegime, confidence: row.confidence, evidence: detected.evidence, recommendedConfig, detectedAt: row.detectedAt.toISOString() };
  }

  async getSelectedRegimeIntelligence(userId: string, symbol?: string, provider?: ExchangeProvider, interval?: ExchangeInterval) {
    const target = await this.resolveResearchTarget(userId, symbol, provider, interval);
    return this.getRegimeIntelligence(target.symbol, target.provider, target.interval);
  }

  async getRecommendations(userId?: string): Promise<QuantRecommendation[]> {
    const dbRecs = await this.prisma.quantRecommendation.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return (dbRecs ?? []).map((item: QuantRecommendationRecord) => ({
      ...item,
      historicalResult: (item.historicalResult ?? {}) as Record<string, unknown>,
    }));
  }

  private async multiSymbolValidationEvidence(
    userId: string,
    requestedSymbols: string[],
    strategyKey = 'ai-core',
  ) {
    const scope = await this.getSelectedResearchScope(userId);
    const requested = requestedSymbols
      .map((value) => value.trim().toUpperCase().replace(/[/_]/g, '-'))
      .filter((value) => /^[A-Z0-9]+-[A-Z0-9]+$/.test(value));
    // Registered settings/schedules are authoritative. PortfolioStrategy.symbols
    // may still contain the BTC/ETH defaults created before the user configured
    // their trading universe, so only use requested symbols as a legacy fallback.
    const symbols = [...new Set(scope.symbols.length ? scope.symbols : requested)];
    const timeframes = scope.timeframes;
    const [rows, connections] = symbols.length && timeframes.length
      ? await Promise.all([
        this.prisma.researchValidationRun.findMany({
          where: {
            userId,
            strategyKey,
            symbol: { in: symbols },
            interval: { in: timeframes },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.exchangeConnection.findMany({
          where: { userId, isEnabled: true, isVerified: true },
          select: { provider: true },
          orderBy: { createdAt: 'asc' },
        }),
      ])
      : [[], []] as const;
    const activeProviders = new Set(connections.map((connection) => connection.provider));
    const expectedProviderBySymbol = new Map(symbols.map((symbol) => {
      const recentProvider = scope.recentRuns.find((run) =>
        run.symbol === symbol && activeProviders.has(run.provider),
      )?.provider;
      return [symbol, recentProvider ?? connections[0]?.provider] as const;
    }));
    const latestByPair = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const expectedProvider = expectedProviderBySymbol.get(row.symbol);
      if (!expectedProvider || row.provider !== expectedProvider) continue;
      const key = `${row.symbol}:${row.interval}:${row.provider}`;
      if (!latestByPair.has(key)) latestByPair.set(key, row);
    }
    const latest = [...latestByPair.values()];
    const now = Date.now();
    const isFresh = (row: (typeof latest)[number]) => {
      if (!(row.createdAt instanceof Date)) return false;
      const maxAge = Math.max(36 * 3_600_000, timeframeMilliseconds(row.interval) * 12);
      return now - row.createdAt.getTime() <= maxAge;
    };
    const available = latest.filter(isFresh);
    const passing = available.filter((row) => row.walkForwardStable && row.outOfSampleSharpe > 0);
    const requiredPairs = symbols.length * timeframes.length;
    const coveragePct = requiredPairs ? available.length / requiredPairs * 100 : 0;
    const passRatePct = available.length ? passing.length / available.length * 100 : 0;
    const averageSharpe = available.length ? available.reduce((sum, row) => sum + row.outOfSampleSharpe, 0) / available.length : null;
    const symbolsWithPassingEvidence = [...new Set(passing.map((row) => row.symbol))];
    const everySymbolCovered = symbols.length > 0 && symbols.every((symbol) => symbolsWithPassingEvidence.includes(symbol));
    const passed = requiredPairs > 0 && coveragePct === 100 && passRatePct >= 50 && everySymbolCovered && averageSharpe !== null && averageSharpe > 0;
    return {
      source: 'MULTI_SYMBOL_REAL_CANDLE_VALIDATION',
      symbols,
      timeframes,
      expectedProviders: Object.fromEntries(expectedProviderBySymbol),
      requiredPairs,
      availablePairs: available.length,
      passingPairs: passing.length,
      coveragePct: Number(coveragePct.toFixed(2)),
      passRatePct: Number(passRatePct.toFixed(2)),
      averageOutOfSampleSharpe: averageSharpe === null ? null : Number(averageSharpe.toFixed(4)),
      everySymbolCovered,
      symbolsWithPassingEvidence,
      validationRunIds: latest.map((row) => row.id),
      passingValidationRunIds: passing.map((row) => row.id),
      pairs: latest.map((row) => ({
        symbol: row.symbol,
        interval: row.interval,
        provider: row.provider,
        fresh: isFresh(row),
        walkForwardStable: row.walkForwardStable,
        outOfSampleSharpe: Number(row.outOfSampleSharpe.toFixed(4)),
        passed: isFresh(row) && row.walkForwardStable && row.outOfSampleSharpe > 0,
        createdAt: row.createdAt?.toISOString?.() ?? null,
      })),
      passed,
    };
  }

  async refreshRecommendations(userId: string) {
    const refresh = () => this.performRecommendationsRefresh(userId);
    if (!this.taskLock) return refresh();
    const result = await this.taskLock.run(
      `quant-recommendations-refresh:${userId}`,
      300,
      refresh,
    );
    return result ?? this.getRecommendations(userId);
  }

  private async performRecommendationsRefresh(userId: string) {
    const strategies = await this.prisma.portfolioStrategy.findMany({
      where: { userId },
      include: {
        performance: true,
        allocation: true,
        livePositions: true,
        closedTrades: {
          where: { sourceDataComplete: true },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const recommendations = await Promise.all(strategies
      .filter((strategy) => (strategy.performance?.totalTrades ?? 0) > 0 || strategy.livePositions.length > 0)
      .map(async (strategy) => {
        const validationEvidence = await this.multiSymbolValidationEvidence(
          userId,
          strategy.symbols,
          strategy.key,
        );
        const regimeRows = validationEvidence.symbols.length ? await this.prisma.marketRegimeState.findMany({
          where: { symbol: { in: validationEvidence.symbols }, interval: { in: validationEvidence.timeframes } },
          orderBy: { detectedAt: 'desc' },
        }) : [];
        const latestRegimes = new Map<string, string>();
        for (const row of regimeRows) {
          const key = `${row.symbol}:${row.provider ?? 'UNKNOWN'}:${row.interval ?? 'UNKNOWN'}`;
          if (!latestRegimes.has(key)) latestRegimes.set(key, row.regime);
        }
        const symbolRegimes = [...latestRegimes.entries()].map(([scope, regime]) => {
          const [symbol, provider, interval] = scope.split(':');
          return { symbol, provider, interval, regime };
        });
        const highVolatility = symbolRegimes.some((item) => ['HIGH_VOLATILITY', 'PANIC', 'EUPHORIA'].includes(item.regime));
        const trending = symbolRegimes.filter((item) => ['BULL', 'BEAR', 'TRENDING'].includes(item.regime)).length;
        const marketRegime = highVolatility ? 'HIGH_VOLATILITY' : trending > symbolRegimes.length / 2 ? 'TRENDING' : 'SIDEWAYS';
        const returnPct = Number(strategy.performance?.returnPct ?? 0);
        const drawdownPct = Number(strategy.performance?.drawdownPct ?? 0);
        const weight = Number(strategy.allocation?.weight ?? 0);
        const livePnl = strategy.livePositions.reduce((sum, item) => sum + Number(item.unrealizedPnl) + Number(item.realizedPnl ?? 0), 0);
        const liveSignal = livePnl > 0 ? 0.02 : livePnl < 0 ? -0.02 : 0;
        const regimeSignal = marketRegime === 'TRENDING' ? 0.03 : marketRegime === 'HIGH_VOLATILITY' ? -0.04 : 0.01;
        const delta = Math.max(-0.12, Math.min(0.12, returnPct * 0.08 - drawdownPct * 0.2 + liveSignal + regimeSignal));
        const recommendedWeight = Math.max(0.05, Math.min(0.4, weight + delta));
        const isAlreadyApplied = Math.abs(delta) < 0.005 || Math.abs(weight - recommendedWeight) < 0.005;
        const verifiedAttributedTrades = strategy.closedTrades.length;
        return buildQuantRecommendation({
          title: `Adjust ${strategy.name} allocation to ${Math.round(recommendedWeight * 100)}%`,
          moduleSource: 'PORTFOLIO_INTELLIGENCE',
          problemStatement: `Strategy ${strategy.name} should be rebalanced only from its configured symbols and multi-timeframe evidence.`,
          evidenceText: `${verifiedAttributedTrades}/5 attributed verified closed trades; ${validationEvidence.availablePairs}/${validationEvidence.requiredPairs} symbol-timeframe validations available; ${validationEvidence.passingPairs} pass, coverage ${validationEvidence.coveragePct}%.`,
          historicalResult: { strategyKey: strategy.key, returnPct, drawdownPct, recommendedWeight, marketRegime, symbolRegimes, livePnl, symbols: validationEvidence.symbols, verifiedAttributedTrades, validationEvidence },
          expectedBenefit: 'Improves portfolio risk-adjusted returns using validation scoped to the configured investment universe.',
          estimatedRisk: validationEvidence.passed ? 'Medium if validated symbol regimes change abruptly.' : 'High because multi-symbol validation is incomplete or failing.',
          priority: drawdownPct > 0.05 || marketRegime === 'HIGH_VOLATILITY' ? 'HIGH' : 'MEDIUM',
          implementationCost: 'LOW',
          rollbackPlan: 'Revert the allocation weight using the portfolio rebalance endpoint.',
          status: portfolioRecommendationStatus({
            validationPassed: validationEvidence.passed,
            verifiedAttributedTrades,
            isAlreadyApplied,
          }),
        });
      }));

    const quantRecommendationModel = this.prisma.quantRecommendation;
    const existing = await quantRecommendationModel.findMany({
      where: { userId, moduleSource: 'PORTFOLIO_INTELLIGENCE' },
      orderBy: { createdAt: 'desc' },
    });
    const existingByStrategy = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      const strategyKey = jsonObject(row.historicalResult).strategyKey;
      if (typeof strategyKey === 'string' && !existingByStrategy.has(strategyKey)) {
        existingByStrategy.set(strategyKey, row);
      }
    }
    await Promise.all(recommendations.map(async (item) => {
      const strategyKey = item.historicalResult.strategyKey;
      const current = typeof strategyKey === 'string'
        ? existingByStrategy.get(strategyKey)
        : undefined;
      const calculatedStatus = item.status ?? 'PENDING_APPROVAL';
      const status = current?.status === 'REJECTED' && current.title === item.title
        ? 'REJECTED'
        : calculatedStatus;
      const data = {
        title: item.title,
        problemStatement: item.problemStatement,
        evidenceText: item.evidenceText,
        historicalResult: item.historicalResult as Prisma.InputJsonValue,
        expectedBenefit: item.expectedBenefit,
        estimatedRisk: item.estimatedRisk,
        priority: item.priority,
        implementationCost: item.implementationCost,
        rollbackPlan: item.rollbackPlan,
        status,
        ...(current && (current.title !== item.title || current.status !== status)
          ? { reviewedByUserId: null, reviewedAt: null, rejectionReason: null }
          : {}),
      };
      if (current) {
        await quantRecommendationModel.update({ where: { id: current.id }, data });
      } else {
        await quantRecommendationModel.create({
          data: { userId, moduleSource: item.moduleSource, ...data },
        });
      }
    }));

    return recommendations;
  }

  async applyStrategyRecommendation(userId: string, strategyKey: string, targetWeight?: number) {
    const strategies = await this.prisma.portfolioStrategy.findMany({
      where: { userId },
      include: { allocation: true, performance: true, closedTrades: true },
      orderBy: { createdAt: 'asc' },
    });

    const strategy = strategies.find((item) => item.key === strategyKey);
    if (!strategy) throw new NotFoundException('Portfolio strategy not found');
    const validation = await this.multiSymbolValidationEvidence(
      userId,
      strategy.symbols,
      strategy.key,
    );
    const verifiedAttributedTrades = strategy.closedTrades.filter(
      (trade) => trade.sourceDataComplete,
    ).length;
    if (!validation.passed) {
      return {
        applied: false,
        strategyKey,
        mode: 'VALIDATION_REQUIRED' as const,
        reason: 'MULTI_SYMBOL_VALIDATION_NOT_PASSED' as const,
        verifiedAttributedTrades,
        tradesRequiredForFullAllocation: Math.max(0, 5 - verifiedAttributedTrades),
        validation: {
          coveragePct: validation.coveragePct,
          passRatePct: validation.passRatePct,
          availablePairs: validation.availablePairs,
          requiredPairs: validation.requiredPairs,
          passingPairs: validation.passingPairs,
        },
      };
    }

    const currentWeight = Number(strategy.allocation?.weight ?? 0.2);
    const requestedWeight = Number.isFinite(targetWeight)
      ? Number(targetWeight)
      : currentWeight;
    const allocationTarget = resolveStrategyAllocationTarget({
      requestedWeight,
      currentWeight,
      verifiedAttributedTrades,
    });
    const appliedWeight = allocationTarget.targetWeight;
    const others = strategies.filter((item) => item.id !== strategy.id);
    const remainingWeight = Math.max(0.01, 1 - appliedWeight);
    const otherCurrentWeight = others.reduce((sum, item) => sum + Math.max(0.01, Number(item.allocation?.weight ?? 0.01)), 0);
    const normalizedWeights = strategies.map((item) => {
      if (item.id === strategy.id) return appliedWeight;
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

    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        strategies.map((item, index) => {
          const weight = Number(finalWeights[index] ?? 0.01);
          const allocatedCapital = totalCapital > 0 ? totalCapital * weight : 100_000 * weight;
          return tx.strategyAllocation.upsert({
            where: { strategyId: item.id },
            update: { weight, allocatedCapital },
            create: { strategyId: item.id, weight, allocatedCapital },
          });
        }),
      );
    });

    await this.refreshRecommendations(userId);
    return {
      applied: true,
      strategyKey,
      mode: allocationTarget.mode,
      targetWeight: appliedWeight,
      requestedTargetWeight: allocationTarget.requestedWeight,
      verifiedAttributedTrades,
      tradesRequiredForFullAllocation: Math.max(0, 5 - verifiedAttributedTrades),
    };
  }

  async refreshStrategyValidations(userId: string, strategyKey: string) {
    const refresh = () => this.performStrategyValidationRefresh(userId, strategyKey);
    if (!this.taskLock) return refresh();
    const result = await this.taskLock.run(
      `quant-validation-refresh:${userId}:${strategyKey}`,
      600,
      refresh,
    );
    if (!result) {
      throw new ConflictException('VALIDATION_REFRESH_ALREADY_RUNNING');
    }
    return result;
  }

  private async performStrategyValidationRefresh(userId: string, strategyKey: string) {
    validationBacktestStrategy(strategyKey);
    if (!this.research) {
      throw new BadRequestException('VALIDATION_REFRESH_UNAVAILABLE');
    }
    const [strategy, scope, connections] = await Promise.all([
      this.prisma.portfolioStrategy.findUnique({
        where: { userId_key: { userId, key: strategyKey } },
        select: { symbols: true },
      }),
      this.getSelectedResearchScope(userId),
      this.prisma.exchangeConnection.findMany({
        where: { userId, isEnabled: true, isVerified: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!strategy) throw new NotFoundException('Portfolio strategy not found');
    if (!connections.length) {
      throw new BadRequestException('NO_VERIFIED_EXCHANGE_CONNECTION');
    }
    const symbols = scope.symbols.length ? scope.symbols : strategy.symbols;
    if (!symbols.length || !scope.timeframes.length) {
      throw new BadRequestException('NO_VALIDATION_SCOPE');
    }

    const providerSymbols = new Map<ExchangeProvider, string[]>();
    for (const symbol of symbols) {
      const recentProvider = scope.recentRuns.find((run) => run.symbol === symbol)?.provider;
      const connection = connections.find((item) => item.provider === recentProvider) ?? connections[0]!;
      const provider = connection.provider === 'BINANCE_FUTURES'
        ? ExchangeProvider.BINANCE_FUTURES
        : ExchangeProvider.OKX_FUTURES;
      providerSymbols.set(provider, [...(providerSymbols.get(provider) ?? []), symbol]);
    }

    const refreshes = [];
    for (const interval of scope.timeframes) {
      for (const [provider, providerScopedSymbols] of providerSymbols) {
        refreshes.push(await this.research.refreshFullQuantValidations({
          userId,
          provider,
          symbols: providerScopedSymbols,
          interval,
          strategyKeys: [strategyKey],
          lookbackCandles: 500,
        }));
      }
    }
    await this.refreshRecommendations(userId);
    const portfolio = await this.getPortfolioIntelligence(userId);
    return {
      strategyKey,
      requested: refreshes.reduce((sum, item) => sum + item.requested, 0),
      completed: refreshes.reduce((sum, item) => sum + item.completed, 0),
      unavailable: refreshes.reduce((sum, item) => sum + item.unavailable, 0),
      results: refreshes.flatMap((item) => item.results),
      allocation: portfolio.allocations.find((item) => item.strategyKey === strategyKey),
    };
  }

  async reviewRecommendation(id: string, action: 'APPROVE' | 'REJECT', userId?: string, reason?: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      try {
        const quantRecommendationModel = this.prisma.quantRecommendation;
        const rec = await quantRecommendationModel.findFirst({ where: { id, ...(userId ? { userId } : { userId: null }) } });
        if (rec) {
          let nextStatus: QuantRecommendation['status'] = action === 'APPROVE'
            ? 'APPROVED'
            : 'REJECTED';
          if (action === 'APPROVE') {
            const evidence = jsonObject(rec.historicalResult);
            const symbols = Array.isArray(evidence.symbols)
              ? evidence.symbols.filter((value): value is string => typeof value === 'string')
              : [];
            const strategyKey = typeof evidence.strategyKey === 'string'
              ? evidence.strategyKey
              : 'ai-core';
            const validation = await this.multiSymbolValidationEvidence(
              userId!,
              symbols,
              strategyKey,
            );
            if (!validation.passed) {
              throw new BadRequestException(`VALIDATION_REQUIRED: recommendation has ${validation.coveragePct}% multi-symbol coverage and ${validation.passRatePct}% passing walk-forward/out-of-sample evidence`);
            }
            if (rec.moduleSource === 'PORTFOLIO_INTELLIGENCE') {
              const recommendedWeight = Number(evidence.recommendedWeight);
              if (!Number.isFinite(recommendedWeight)) {
                throw new BadRequestException('INVALID_PORTFOLIO_RECOMMENDATION_TARGET');
              }
              const applied = await this.applyStrategyRecommendation(
                userId!,
                strategyKey,
                recommendedWeight,
              );
              if (!applied.applied) {
                throw new BadRequestException('VALIDATION_REQUIRED: portfolio allocation remains blocked');
              }
              nextStatus = applied.mode === 'CANARY' ? 'CANARY' : 'DEPLOYED';
            } else if (
              rec.moduleSource === 'WEIGHT_OPTIMIZER' ||
              rec.moduleSource === 'THRESHOLD_OPTIMIZER'
            ) {
              const config = await this.prisma.selfLearningConfiguration.upsert({
                where: { userId: userId! },
                update: {},
                create: { userId: userId!, weightsJson: BASE_WEIGHTS, shadowWeightsJson: BASE_WEIGHTS },
              });
              if (config.shadowEnabled || config.canaryEnabled) {
                throw new BadRequestException('ACTIVE_LIFECYCLE_EXISTS: wait for the current shadow/canary experiment to finish');
              }
              if (rec.moduleSource === 'WEIGHT_OPTIMIZER') {
                const optimizedWeights = validatedAgentWeights(evidence.weights);
                await this.prisma.selfLearningConfiguration.update({ where: { userId: userId! }, data: { shadowEnabled: true, shadowWeightsJson: optimizedWeights, shadowVersion: config.liveVersion + 1, shadowStartedAt: new Date() } });
              }
              if (rec.moduleSource === 'THRESHOLD_OPTIMIZER' && typeof evidence.optimizedValue === 'number') {
                await this.prisma.selfLearningConfiguration.update({ where: { userId: userId! }, data: { shadowEnabled: true, shadowThreshold: evidence.optimizedValue, shadowVersion: config.liveVersion + 1, shadowStartedAt: new Date() } });
              }
              nextStatus = 'SHADOW';
            }
          }
          const updated = await quantRecommendationModel.update({
            where: { id: rec.id },
            data: {
              status: nextStatus,
              reviewedByUserId: userId ?? null,
              reviewedAt: new Date(),
              rejectionReason: action === 'REJECT' ? reason ?? null : null,
            },
          });
          this.logger.log({ event: 'quant_recommendation_reviewed', id, action, userId });
          return updated;
        }
      } catch (error) {
        this.logger.warn({ event: 'quant_recommendation_review_failed', id, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    throw new NotFoundException('Evidence-backed recommendation not found');
  }

  async runSimulation(userId: string, request: SimulationRequest & { symbol?: string; provider?: ExchangeProvider; interval?: ExchangeInterval; lookbackCandles?: number }) {
    const { symbol, provider, interval } = await this.resolveResearchTarget(userId, request.symbol, request.provider, request.interval);
    const candles = await this.marketData.getHistoricalCandles({ provider, symbol, interval, limit: Math.max(100, Math.min(1000, request.lookbackCandles ?? 500)) });
    if (candles.length < 100) throw new BadRequestException(`DATA_UNAVAILABLE: only ${candles.length} real candles are available`);
    const split = Math.floor(candles.length * 0.7);
    const validationCandles = candles.slice(split);
    const strategyName = typeof request.config.strategyName === 'string' ? request.config.strategyName : 'HYBRID_QUANT';
    const baseInput = { candles: validationCandles, provider, symbol, interval, initialBalance: 10_000, leverage: 2, riskPerTrade: 0.01, riskRewardRatio: 2, feeRate: 0.0005, slippageRate: 0.0002 };
    const baseline = runHistoricalBacktest({ ...baseInput, strategyName: 'BUY_AND_HOLD' });
    const candidate = runHistoricalBacktest({ ...baseInput, strategyName, confidenceFloor: numericConfig(request.config.confidenceThreshold), atrMultiplier: numericConfig(request.config.atrMultiplier), rsiPeriod: numericConfig(request.config.rsiPeriod), riskRewardRatio: numericConfig(request.config.riskRewardRatio) ?? 2 });
    if (candidate.trades.length < 3) throw new BadRequestException(`DATA_UNAVAILABLE: candidate produced only ${candidate.trades.length} out-of-sample trades`);
    const passedCriteria = candidate.metrics.totalReturn > baseline.metrics.totalReturn && candidate.metrics.sharpeRatio > baseline.metrics.sharpeRatio && candidate.metrics.maxDrawdown <= baseline.metrics.maxDrawdown;
    const result = {
      name: request.name,
      experimentType: request.experimentType,
      passedCriteria,
      baselineExpectedValue: baseline.metrics.expectancy,
      simulatedExpectedValue: candidate.metrics.expectancy,
      baselineSharpe: baseline.metrics.sharpeRatio,
      simulatedSharpe: candidate.metrics.sharpeRatio,
      baselineMaxDrawdownPct: baseline.metrics.maxDrawdown * 100,
      simulatedMaxDrawdownPct: candidate.metrics.maxDrawdown * 100,
      sampleSize: candidate.trades.length,
      source: 'REAL_EXCHANGE_CANDLES_OUT_OF_SAMPLE',
      evidenceWindow: { first: validationCandles[0]?.openTime.toISOString(), last: validationCandles.at(-1)?.closeTime.toISOString(), provider, symbol, interval },
      summary: passedCriteria ? `${strategyName} passed the real-candle out-of-sample gate.` : `${strategyName} did not outperform the real-candle baseline.`,
    };
    await this.prisma.simulationExperiment.create({ data: { userId, name: request.name, experimentType: request.experimentType, configJson: request.config as Prisma.InputJsonValue, simulationResult: result, provenance: result.evidenceWindow, passedCriteria } });
    return result;
  }

  getSyntheticSimulationDashboard() {
    throw new BadRequestException('SYNTHETIC_DATA_DISABLED: use evidence-backed historical simulation');
  }

  runSyntheticSimulationSuite(options?: { limit?: number }) {
    void options;
    throw new BadRequestException('SYNTHETIC_DATA_DISABLED: use evidence-backed historical simulation');
  }

  runSyntheticStatisticalValidation(options?: { limit?: number; iterations?: number }) {
    void options;
    throw new BadRequestException('SYNTHETIC_DATA_DISABLED: use evidence-backed historical simulation');
  }

  async getReport(type: ReportType, userId: string) {
    return this.reportService.generateReport(type, userId);
  }

  async getKnowledgeBase(userId: string, category?: string) {
    return this.knowledgeService.listArchives(userId, category);
  }
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function strategyRules(strategy: string): string[] {
  if (strategy.includes('MEAN_REVERSION') || strategy.includes('RSI') || strategy.includes('GRID')) {
    return ['Enter only at statistically stretched RSI/z-score levels', 'Exit on mean reversion, stop loss, take profit or eight-bar timeout'];
  }
  if (strategy.includes('BREAKOUT') || strategy.includes('DONCHIAN') || strategy.includes('TURTLE')) {
    return ['Enter on a verified 20-bar high/low breakout', 'Use volatility-scaled stop and risk-reward take profit'];
  }
  if (strategy === 'NO_TRADE') return ['Do not open a position'];
  if (strategy === 'BUY_AND_HOLD') return ['Open once near the beginning of the evidence window', 'Close at the end of the evidence window'];
  return ['Use strategy-specific trend, momentum, volume and regime conditions', 'Apply fees, slippage, volatility stop and non-overlapping positions'];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function analysisBias(name: string, value: Record<string, unknown>): 'LONG' | 'SHORT' | 'NEUTRAL' | null {
  if (typeof value.dataQuality === 'string' && value.dataQuality.toUpperCase() === 'INSUFFICIENT') return null;
  const trend = jsonObject(value.trend);
  const impact = jsonObject(value.impact);
  const sentiment = jsonObject(value.sentiment);
  const candidates = [value.focusDirection, trend.direction, impact.direction, sentiment.overall, value.macroTrend, value.activity]
    .map((item) => typeof item === 'string' ? item.toUpperCase() : '');
  if (candidates.some((item) => ['BULLISH', 'UP', 'POSITIVE', 'RISK_ON', 'ACCUMULATION', 'NET_OUTFLOW'].includes(item))) return 'LONG';
  if (candidates.some((item) => ['BEARISH', 'DOWN', 'NEGATIVE', 'RISK_OFF', 'DISTRIBUTION', 'NET_INFLOW'].includes(item))) return 'SHORT';
  if (candidates.some((item) => ['NEUTRAL', 'SIDEWAYS', 'MIXED', 'BALANCED'].includes(item))) return 'NEUTRAL';
  return name ? null : null;
}

function returnMetrics(values: number[]) {
  if (!values.length) return { mean: 0, sharpe: 0, profitFactor: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  const grossProfit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return {
    mean: Number(mean.toFixed(6)),
    sharpe: variance > 0 ? Number((mean / Math.sqrt(variance) * Math.sqrt(values.length)).toFixed(4)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(4)) : 0,
  };
}

function numericConfig(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validatedAgentWeights(value: unknown): Prisma.InputJsonObject {
  const candidate = jsonObject(value);
  const names = ['market', 'technical', 'news', 'sentiment', 'macro', 'onchain'];
  if (!names.every((name) => typeof candidate[name] === 'number' && Number.isFinite(candidate[name]) && Number(candidate[name]) > 0)) {
    throw new BadRequestException('INVALID_EVIDENCE: optimized agent weights are incomplete');
  }
  return Object.fromEntries(names.map((name) => [name, Number(candidate[name])]));
}
