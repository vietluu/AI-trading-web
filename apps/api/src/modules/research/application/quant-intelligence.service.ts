import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { MarketDataService } from '../../../market-data/application/market-data.service';

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
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'SHADOW' | 'CANARY' | 'REJECTED' | 'DEPLOYED' | 'ROLLED_BACK';
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
  trades: Array<{ netPnl: Prisma.Decimal | number; returnPct: number | null }>,
) {
  const netPnls = trades.map((trade) => Number(trade.netPnl));
  const returns = trades
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

@Injectable()
export class QuantIntelligenceService {
  private readonly logger = new Logger(QuantIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly reportService: QuantReportService,
    private readonly knowledgeService: KnowledgeBaseService,
  ) {}

  async getDecisionScorecard(userId: string) {
    const [closedTrades, pipelineTotal, pipelineCompleted, pipelineFailed, riskTotal, riskApproved, liveOrders, latestValidation] = await Promise.all([
      this.prisma.closedTrade.findMany({ where: { userId }, orderBy: { closedAt: 'asc' } }),
      this.prisma.pipelineRun.count({ where: { userId } }),
      this.prisma.pipelineRun.count({ where: { userId, status: 'COMPLETED' } }),
      this.prisma.pipelineRun.count({ where: { userId, status: 'FAILED' } }),
      this.prisma.riskAssessment.count({ where: { userId } }),
      this.prisma.riskAssessment.count({ where: { userId, approved: true } }),
      this.prisma.liveOrder.count({ where: { userId } }),
      this.prisma.researchValidationRun.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const ledger = calculateLedgerPortfolioMetrics(closedTrades);
    const clampPct = (value: number) => Math.max(0, Math.min(100, value));
    const researchValidationScore = latestValidation
      ? [
          clampPct(latestValidation.probabilityOfProfit),
          clampPct(100 - latestValidation.probabilityOfRuin),
          latestValidation.walkForwardStable ? 100 : 0,
          latestValidation.outOfSampleSharpe > 0 ? clampPct(latestValidation.outOfSampleSharpe * 50) : 0,
          clampPct(latestValidation.regimeStabilityScore),
        ].reduce((sum, value) => sum + value, 0) / 5
      : 0;
    const dimensions = {
      dataEvidence: Math.min(100, closedTrades.length / 30 * 100),
      pipelineReliability: pipelineTotal ? pipelineCompleted / pipelineTotal * 100 : 0,
      executionEvidence: riskApproved ? Math.min(100, liveOrders / riskApproved * 100) : 0,
      riskCoverage: liveOrders ? Math.min(100, riskTotal / liveOrders * 100) : 0,
      researchValidation: Number(researchValidationScore.toFixed(2)),
    };
    const overallScore = Number((Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.keys(dimensions).length).toFixed(1));
    const netPnl = closedTrades.reduce((sum, trade) => sum + Number(trade.netPnl), 0);
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
      walkForwardStability: latestValidation ? Number(latestValidation.walkForwardAvgReturn) : null,
      monteCarloSurvivalRate: latestValidation ? Number((100 - latestValidation.probabilityOfRuin).toFixed(2)) : null,
      evidence: {
        source: 'EXCHANGE_LEDGER_PIPELINE_RUNTIME_AND_RESEARCH_DB',
        closedTrades: closedTrades.length,
        netPnl: Number(netPnl.toFixed(8)),
        pipelineTotal,
        pipelineCompleted,
        pipelineFailed,
        riskAssessments: riskTotal,
        riskApproved,
        liveOrders,
        validationRunId: latestValidation?.id ?? null,
        validationPassed: latestValidation
          ? latestValidation.walkForwardStable
            && latestValidation.outOfSampleSharpe > 0
            && latestValidation.probabilityOfRuin < 25
          : false,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }

  async getSelectedResearchSymbols(userId: string): Promise<{ symbols: string[]; settings: string[]; pipelineTriggers: string[] }> {
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const [setting, triggeredRuns] = await Promise.all([
      this.prisma.userSetting.findUnique({ where: { userId }, select: { preferredSymbols: true } }),
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
    const pipelineTriggers = [...new Set(triggeredRuns.map((item) => normalize(item.symbol)).filter(valid))];
    return { settings, pipelineTriggers, symbols: [...new Set([...settings, ...pipelineTriggers])] };
  }

  async generateSelectedHypotheses(userId: string, category?: HypothesisInput['category'], requestedSymbol?: string) {
    const selected = await this.getSelectedResearchSymbols(userId);
    const requested = requestedSymbol?.trim().toUpperCase().replace(/[/_]/g, '-');
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

  async getDiscoveredStrategies(userId: string, symbol = 'BTC-USDT', provider = ExchangeProvider.OKX_FUTURES, interval = ExchangeInterval.FIFTEEN_MINUTES, lookbackCandles = 500) {
    const candles = await this.marketData.getHistoricalCandles({ provider, symbol, interval, limit: Math.max(100, Math.min(1000, lookbackCandles)) });
    if (candles.length < 100) throw new BadRequestException(`DATA_UNAVAILABLE: only ${candles.length} real candles are available`);
    const suite = runBenchmarkSuite({ candles, provider, symbol, interval, initialBalance: 10_000, leverage: 2, riskPerTrade: 0.01, riskRewardRatio: 2 });
    const ranked = [...suite.benchmarks].sort((left, right) => right.metrics.rankingScore - left.metrics.rankingScore);
    const strategies = ranked.map((item, index) => ({
      key: `${item.strategyName.toLowerCase().replace(/_/g, '-')}-${symbol.toLowerCase()}`,
      name: `${item.strategyName.replace(/_/g, ' ')} (${symbol})`,
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
    await this.prisma.discoveredStrategy.deleteMany({ where: { userId } });
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

  async getAutoBenchmarks(userId: string, strategyName = 'HYBRID_QUANT', symbol = 'BTC-USDT') {
    const strategies = await this.getDiscoveredStrategies(userId, symbol);
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
    const validation = await this.prisma.researchValidationRun.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    await this.prisma.quantRecommendation.deleteMany({ where: { userId, moduleSource: 'WEIGHT_OPTIMIZER', status: 'PENDING_APPROVAL' } });
    await this.prisma.quantRecommendation.create({ data: {
      userId,
      title: 'Promote evidence-backed agent weights to shadow evaluation',
      moduleSource: 'WEIGHT_OPTIMIZER',
      problemStatement: 'Agent weights should reflect measured directional contribution rather than static defaults.',
      evidenceText: `${records.length} evaluated pipeline decisions; validation run ${validation?.id ?? 'missing'}.`,
      historicalResult: { ...result, validationRunId: validation?.id ?? null, walkForwardStable: validation?.walkForwardStable ?? false, outOfSampleSharpe: validation?.outOfSampleSharpe ?? null },
      expectedBenefit: 'Shadow-test higher-evidence agent weighting without changing live decisions.',
      estimatedRisk: 'Weights may overfit recent market regimes.',
      priority: 'MEDIUM',
      implementationCost: 'LOW',
      rollbackPlan: 'Disable shadow mode; live weights remain unchanged until governed promotion.',
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
    const validation = await this.prisma.researchValidationRun.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    await this.prisma.quantRecommendation.deleteMany({ where: { userId, moduleSource: 'THRESHOLD_OPTIMIZER', status: 'PENDING_APPROVAL' } });
    await this.prisma.quantRecommendation.create({ data: {
      userId,
      title: `Shadow-test confidence threshold ${best.threshold}`,
      moduleSource: 'THRESHOLD_OPTIMIZER',
      problemStatement: 'The current threshold is not the highest-expectancy candidate in verified pipeline evaluations.',
      evidenceText: `${best.sampleSize} decisions above threshold; observed accuracy ${(best.accuracy * 100).toFixed(2)}%.`,
      historicalResult: { ...result[0], validationRunId: validation?.id ?? null, walkForwardStable: validation?.walkForwardStable ?? false, outOfSampleSharpe: validation?.outOfSampleSharpe ?? null },
      expectedBenefit: 'Evaluate the measured threshold in shadow mode before live promotion.',
      estimatedRisk: 'The optimum can drift as the market regime changes.',
      priority: 'MEDIUM',
      implementationCost: 'LOW',
      rollbackPlan: 'Disable shadow mode; the live confidence threshold is unchanged.',
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

    const regimeReport = await this.getRegimeIntelligence();
    const marketRegime = this.normalizeMarketRegime(regimeReport.detectedRegime);

    const analysis = analyzePortfolioIntelligence(
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
          returns: strategy.closedTrades
            .filter((trade) => trade.returnPct !== null)
            .map((trade) => ({ at: trade.closedAt.toISOString(), returnPct: trade.returnPct! })),
          marketRegime,
        };
      }),
    );
    const ledgerMetrics = calculateLedgerPortfolioMetrics(allClosedTrades);
    return {
      ...analysis,
      overallSharpeRatio: ledgerMetrics.sharpeRatio,
      overallProfitFactor: ledgerMetrics.profitFactor,
      expectedValue: ledgerMetrics.expectedValuePct,
      maxPortfolioDrawdownPct: ledgerMetrics.maxDrawdownPct,
      actualTrading: {
        source: 'EXCHANGE_CLOSED_TRADE_LEDGER',
        totalTrades: allClosedTrades.length,
        completeTrades: allClosedTrades.filter((trade) => trade.sourceDataComplete).length,
        assignedTrades: allClosedTrades.filter((trade) => trade.strategyId).length,
        unassignedTrades: allClosedTrades.filter((trade) => !trade.strategyId).length,
        netPnl: Number(allClosedTrades.reduce((sum, trade) => sum + Number(trade.netPnl), 0).toFixed(8)),
        winRate: allClosedTrades.length
          ? Number((allClosedTrades.filter((trade) => Number(trade.netPnl) > 0).length / allClosedTrades.length * 100).toFixed(2))
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

  async getRegimeIntelligence(symbol = 'BTC-USDT', provider = ExchangeProvider.OKX_FUTURES, interval = ExchangeInterval.FIFTEEN_MINUTES) {
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
    const row = await this.prisma.marketRegimeState.create({ data: { symbol, regime: detectedRegime, confidence: detected.confidence * 100, recommendedConfig } });
    return { symbol, detectedRegime, confidence: row.confidence, evidence: detected.evidence, recommendedConfig, detectedAt: row.detectedAt.toISOString() };
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
    const [strategies, validation] = await Promise.all([
      this.prisma.portfolioStrategy.findMany({
        where: { userId },
        include: { performance: true, allocation: true, livePositions: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.researchValidationRun.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const regimeReport = await this.getRegimeIntelligence();
    const marketRegime = this.normalizeMarketRegime(regimeReport.detectedRegime);

    const recommendations = strategies
      .filter((strategy) => (strategy.performance?.totalTrades ?? 0) > 0 || strategy.livePositions.length > 0)
      .map((strategy) => {
        const returnPct = Number(strategy.performance?.returnPct ?? 0);
        const drawdownPct = Number(strategy.performance?.drawdownPct ?? 0);
        const weight = Number(strategy.allocation?.weight ?? 0);
        const livePnl = strategy.livePositions.reduce((sum, item) => sum + Number(item.unrealizedPnl) + Number(item.realizedPnl ?? 0), 0);
        const liveSignal = livePnl > 0 ? 0.02 : livePnl < 0 ? -0.02 : 0;
        const regimeSignal = marketRegime === 'TRENDING' ? 0.03 : marketRegime === 'HIGH_VOLATILITY' ? -0.04 : 0.01;
        const delta = Math.max(-0.12, Math.min(0.12, returnPct * 0.08 - drawdownPct * 0.2 + liveSignal + regimeSignal));
        const recommendedWeight = Math.max(0.05, Math.min(0.4, weight + delta));
        const isAlreadyApplied = Math.abs(delta) < 0.005 || Math.abs(weight - recommendedWeight) < 0.005;
        return buildQuantRecommendation({
          title: `Adjust ${strategy.name} allocation to ${Math.round(recommendedWeight * 100)}%`,
          moduleSource: 'PORTFOLIO_INTELLIGENCE',
          problemStatement: `Strategy ${strategy.name} should be rebalanced based on live exchange positions and the current ${marketRegime.toLowerCase()} regime.`,
          evidenceText: `Current weight ${Math.round(weight * 100)}%, live pnl ${(livePnl).toFixed(2)}, return ${(returnPct * 100).toFixed(2)}%, drawdown ${(drawdownPct * 100).toFixed(2)}%.`,
          historicalResult: { returnPct, drawdownPct, recommendedWeight, marketRegime, livePnl, validationRunId: validation?.id ?? null, walkForwardStable: validation?.walkForwardStable ?? false, outOfSampleSharpe: validation?.outOfSampleSharpe ?? null },
          expectedBenefit: 'Improves portfolio risk-adjusted returns by reweighting to live performance.',
          estimatedRisk: 'Medium if market regime changes abruptly.',
          priority: drawdownPct > 0.05 || marketRegime === 'HIGH_VOLATILITY' ? 'HIGH' : 'MEDIUM',
          implementationCost: 'LOW',
          rollbackPlan: 'Revert the allocation weight using the portfolio rebalance endpoint.',
          status: isAlreadyApplied ? 'APPROVED' : 'PENDING_APPROVAL',
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
        status: item.status ?? 'PENDING_APPROVAL',
      })),
    });

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
    const validation = await this.prisma.researchValidationRun.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if ((strategy.performance?.totalTrades ?? 0) < 5 || strategy.closedTrades.length < 5) {
      throw new BadRequestException('VALIDATION_REQUIRED: strategy needs at least 5 attributed verified closed trades');
    }
    if (!validation?.walkForwardStable || !(validation.outOfSampleSharpe > 0)) {
      throw new BadRequestException('VALIDATION_REQUIRED: passing walk-forward and out-of-sample validation is required');
    }

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
        const rec = await quantRecommendationModel.findFirst({ where: { id, ...(userId ? { userId } : { userId: null }) } });
        if (rec) {
          if (action === 'APPROVE') {
            const evidence = jsonObject(rec.historicalResult);
            const validationId = typeof evidence.validationRunId === 'string' ? evidence.validationRunId : undefined;
            const validation = validationId
              ? await this.prisma.researchValidationRun.findFirst({ where: { id: validationId, userId } })
              : null;
            if (!validation?.walkForwardStable || !(validation.outOfSampleSharpe > 0)) {
              throw new BadRequestException('VALIDATION_REQUIRED: recommendation has no passing walk-forward/out-of-sample evidence');
            }
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
          }
          const updated = await quantRecommendationModel.update({
            where: { id: rec.id },
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
      } catch (error) {
        this.logger.warn({ event: 'quant_recommendation_review_failed', id, error: error instanceof Error ? error.message : String(error) });
        if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
      }
    }
    throw new NotFoundException('Evidence-backed recommendation not found');
  }

  async runSimulation(userId: string, request: SimulationRequest & { symbol?: string; provider?: ExchangeProvider; interval?: ExchangeInterval; lookbackCandles?: number }) {
    const symbol = request.symbol ?? 'BTC-USDT';
    const provider = request.provider ?? ExchangeProvider.OKX_FUTURES;
    const interval = request.interval ?? ExchangeInterval.FIFTEEN_MINUTES;
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
