import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import type { NormalizedCandle } from '../../../market-data/domain/market-data.types';

export interface BacktestRequest {
  candles: NormalizedCandle[];
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  initialBalance: number;
  leverage: number;
  riskPerTrade: number;
  riskRewardRatio: number;
  strategyName?: string;
}

export interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  holdingTime: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  riskReward: number;
  expectedValue: number;
  tradeQualityScore: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  monthlyReturn: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  averageHoldingTime: number;
  maxDrawdown: number;
  recoveryFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  ulcerIndex: number;
  exposureTime: number;
  tradeFrequency: number;
  averageDailyTrades: number;
}

export interface BacktestSummary {
  strategyName: string;
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  equityCurve: Array<{ timestamp: string; equity: number }>;
}

export interface MonteCarloSummary {
  probabilityOfProfit: number;
  expectedDrawdown: number;
  worstDrawdown: number;
  confidenceInterval95: [number, number];
  probabilityOfRuin: number;
  capitalSurvivalRate: number;
}

export interface WalkForwardWindowSummary {
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  return: number;
  drawdown: number;
}

export interface WalkForwardSummary {
  windows: WalkForwardWindowSummary[];
  stable: boolean;
  averageReturn: number;
}

export function runHistoricalBacktest(request: BacktestRequest): BacktestSummary {
  const sorted = [...request.candles].sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ timestamp: string; equity: number }> = [];

  let balance = request.initialBalance;
  let peak = balance;
  let maxDrawdown = 0;
  let runningEquity = balance;

  for (let i = 1; i < sorted.length; i += 1) {
    const candle = sorted[i];
    if (!candle) continue;
    const prev = sorted[i - 1];
    if (!prev) continue;
    const entryPrice = Number(prev.close);
    const exitPrice = Number(candle.close);
    const pnl = (exitPrice - entryPrice) / entryPrice * 100 * request.leverage;
    const trade = {
      entryTime: prev.openTime.toISOString(),
      exitTime: candle.openTime.toISOString(),
      entryPrice,
      exitPrice,
      pnl: pnl * request.initialBalance / 100,
      holdingTime: 1,
      maxFavorableExcursion: Math.max(0, pnl),
      maxAdverseExcursion: Math.min(0, pnl),
      riskReward: Math.max(0.01, pnl / Math.max(1, request.riskPerTrade * 100)),
      expectedValue: pnl / Math.max(1, request.riskRewardRatio),
      tradeQualityScore: Math.max(0, Math.min(100, 50 + pnl / 100)),
    };

    if (!Number.isFinite(trade.pnl) || trade.pnl === 0) continue;
    trades.push(trade);
    balance += trade.pnl;
    runningEquity = balance;
    if (runningEquity > peak) peak = runningEquity;
    maxDrawdown = Math.max(maxDrawdown, (peak - runningEquity) / peak);
    equityCurve.push({ timestamp: candle.closeTime.toISOString(), equity: runningEquity });
  }

  const metrics = buildMetrics(trades, balance, equityCurve, request.initialBalance);
  return {
    strategyName: request.strategyName ?? 'baseline',
    provider: request.provider,
    symbol: request.symbol,
    interval: request.interval,
    trades,
    metrics,
    equityCurve,
  };
}

export function runMonteCarloSimulation({
  trades,
  initialBalance,
  simulations = 1000,
  seed = 7,
}: {
  trades: BacktestTrade[];
  initialBalance: number;
  simulations?: number;
  seed?: number;
}): MonteCarloSummary {
  if (trades.length === 0) {
    return {
      probabilityOfProfit: 0,
      expectedDrawdown: 0,
      worstDrawdown: 0,
      confidenceInterval95: [0, 0],
      probabilityOfRuin: 1,
      capitalSurvivalRate: 0,
    };
  }

  let profitCount = 0;
  let worstDrawdown = 0;
  const drawdowns: number[] = [];
  for (let sim = 0; sim < simulations; sim += 1) {
    let equity = initialBalance;
    let peak = equity;
    for (let i = 0; i < trades.length; i += 1) {
      const trade = trades[(sim + i + seed) % trades.length];
      if (!trade) continue;
      equity += trade.pnl;
      peak = Math.max(peak, equity);
      const drawdown = peak === 0 ? 0 : (peak - equity) / peak;
      worstDrawdown = Math.max(worstDrawdown, drawdown);
    }
    if (equity > initialBalance) profitCount += 1;
    drawdowns.push(worstDrawdown);
  }

  const avgDrawdown = drawdowns.reduce((sum, value) => sum + value, 0) / drawdowns.length;
  return {
    probabilityOfProfit: profitCount / simulations,
    expectedDrawdown: avgDrawdown,
    worstDrawdown,
    confidenceInterval95: [Math.max(0, avgDrawdown - 0.02), Math.min(1, avgDrawdown + 0.02)],
    probabilityOfRuin: worstDrawdown > 0.5 ? 1 : 0.1,
    capitalSurvivalRate: 1 - (worstDrawdown > 0.5 ? 1 : 0.1),
  };
}

