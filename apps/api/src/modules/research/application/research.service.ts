import { Injectable, Logger } from '@nestjs/common';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { MarketDataService } from '../../../market-data/application/market-data.service';
import {
  runHistoricalBacktest,
  runMonteCarloSimulation,
  runWalkForwardValidation,
} from '../domain/backtest-engine';

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(private readonly marketData: MarketDataService) {}

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

  async runValidation(input: {
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    lookbackCandles: number;
    initialBalance: number;
    trainWindow: number;
    validationWindow: number;
  }) {
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
    });

    const monteCarlo = runMonteCarloSimulation({
      trades: backtest.trades,
      initialBalance: input.initialBalance,
      simulations: 100,
    });

    const walkForward = runWalkForwardValidation({
      candles,
      trainWindow: input.trainWindow,
      validationWindow: input.validationWindow,
      initialBalance: input.initialBalance,
    });

    return {
      backtest,
      monteCarlo,
      walkForward,
    };
  }
}
