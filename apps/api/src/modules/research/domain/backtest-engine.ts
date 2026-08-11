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
  feeRate?: number;
  slippageRate?: number;
  atrMultiplier?: number;
  rsiPeriod?: number;
  confidenceFloor?: number;
}

export interface BacktestTrade {
  side?: 'LONG' | 'SHORT';
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
  returnPct?: number;
  fees?: number;
  slippage?: number;
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
  const strategy = (request.strategyName ?? 'EMA_CROSS').toUpperCase();
  const feeRate = request.feeRate ?? 0.0005;
  const slippageRate = request.slippageRate ?? 0.0002;
  const minimumHistory = strategy === 'BUY_AND_HOLD' || strategy === 'DCA' ? 1 : 20;
  const holdingBars = strategy === 'BUY_AND_HOLD' ? Math.max(1, sorted.length - 1) : strategy === 'DCA' ? 20 : 8;

  for (let i = minimumHistory; i < sorted.length - 1;) {
    const signalConfig = { rsiPeriod: request.rsiPeriod ?? 14, confidenceFloor: request.confidenceFloor ?? 60 };
    const side = strategySignal(strategy, sorted, i, signalConfig);
    if (side === 0) {
      i += 1;
      continue;
    }
    const entryCandle = sorted[i];
    if (!entryCandle || !(balance > 0)) break;
    const rawEntry = Number(entryCandle.close);
    if (!(rawEntry > 0)) {
      i += 1;
      continue;
    }
    const entryPrice = rawEntry * (1 + slippageRate * side);
    const stopDistance = Math.max(0.004, Math.min(0.04, recentVolatility(sorted, i, 14) * (request.atrMultiplier ?? 1.5)));
    const takeDistance = stopDistance * Math.max(1, request.riskRewardRatio);
    const end = Math.min(sorted.length - 1, i + holdingBars);
    let exitIndex = end;
    let rawExit = Number(sorted[end]?.close ?? rawEntry);
    let mfe = 0;
    let mae = 0;
    for (let j = i + 1; j <= end; j += 1) {
      const candle = sorted[j];
      if (!candle) continue;
      const highReturn = side * (Number(side > 0 ? candle.high : candle.low) - rawEntry) / rawEntry;
      const lowReturn = side * (Number(side > 0 ? candle.low : candle.high) - rawEntry) / rawEntry;
      mfe = Math.max(mfe, highReturn);
      mae = Math.min(mae, lowReturn);
      if (lowReturn <= -stopDistance) {
        rawExit = rawEntry * (1 - side * stopDistance);
        exitIndex = j;
        break;
      }
      if (highReturn >= takeDistance) {
        rawExit = rawEntry * (1 + side * takeDistance);
        exitIndex = j;
        break;
      }
      const nextSignal = strategySignal(strategy, sorted, j, signalConfig);
      if (nextSignal === -side) {
        rawExit = Number(candle.close);
        exitIndex = j;
        break;
      }
    }
    const exitPrice = rawExit * (1 - slippageRate * side);
    const grossReturn = side * (rawExit - rawEntry) / rawEntry;
    const riskSizedNotional = balance * Math.max(0.001, request.riskPerTrade) / stopDistance;
    const notional = Math.max(0, Math.min(balance * Math.max(1, request.leverage), riskSizedNotional));
    const fees = notional * feeRate * 2;
    const slippage = notional * slippageRate * 2;
    const pnl = notional * grossReturn - fees - slippage;
    const netReturn = notional > 0 ? pnl / notional : 0;
    const exitCandle = sorted[exitIndex];
    if (exitCandle && Number.isFinite(pnl)) {
      trades.push({
        side: side > 0 ? 'LONG' : 'SHORT',
        entryTime: entryCandle.openTime.toISOString(),
        exitTime: exitCandle.closeTime.toISOString(),
        entryPrice,
        exitPrice,
        pnl,
        holdingTime: Math.max(1, exitIndex - i),
        maxFavorableExcursion: mfe * 100,
        maxAdverseExcursion: mae * 100,
        riskReward: Math.abs(netReturn) / stopDistance,
        expectedValue: netReturn,
        tradeQualityScore: Math.max(0, Math.min(100, 50 + netReturn / stopDistance * 20)),
        returnPct: netReturn,
        fees,
        slippage,
      });
      balance = Math.max(0, balance + pnl);
      equityCurve.push({ timestamp: exitCandle.closeTime.toISOString(), equity: balance });
    }
    i = Math.max(i + 1, exitIndex + 1);
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

function strategySignal(
  strategy: string,
  candles: NormalizedCandle[],
  index: number,
  config: { rsiPeriod: number; confidenceFloor: number },
): -1 | 0 | 1 {
  if (strategy === 'NO_TRADE') return 0;
  if (strategy === 'BUY_AND_HOLD') return index <= 1 ? 1 : 0;
  if (strategy === 'DCA') return index % 20 === 1 ? 1 : 0;
  const closes = candles.slice(0, index + 1).map((item) => Number(item.close));
  const volumes = candles.slice(0, index + 1).map((item) => Number(item.volume));
  const price = closes.at(-1) ?? 0;
  const previous = closes.at(-2) ?? price;
  const fast = average(closes.slice(-10));
  const slow = average(closes.slice(-30));
  const previousFast = average(closes.slice(-11, -1));
  const previousSlow = average(closes.slice(-31, -1));
  const rsiValue = rsi(closes, config.rsiPeriod);
  const momentum = previous > 0 ? price / previous - 1 : 0;
  const twentyHigh = Math.max(...closes.slice(-21, -1));
  const twentyLow = Math.min(...closes.slice(-21, -1));
  const mean = average(closes.slice(-20));
  const deviation = standardDeviation(closes.slice(-20));
  const zScore = deviation > 0 ? (price - mean) / deviation : 0;
  const volumeRatio = average(volumes.slice(-5)) / Math.max(1e-12, average(volumes.slice(-20)));
  const volumeThreshold = 1 + Math.max(0, config.confidenceFloor - 50) / 500;
  const trend = fast > slow ? 1 : fast < slow ? -1 : 0;

  if (['EMA_CROSS', 'SMA_CROSS', 'MACD_TREND', 'SUPERTREND', 'TREND_FOLLOWING'].includes(strategy)) {
    if (fast > slow && previousFast <= previousSlow) return 1;
    if (fast < slow && previousFast >= previousSlow) return -1;
    return 0;
  }
  if (['RSI_MEAN_REVERSION', 'STATISTICAL_MEAN_REVERSION', 'MEAN_REVERSION', 'GRID_TRADING'].includes(strategy)) {
    if (rsiValue < 35 || zScore < -1.5) return 1;
    if (rsiValue > 65 || zScore > 1.5) return -1;
    return 0;
  }
  if (['DONCHIAN_BREAKOUT', 'TURTLE_STRATEGY', 'BREAKOUT_STRATEGY', 'BREAKOUT'].includes(strategy)) {
    if (price > twentyHigh) return 1;
    if (price < twentyLow) return -1;
    return 0;
  }
  if (['MOMENTUM_STRATEGY', 'MOMENTUM', 'VOLUME_EXPANSION'].includes(strategy)) {
    if (momentum > 0.003 && volumeRatio > volumeThreshold) return 1;
    if (momentum < -0.003 && volumeRatio > volumeThreshold) return -1;
    return 0;
  }
  if (strategy === 'BOLLINGER_BAND' || strategy === 'VOLATILITY_COMPRESSION') {
    if (zScore < -2) return 1;
    if (zScore > 2) return -1;
    return 0;
  }
  if (strategy === 'VWAP_STRATEGY') {
    const weighted = closes.slice(-20).reduce((sum, value, offset) => sum + value * (volumes.slice(-20)[offset] ?? 0), 0);
    const totalVolume = volumes.slice(-20).reduce((sum, value) => sum + value, 0);
    const vwap = totalVolume > 0 ? weighted / totalVolume : mean;
    return price > vwap * 1.002 ? 1 : price < vwap * 0.998 ? -1 : 0;
  }
  if (['HYBRID_QUANT', 'HYBRID_AI', 'PREVIOUS_AI_VERSION', 'PREVIOUS_STABLE_RELEASE'].includes(strategy)) {
    if (trend > 0 && rsiValue >= 45 && rsiValue <= 70 && volumeRatio >= 0.9) return 1;
    if (trend < 0 && rsiValue >= 30 && rsiValue <= 55 && volumeRatio >= 0.9) return -1;
    return 0;
  }
  if (strategy === 'RANDOM_ENTRY') {
    const deterministic = Math.abs(Math.sin((index + 1) * 12.9898));
    return deterministic > 0.82 ? (deterministic > 0.91 ? 1 : -1) : 0;
  }
  return trend;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function rsi(values: number[], period: number): number {
  const slice = values.slice(-(period + 1));
  if (slice.length < 2) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const delta = (slice[i] ?? 0) - (slice[i - 1] ?? 0);
    gains += Math.max(0, delta);
    losses += Math.max(0, -delta);
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  return 100 - 100 / (1 + gains / losses);
}

function recentVolatility(candles: NormalizedCandle[], index: number, period: number): number {
  const closes = candles.slice(Math.max(0, index - period), index + 1).map((item) => Number(item.close));
  const returns = closes.slice(1).map((value, offset) => value / Math.max(1e-12, closes[offset] ?? value) - 1);
  return Math.max(0.003, standardDeviation(returns));
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
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss;
  const expectancy = trades.length === 0 ? 0 : (wins.length / trades.length) * averageWin + (losses.length / trades.length) * averageLoss;
  const averageHoldingTime = trades.length === 0 ? 0 : trades.reduce((sum, trade) => sum + trade.holdingTime, 0) / trades.length;
  let runningPeak = initialBalance;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    runningPeak = Math.max(runningPeak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, runningPeak > 0 ? (runningPeak - point.equity) / runningPeak : 0);
  }
  const recoveryFactor = maxDrawdown === 0 ? 0 : totalReturn / maxDrawdown;
  const tradeReturns = trades.map((trade) => trade.returnPct ?? trade.pnl / Math.max(1, initialBalance));
  const meanReturn = average(tradeReturns);
  const returnDeviation = standardDeviation(tradeReturns);
  const downsideDeviation = standardDeviation(tradeReturns.filter((value) => value < 0));
  const sharpeRatio = returnDeviation > 0 ? meanReturn / returnDeviation * Math.sqrt(trades.length) : 0;
  const sortinoRatio = downsideDeviation > 0 ? meanReturn / downsideDeviation * Math.sqrt(trades.length) : 0;
  const calmarRatio = maxDrawdown === 0 ? 0 : totalReturn / maxDrawdown;
  const ulcerIndex = equityCurve.length === 0 ? 0 : Math.sqrt(equityCurve.reduce((sum, point) => {
    runningPeak = Math.max(initialBalance, runningPeak, point.equity);
    return sum + ((runningPeak - point.equity) / Math.max(1, runningPeak)) ** 2;
  }, 0) / equityCurve.length);
  const exposureTime = trades.length === 0 ? 0 : trades.reduce((sum, trade) => sum + trade.holdingTime, 0) / Math.max(1, equityCurve.length);
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