export function runWalkForwardValidation({
  candles,
  trainWindow,
  validationWindow,
  initialBalance,
}: {
  candles: NormalizedCandle[];
  trainWindow: number;
  validationWindow: number;
  initialBalance: number;
}): WalkForwardSummary {
  const sorted = [...candles].sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  const windows: WalkForwardWindowSummary[] = [];

  for (let start = 0; start + trainWindow + validationWindow <= sorted.length; start += validationWindow) {
    const trainSlice = sorted.slice(start, start + trainWindow);
    const validationSlice = sorted.slice(start + trainWindow, start + trainWindow + validationWindow);
    if (trainSlice.length === 0 || validationSlice.length === 0) continue;
    const validationBacktest = runHistoricalBacktest({
      candles: validationSlice,
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.FIVE_MINUTES,
      initialBalance,
      leverage: 2,
      riskPerTrade: 0.01,
      riskRewardRatio: 2,
    });
    windows.push({
      trainStart: trainSlice[0]?.openTime.toISOString() ?? '',
      trainEnd: trainSlice[trainSlice.length - 1]?.openTime.toISOString() ?? '',
      validationStart: validationSlice[0]?.openTime.toISOString() ?? '',
      validationEnd: validationSlice[validationSlice.length - 1]?.openTime.toISOString() ?? '',
      return: validationBacktest.metrics.totalReturn,
      drawdown: validationBacktest.metrics.maxDrawdown,
    });
  }

  return {
    windows,
    stable: windows.every((window) => window.return >= 0) && windows.length >= 2,
    averageReturn: windows.reduce((sum, window) => sum + window.return, 0) / Math.max(windows.length, 1),
  };
}

function buildMetrics(trades: BacktestTrade[], balance: number, equityCurve: Array<{ timestamp: string; equity: number }>, initialBalance: number): BacktestMetrics {
  const wins = trades.filter((trade) => trade.pnl > 0);
  const losses = trades.filter((trade) => trade.pnl < 0);
  const totalReturn = initialBalance === 0 ? 0 : (balance - initialBalance) / initialBalance;
  const averageWin = wins.length === 0 ? 0 : wins.reduce((sum, trade) => sum + trade.pnl, 0) / wins.length;
  const averageLoss = losses.length === 0 ? 0 : losses.reduce((sum, trade) => sum + trade.pnl, 0) / losses.length;
  const profitFactor = averageLoss === 0 ? Number.POSITIVE_INFINITY : Math.abs(averageWin / averageLoss);
  const expectancy = trades.length === 0 ? 0 : (wins.length / trades.length) * averageWin + (losses.length / trades.length) * averageLoss;
  const averageHoldingTime = trades.length === 0 ? 0 : trades.reduce((sum, trade) => sum + trade.holdingTime, 0) / trades.length;
  const peak = equityCurve.reduce((max, point) => Math.max(max, point.equity), initialBalance);
  const trough = equityCurve.length === 0 ? initialBalance : Math.min(...equityCurve.map((point) => point.equity));
  const maxDrawdown = peak === 0 ? 0 : (peak - trough) / peak;
  const recoveryFactor = maxDrawdown === 0 ? 0 : totalReturn / maxDrawdown;
  const sharpeRatio = trades.length === 0 ? 0 : (trades.reduce((sum, trade) => sum + trade.pnl, 0) / trades.length) / Math.max(1, Math.sqrt(trades.length));
  const sortinoRatio = trades.length === 0 ? 0 : (trades.reduce((sum, trade) => sum + trade.pnl, 0) / trades.length) / Math.max(1, Math.sqrt(Math.max(1, losses.length)));
  const calmarRatio = maxDrawdown === 0 ? 0 : totalReturn / maxDrawdown;
  const ulcerIndex = equityCurve.length === 0 ? 0 : equityCurve.reduce((sum, point) => sum + Math.pow((peak - point.equity) / peak, 2), 0) / equityCurve.length;
  const exposureTime = equityCurve.length === 0 ? 0 : equityCurve.length / Math.max(1, trades.length);
  const tradeFrequency = trades.length === 0 ? 0 : trades.length / Math.max(1, equityCurve.length);
  const averageDailyTrades = tradeFrequency;

  return {
    totalReturn,
    annualizedReturn: totalReturn * 12,
    monthlyReturn: totalReturn,
    winRate: trades.length === 0 ? 0 : wins.length / trades.length,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
    expectancy,
    averageWin,
    averageLoss,
    averageHoldingTime,
    maxDrawdown,
    recoveryFactor,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    ulcerIndex,
    exposureTime,
    tradeFrequency,
    averageDailyTrades,
  };
}
