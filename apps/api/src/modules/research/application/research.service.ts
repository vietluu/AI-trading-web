import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

function toInputJson(val: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(val)) as Prisma.InputJsonValue;
}

export function validationBacktestStrategy(strategyKey: string): string {
  const strategies: Record<string, string> = {
    'ai-core': 'HYBRID_QUANT',
    trend: 'TREND_FOLLOWING',
    'mean-reversion': 'RSI_MEAN_REVERSION',
    breakout: 'BREAKOUT',
  };
  const strategyName = strategies[strategyKey];
  if (!strategyName) {
    throw new BadRequestException(
      `DATA_UNAVAILABLE: ${strategyKey} requires strategy-specific event history`,
    );
  }
  return strategyName;
}

type ResearchPersistenceClient = {
  researchValidationRun: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  benchmarkSuiteRun: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  sensitivityHeatmap: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { MarketDataService } from '../../../market-data/application/market-data.service';
import { runHistoricalBacktest } from '../domain/backtest-engine';
import {
  buildBenchmarkLeaderboard,
  detectMarketRegime,
  generateOptimizationRecommendations,
  recommendStrategy,
  runBenchmarkSuite,
} from '../domain/benchmark-engine';
import {
  runBootstrapEngine,
  runConfidenceCalibrationEngine,
  runCrossSymbolRobustnessEngine,
  runMonteCarloEngine,
  runOutOfSampleEngine,
  runProbabilityOfRuinEngine,
  runRegimeStabilityAnalyzer,
  runSensitivityEngine,
  runWalkForwardEngine,
} from '../domain/validation-engines';

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    private readonly marketData: MarketDataService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService & ResearchPersistenceClient,
  ) {}

  async runBacktest(input: {
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    lookbackCandles: number;
    initialBalance: number;
    leverage: number;
    riskPerTrade: number;
    riskRewardRatio: number;
    strategyName?: string;
  }) {
    const candles = await this.marketData.getHistoricalCandles({
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      limit: input.lookbackCandles,
    });

    const summary = runHistoricalBacktest({
      candles,
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      initialBalance: input.initialBalance,
      leverage: input.leverage,
      riskPerTrade: input.riskPerTrade,
      riskRewardRatio: input.riskRewardRatio,
      strategyName: input.strategyName,
    });

    this.logger.log({
      event: 'research_backtest_completed',
      symbol: input.symbol,
      trades: summary.trades.length,
      totalReturn: summary.metrics.totalReturn,
    });

    return summary;
  }

  async runFullQuantValidation(input: {
    userId?: string;
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    lookbackCandles: number;
    initialBalance: number;
    trainWindow?: number;
    validationWindow?: number;
    strategyKey?: string;
  }) {
    const strategyKey = input.strategyKey ?? 'ai-core';
    const strategyName = validationBacktestStrategy(strategyKey);
    const candles = await this.marketData.getHistoricalCandles({
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      limit: input.lookbackCandles,
    });

    const backtest = runHistoricalBacktest({
      candles,
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      initialBalance: input.initialBalance,
      leverage: 2,
      riskPerTrade: 0.01,
      riskRewardRatio: 2,
      strategyName,
    });
    if (backtest.trades.length < 5) {
      throw new BadRequestException('DATA_UNAVAILABLE: fewer than 5 real-candle strategy trades were generated');
    }

    const walkForward = runWalkForwardEngine({
      candles,
      trainWindow: input.trainWindow ?? 100,
      validationWindow: input.validationWindow ?? 30,
      initialBalance: input.initialBalance,
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      strategyName,
    });

    const monteCarlo = runMonteCarloEngine({
      trades: backtest.trades,
      initialBalance: input.initialBalance,
      simulations: 10000,
    });

    const bootstrap = runBootstrapEngine({
      trades: backtest.trades,
      resamples: 2000,
    });

    const calibrationRows = input.userId && this.prisma
      ? await this.prisma.performanceRecord.findMany({
          where: { userId: input.userId, decision: { in: ['LONG', 'SHORT'] } },
          select: { confidence: true, outcome: true },
          orderBy: { evaluatedAt: 'desc' },
          take: 1000,
        })
      : [];
    const calibration = runConfidenceCalibrationEngine(calibrationRows.map((row) => ({
      confidence: row.confidence,
      isWin: row.outcome === 'CORRECT',
    })));

    const regimeStability = runRegimeStabilityAnalyzer(candles);

    const ledgerTrades = input.userId && this.prisma
      ? await this.prisma.closedTrade.findMany({ where: { userId: input.userId } })
      : [];
    const groupedLedger = new Map<string, typeof ledgerTrades>();
    for (const trade of ledgerTrades) groupedLedger.set(trade.symbol, [...(groupedLedger.get(trade.symbol) ?? []), trade]);
    const robustness = runCrossSymbolRobustnessEngine([...groupedLedger.entries()].map(([symbol, rows]) => {
      const returns = rows.flatMap((row) => row.returnPct === null ? [] : [row.returnPct]);
      const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
      const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0;
      let equity = 1;
      let peak = 1;
      let maxDrawdown = 0;
      for (const value of returns) {
        equity *= 1 + value;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
      }
      return {
        symbol,
        winRate: rows.length ? rows.filter((row) => Number(row.netPnl) > 0).length / rows.length * 100 : 0,
        totalReturn: (equity - 1) * 100,
        sharpeRatio: variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(returns.length) : 0,
        maxDrawdown: maxDrawdown * 100,
      };
    }));

    const oos = runOutOfSampleEngine(candles, {
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      strategyName,
    });

    const ruin = runProbabilityOfRuinEngine({
      winRate: backtest.metrics.winRate,
      riskRewardRatio: 2.0,
      riskPerTradeFraction: 0.02,
      capital: input.initialBalance,
    });

    const result = {
      backtestSummary: backtest.metrics,
      walkForward,
      monteCarlo,
      bootstrap,
      calibration,
      regimeStability,
      crossSymbolRobustness: robustness,
      outOfSample: oos,
      probabilityOfRuin: ruin,
    };

    let validationRunId: string | null = null;
    if (this.prisma) {
      try {
        const persisted = await this.prisma.researchValidationRun.create({
          data: {
            userId: input.userId,
            strategyKey,
            symbol: input.symbol,
            provider: input.provider,
            interval: input.interval,
            lookbackCandles: input.lookbackCandles,
            monteCarloSimulations: monteCarlo.simulationsCount,
            probabilityOfProfit: monteCarlo.probabilityOfProfit,
            probabilityOfRuin: ruin.probabilityOfRuinPct,
            expectedDrawdown: monteCarlo.expectedDrawdown,
            worstDrawdown: monteCarlo.worstDrawdown,
            walkForwardStable: walkForward.stable,
            walkForwardAvgReturn: walkForward.averageReturn,
            bootstrapSharpe95: bootstrap.sharpeRatioCI95,
            confidenceBrierScore: calibration.brierScore,
            regimeStabilityScore: regimeStability.overallRegimeStabilityScore,
            crossSymbolRank: 1,
            outOfSampleSharpe: oos.outOfSampleSharpe,
            metricsJson: toInputJson(result),
          },
        });
        validationRunId = (persisted as { id?: string }).id ?? null;
      } catch (err) {
        this.logger.warn(`Failed to persist ResearchValidationRun to DB: ${(err as Error).message}`);
      }
    }

    this.logger.log({
      event: 'full_quant_validation_completed',
      symbol: input.symbol,
      mcProfitPct: monteCarlo.probabilityOfProfit,
      wfStable: walkForward.stable,
      ruinPct: ruin.probabilityOfRuinPct,
    });

    return { ...result, validationRunId, provenance: { source: 'REAL_EXCHANGE_CANDLES_AND_VERIFIED_RUNTIME_RECORDS', provider: input.provider, symbol: input.symbol, interval: input.interval, lookbackCandles: candles.length } };
  }

  async runSensitivityAnalysis(input: {
    userId?: string;
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    lookbackCandles: number;
    parameterName: 'confidenceFloor' | 'riskRewardRatio' | 'atrMultiplier' | 'rsiPeriod';
    gridValues?: number[];
  }) {
    const candles = await this.marketData.getHistoricalCandles({
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      limit: input.lookbackCandles,
    });

    const sensitivity = runSensitivityEngine({
      candles,
      parameterName: input.parameterName,
      gridValues: input.gridValues,
    });

    if (this.prisma) {
      try {
        await this.prisma.sensitivityHeatmap.create({
          data: {
            userId: input.userId,
            symbol: input.symbol,
            parameterName: input.parameterName,
            gridValues: toInputJson(sensitivity.heatmap.map((h) => h.paramValue)),
            metricsSurface: toInputJson(sensitivity.heatmap),
            optimalValue: sensitivity.optimalValue,
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to persist SensitivityHeatmap to DB: ${(err as Error).message}`);
      }
    }

    return sensitivity;
  }

  async runBenchmarkAnalysis(input: {
    userId?: string;
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    lookbackCandles: number;
    initialBalance: number;
    leverage: number;
    riskPerTrade: number;
    riskRewardRatio: number;
  }) {
    const candles = await this.marketData.getHistoricalCandles({
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      limit: input.lookbackCandles,
    });

    const suite = runBenchmarkSuite({
      candles,
      provider: input.provider,
      symbol: input.symbol,
      interval: input.interval,
      initialBalance: input.initialBalance,
      leverage: input.leverage,
      riskPerTrade: input.riskPerTrade,
      riskRewardRatio: input.riskRewardRatio,
    });

    const regime = detectMarketRegime(candles);
    const strategy = recommendStrategy({
      regime,
      symbol: input.symbol,
      volatility: 0.02,
      liquidity: 0.7,
    });
    const recommendations = generateOptimizationRecommendations(suite.benchmarks, regime);
    const leaderboard = buildBenchmarkLeaderboard(suite.benchmarks);

    if (this.prisma) {
      try {
        await this.prisma.benchmarkSuiteRun.create({
          data: {
            userId: input.userId,
            symbol: input.symbol,
            provider: input.provider,
            interval: input.interval,
            strategyCount: suite.benchmarks.length,
            topStrategyName: leaderboard[0]?.strategyName ?? 'BUY_AND_HOLD',
            leaderboardJson: toInputJson(leaderboard),
            recommendations: toInputJson(recommendations),
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to persist BenchmarkSuiteRun to DB: ${(err as Error).message}`);
      }
    }

    return {
      suite,
      leaderboard,
      regime,
      recommendedStrategy: strategy,
      recommendations,
    };
  }
}

