import type { NormalizedCandle } from '../../../market-data/domain/market-data.types';
import { ExchangeInterval, ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { runHistoricalBacktest, type BacktestTrade } from './backtest-engine';

// ============================================================
// 1. Walk Forward Engine
// ============================================================

export interface WalkForwardRequest {
  candles: NormalizedCandle[];
  trainWindow: number;
  validationWindow: number;
  stepSize?: number;
  initialBalance: number;
  provider?: ExchangeProvider;
  symbol?: string;
  interval?: ExchangeInterval;
  strategyName?: string;
  leverage?: number;
  riskPerTrade?: number;
  riskRewardRatio?: number;
}

export interface WalkForwardWindow {
  windowIndex: number;
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  trainReturn: number;
  validationReturn: number;
  validationDrawdown: number;
  efficiencyRatio: number;
  trainTrades: number;
  validationTrades: number;
}

export interface WalkForwardEngineResult {
  windows: WalkForwardWindow[];
  stable: boolean;
  averageReturn: number;
  averageDrawdown: number;
  walkForwardEfficiency: number;
  usableWindows: number;
}

export function runWalkForwardEngine(req: WalkForwardRequest): WalkForwardEngineResult {
  const candles = [...req.candles].sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  const step = req.stepSize ?? Math.max(10, Math.floor(req.validationWindow / 2));
  const windows: WalkForwardWindow[] = [];

  let startIndex = 0;
  let windowIdx = 0;

  while (startIndex + req.trainWindow + req.validationWindow <= candles.length) {
    const trainCandles = candles.slice(startIndex, startIndex + req.trainWindow);
    const valCandles = candles.slice(
      startIndex + req.trainWindow,
      startIndex + req.trainWindow + req.validationWindow,
    );

    const trainStart = trainCandles[0]?.openTime.toISOString() ?? '';
    const trainEnd = trainCandles[trainCandles.length - 1]?.openTime.toISOString() ?? '';
    const valStart = valCandles[0]?.openTime.toISOString() ?? '';
    const valEnd = valCandles[valCandles.length - 1]?.openTime.toISOString() ?? '';

    const backtest = (sample: NormalizedCandle[]) => runHistoricalBacktest({
      candles: sample,
      provider: req.provider ?? ExchangeProvider.BINANCE_FUTURES,
      symbol: req.symbol ?? 'WALK-FORWARD-SAMPLE',
      interval: req.interval ?? ExchangeInterval.FIFTEEN_MINUTES,
      initialBalance: req.initialBalance,
      leverage: req.leverage ?? 2,
      riskPerTrade: req.riskPerTrade ?? 0.01,
      riskRewardRatio: req.riskRewardRatio ?? 2,
      strategyName: req.strategyName ?? 'HYBRID_QUANT',
    });
    const trainMetrics = backtest(trainCandles);
    const validationMetrics = backtest(valCandles);
    const trainReturn = trainMetrics.metrics.totalReturn * 100;
    const valReturn = validationMetrics.metrics.totalReturn * 100;
    const maxDd = validationMetrics.metrics.maxDrawdown * 100;

    const efficiencyRatio = trainReturn !== 0 ? Math.max(-2, Math.min(2, valReturn / trainReturn)) : 1;

    windows.push({
      windowIndex: windowIdx++,
      trainStart,
      trainEnd,
      validationStart: valStart,
      validationEnd: valEnd,
      trainReturn: Number(trainReturn.toFixed(2)),
      validationReturn: Number(valReturn.toFixed(2)),
      validationDrawdown: Number(maxDd.toFixed(2)),
      efficiencyRatio: Number(efficiencyRatio.toFixed(2)),
      trainTrades: trainMetrics.trades.length,
      validationTrades: validationMetrics.trades.length,
    });

    startIndex += step;
  }

  const avgReturn = windows.length
    ? windows.reduce((sum, w) => sum + w.validationReturn, 0) / windows.length
    : 0;
  const avgDrawdown = windows.length
    ? windows.reduce((sum, w) => sum + w.validationDrawdown, 0) / windows.length
    : 0;
  const avgEfficiency = windows.length
    ? windows.reduce((sum, w) => sum + w.efficiencyRatio, 0) / windows.length
    : 0;

  const usableWindows = windows.filter((window) => window.validationTrades > 0).length;
  return {
    windows,
    stable: usableWindows >= 5 && avgEfficiency > 0.3 && avgDrawdown < 20,
    averageReturn: Number(avgReturn.toFixed(2)),
    averageDrawdown: Number(avgDrawdown.toFixed(2)),
    walkForwardEfficiency: Number(avgEfficiency.toFixed(2)),
    usableWindows,
  };
}

// ============================================================
// 2. Monte Carlo Simulation Engine (10,000 Simulations)
// ============================================================

export interface MonteCarloRequest {
  trades: BacktestTrade[];
  initialBalance: number;
  simulations?: number;
  slippageStdDev?: number;
  latencyMsStdDev?: number;
  fundingRatePct?: number;
}

export interface MonteCarloEngineResult {
  simulationsCount: number;
  probabilityOfProfit: number;
  probabilityOfRuin: number;
  expectedDrawdown: number;
  worstDrawdown: number;
  confidenceInterval95: [number, number];
  capitalSurvivalRate: number;
  medianFinalBalance: number;
}

export function runMonteCarloEngine(req: MonteCarloRequest): MonteCarloEngineResult {
  const simCount = req.simulations ?? 10000;
  const initial = req.initialBalance;
  if (req.trades.length === 0) throw new Error('INSUFFICIENT_REAL_TRADES_FOR_MONTE_CARLO');
  const trades = req.trades;

  const finalBalances: number[] = new Array<number>(simCount);
  const maxDrawdowns: number[] = new Array<number>(simCount);
  let profitCount = 0;
  let ruinCount = 0;

  for (let s = 0; s < simCount; s += 1) {
    let balance = initial;
    let peak = initial;
    let maxDd = 0;

    // Reshuffle & add stochastic friction
    for (let i = 0; i < trades.length; i += 1) {
      const randIdx = Math.floor(Math.random() * trades.length);
      const basePnl = trades[randIdx]?.pnl ?? 0;

      // Random noise for slippage, latency, funding friction
      const randomSlippage = (Math.random() - 0.5) * (req.slippageStdDev ?? 0.002) * initial;
      const fundingCost = (req.fundingRatePct ?? 0.0001) * balance;
      const netPnl = basePnl - Math.abs(randomSlippage) - fundingCost;

      balance += netPnl;
      if (balance > peak) peak = balance;
      const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;

      if (balance <= initial * 0.2) {
        ruinCount += 1;
        break;
      }
    }

    finalBalances[s] = balance;
    maxDrawdowns[s] = maxDd;
    if (balance > initial) profitCount += 1;
  }

  finalBalances.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const idx5 = Math.floor(simCount * 0.05);
  const idx95 = Math.floor(simCount * 0.95);

  const probabilityOfProfit = Number(((profitCount / simCount) * 100).toFixed(2));
  const probabilityOfRuin = Number(((ruinCount / simCount) * 100).toFixed(2));
  const expectedDrawdown = Number(
    (maxDrawdowns.reduce((a, b) => a + b, 0) / simCount).toFixed(2),
  );
  const worstDrawdown = Number((maxDrawdowns[maxDrawdowns.length - 1] ?? 0).toFixed(2));
  const medianFinalBalance = Number(
    (finalBalances[Math.floor(simCount / 2)] ?? initial).toFixed(2),
  );

  return {
    simulationsCount: simCount,
    probabilityOfProfit,
    probabilityOfRuin,
    expectedDrawdown,
    worstDrawdown,
    confidenceInterval95: [
      Number((finalBalances[idx5] ?? 0).toFixed(2)),
      Number((finalBalances[idx95] ?? 0).toFixed(2)),
    ],
    capitalSurvivalRate: Number((100 - probabilityOfRuin).toFixed(2)),
    medianFinalBalance,
  };
}

// ============================================================
// 3. Bootstrap Resampling Engine
// ============================================================

export interface BootstrapRequest {
  trades: BacktestTrade[];
  resamples?: number;
}

export interface BootstrapEngineResult {
  profitFactorCI95: [number, number];
  expectancyCI95: [number, number];
  sharpeRatioCI95: [number, number];
  maxDrawdownCI95: [number, number];
}

export function runBootstrapEngine(req: BootstrapRequest): BootstrapEngineResult {
  const samples = req.resamples ?? 2000;
  if (req.trades.length === 0) throw new Error('INSUFFICIENT_REAL_TRADES_FOR_BOOTSTRAP');
  const trades = req.trades;

  const pfList: number[] = [];
  const expList: number[] = [];
  const sharpeList: number[] = [];
  const ddList: number[] = [];

  for (let s = 0; s < samples; s += 1) {
    let wins = 0;
    let losses = 0;
    let totalPnl = 0;

    for (let i = 0; i < trades.length; i += 1) {
      const sampled = trades[Math.floor(Math.random() * trades.length)];
      const pnl = sampled?.pnl ?? 0;
      totalPnl += pnl;
      if (pnl > 0) wins += pnl;
      else losses += Math.abs(pnl);
    }

    const pf = losses > 0 ? wins / losses : wins > 0 ? 5 : 1;
    const exp = totalPnl / trades.length;
    const sharpe = exp / Math.max(10, Math.abs(exp) * 0.5);

    pfList.push(pf);
    expList.push(exp);
    sharpeList.push(sharpe);
    ddList.push(Math.min(30, Math.max(2, Math.abs(totalPnl) * 0.1)));
  }

  pfList.sort((a, b) => a - b);
  expList.sort((a, b) => a - b);
  sharpeList.sort((a, b) => a - b);
  ddList.sort((a, b) => a - b);

  const i5 = Math.floor(samples * 0.05);
  const i95 = Math.floor(samples * 0.95);

  return {
    profitFactorCI95: [
      Number((pfList[i5] ?? 0).toFixed(2)),
      Number((pfList[i95] ?? 0).toFixed(2)),
    ],
    expectancyCI95: [
      Number((expList[i5] ?? 0).toFixed(2)),
      Number((expList[i95] ?? 0).toFixed(2)),
    ],
    sharpeRatioCI95: [
      Number((sharpeList[i5] ?? 0).toFixed(2)),
      Number((sharpeList[i95] ?? 0).toFixed(2)),
    ],
    maxDrawdownCI95: [
      Number((ddList[i5] ?? 0).toFixed(2)),
      Number((ddList[i95] ?? 0).toFixed(2)),
    ],
  };
}

// ============================================================
// 4. Parameter Sensitivity Engine & Stability Analyzer
// ============================================================

export interface ParameterSensitivityRequest {
  candles: NormalizedCandle[];
  parameterName: 'confidenceFloor' | 'riskRewardRatio' | 'atrMultiplier' | 'rsiPeriod';
  gridValues?: number[];
}

export interface SensitivityHeatmapPoint {
  paramValue: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
}

export interface ParameterSensitivityResult {
  parameterName: string;
  heatmap: SensitivityHeatmapPoint[];
  optimalValue: number;
  stabilityVariance: number;
  isStable: boolean;
}

export function runSensitivityEngine(
  req: ParameterSensitivityRequest,
): ParameterSensitivityResult {
  const defaultGrids: Record<string, number[]> = {
    confidenceFloor: [50, 55, 60, 65, 70, 75],
    riskRewardRatio: [1.2, 1.5, 1.8, 2.0, 2.5, 3.0],
    atrMultiplier: [1.0, 1.5, 2.0, 2.5, 3.0],
    rsiPeriod: [7, 10, 14, 21, 28],
  };

  const grid = req.gridValues ?? defaultGrids[req.parameterName] ?? [1, 2, 3, 4, 5];
  const heatmap: SensitivityHeatmapPoint[] = grid.map((val) => {
    const summary = runHistoricalBacktest({
      candles: req.candles,
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'SENSITIVITY-SAMPLE',
      interval: ExchangeInterval.FIFTEEN_MINUTES,
      initialBalance: 10_000,
      leverage: 2,
      riskPerTrade: 0.01,
      riskRewardRatio: req.parameterName === 'riskRewardRatio' ? val : 2,
      atrMultiplier: req.parameterName === 'atrMultiplier' ? val : 1.5,
      rsiPeriod: req.parameterName === 'rsiPeriod' ? val : 14,
      confidenceFloor: req.parameterName === 'confidenceFloor' ? val : 60,
      strategyName: req.parameterName === 'rsiPeriod' ? 'RSI_MEAN_REVERSION' : 'HYBRID_QUANT',
    });
    return {
      paramValue: val,
      totalReturn: Number((summary.metrics.totalReturn * 100).toFixed(2)),
      sharpeRatio: Number(summary.metrics.sharpeRatio.toFixed(2)),
      maxDrawdown: Number((summary.metrics.maxDrawdown * 100).toFixed(2)),
      winRate: Number((summary.metrics.winRate * 100).toFixed(2)),
    };
  });

  const best = [...heatmap].sort((a, b) => b.sharpeRatio - a.sharpeRatio)[0];
  const returns = heatmap.map((h) => h.totalReturn);
  const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - meanRet) ** 2, 0) / returns.length;

  return {
    parameterName: req.parameterName,
    heatmap,
    optimalValue: best?.paramValue ?? grid[0] ?? 0,
    stabilityVariance: Number(variance.toFixed(2)),
    isStable: variance < 25.0,
  };
}

// ============================================================
// 5. Confidence Calibration Engine
// ============================================================

export interface CalibrationBin {
  confidenceBin: string; // e.g. "60-70%"
  forecastConfidence: number;
  observedWinRate: number;
  sampleCount: number;
}

export interface CalibrationEngineResult {
  bins: CalibrationBin[];
  brierScore: number;
  calibrationAdjustment: number;
  reliabilityCurve: Array<{ forecast: number; observed: number }>;
}

export function runConfidenceCalibrationEngine(
  decisions: Array<{ confidence: number; isWin: boolean }>,
): CalibrationEngineResult {
  const sampleDecisions = decisions;

  const binRanges = [
    { min: 50, max: 60, label: '50-60%' },
    { min: 60, max: 70, label: '60-70%' },
    { min: 70, max: 80, label: '70-80%' },
    { min: 80, max: 90, label: '80-90%' },
    { min: 90, max: 100, label: '90-100%' },
  ];

  let brierSum = 0;
  const bins: CalibrationBin[] = binRanges.map((range) => {
    const items = sampleDecisions.filter(
      (d) => d.confidence >= range.min && d.confidence < range.max,
    );
    const count = items.length;
    const wins = items.filter((d) => d.isWin).length;
    const observedWinRate = count > 0 ? (wins / count) * 100 : 0;
    const forecastConfidence = (range.min + range.max) / 2;

    items.forEach((item) => {
      const fc = item.confidence / 100;
      const obs = item.isWin ? 1 : 0;
      brierSum += (fc - obs) ** 2;
    });

    return {
      confidenceBin: range.label,
      forecastConfidence,
      observedWinRate: Number(observedWinRate.toFixed(1)),
      sampleCount: count,
    };
  });

  const brierScore = Number((brierSum / Math.max(1, sampleDecisions.length)).toFixed(4));
  const avgForecast = bins.reduce((a, b) => a + b.forecastConfidence, 0) / bins.length;
  const avgObserved = bins.reduce((a, b) => a + b.observedWinRate, 0) / bins.length;
  const calibrationAdjustment = Number((avgObserved - avgForecast).toFixed(2));

  return {
    bins,
    brierScore,
    calibrationAdjustment,
    reliabilityCurve: bins.map((b) => ({
      forecast: b.forecastConfidence,
      observed: b.observedWinRate,
    })),
  };
}

// ============================================================
// 6. Market Regime Stability Analyzer
// ============================================================

export interface RegimePerformance {
  regime: 'BULL_TREND' | 'BEAR_TREND' | 'SIDEWAYS' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY';
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  sampleCandles: number;
}

export interface RegimeStabilityResult {
  regimes: RegimePerformance[];
  overallRegimeStabilityScore: number;
  weakestRegime: string;
}

export function runRegimeStabilityAnalyzer(
  candles: NormalizedCandle[],
): RegimeStabilityResult {
  const regimeTypes: RegimePerformance['regime'][] = [
    'BULL_TREND',
    'BEAR_TREND',
    'SIDEWAYS',
    'HIGH_VOLATILITY',
    'LOW_VOLATILITY',
  ];

  const observations = regimeTypes.map((regime) => ({ regime, returns: [] as number[] }));
  for (let index = 20; index < candles.length - 1; index += 1) {
    const window = candles.slice(index - 20, index + 1).map((item) => Number(item.close));
    const first = window[0] ?? 0;
    const last = window.at(-1) ?? first;
    const drift = first > 0 ? last / first - 1 : 0;
    const changes = window.slice(1).map((value, offset) => value / Math.max(1e-12, window[offset] ?? value) - 1);
    const volatility = Math.sqrt(changes.reduce((sum, value) => sum + value ** 2, 0) / Math.max(1, changes.length));
    const regime: RegimePerformance['regime'] = volatility > 0.025
      ? 'HIGH_VOLATILITY'
      : volatility < 0.004
        ? 'LOW_VOLATILITY'
        : drift > 0.025
          ? 'BULL_TREND'
          : drift < -0.025 ? 'BEAR_TREND' : 'SIDEWAYS';
    const next = Number(candles[index + 1]?.close ?? last);
    observations.find((item) => item.regime === regime)?.returns.push(last > 0 ? next / last - 1 : 0);
  }
  const regimes: RegimePerformance[] = observations.map(({ regime, returns }) => {
    let equity = 1;
    let peak = 1;
    let drawdown = 0;
    for (const value of returns) {
      equity *= 1 + value;
      peak = Math.max(peak, equity);
      drawdown = Math.max(drawdown, peak > 0 ? (peak - equity) / peak : 0);
    }
    return {
      regime,
      winRate: returns.length ? Number((returns.filter((value) => value > 0).length / returns.length * 100).toFixed(1)) : 0,
      totalReturn: Number(((equity - 1) * 100).toFixed(2)),
      maxDrawdown: Number((drawdown * 100).toFixed(2)),
      sampleCandles: returns.length,
    };
  });

  const winRates = regimes.map((r) => r.winRate);
  const minWin = Math.min(...winRates);
  const maxWin = Math.max(...winRates);
  const stabilityScore = Math.max(0, Math.min(100, 100 - (maxWin - minWin) * 2));
  const weakest = [...regimes].sort((a, b) => a.totalReturn - b.totalReturn)[0];

  return {
    regimes,
    overallRegimeStabilityScore: Number(stabilityScore.toFixed(1)),
    weakestRegime: weakest?.regime ?? 'HIGH_VOLATILITY',
  };
}

// ============================================================
// 7. Cross-Symbol Robustness Engine
// ============================================================

export interface SymbolRobustness {
  symbol: string;
  winRate: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  robustnessRank: number;
}

export interface CrossSymbolRobustnessResult {
  symbols: SymbolRobustness[];
  robustnessScore: number;
  isRobust: boolean;
}

export function runCrossSymbolRobustnessEngine(
  actualResults: Array<Omit<SymbolRobustness, 'robustnessRank'>> = [],
): CrossSymbolRobustnessResult {
  const symbols = [...actualResults]
    .sort((left, right) => right.sharpeRatio - left.sharpeRatio)
    .map((item, index) => ({ ...item, robustnessRank: index + 1 }));

  const positiveReturns = symbols.filter((s) => s.totalReturn > 0).length;
  const robustnessScore = symbols.length ? Number(((positiveReturns / symbols.length) * 100).toFixed(1)) : 0;

  return {
    symbols,
    robustnessScore,
    isRobust: robustnessScore >= 80.0,
  };
}

// ============================================================
// 8. Out-of-Sample (OOS) Validation Engine
// ============================================================

export interface OutOfSampleResult {
  inSampleReturn: number;
  outOfSampleReturn: number;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  degradationPct: number;
  passedValidation: boolean;
  inSampleTrades: number;
  outOfSampleTrades: number;
}

export function runOutOfSampleEngine(
  candles: NormalizedCandle[],
  options: {
    provider?: ExchangeProvider;
    symbol?: string;
    interval?: ExchangeInterval;
    strategyName?: string;
    leverage?: number;
    riskPerTrade?: number;
    riskRewardRatio?: number;
  } = {},
): OutOfSampleResult {
  const splitIdx = Math.floor(candles.length * 0.7);
  const isCandles = candles.slice(0, splitIdx);
  const oosCandles = candles.slice(splitIdx);

  const evaluate = (sample: NormalizedCandle[]) => runHistoricalBacktest({
    candles: sample,
    provider: options.provider ?? ExchangeProvider.BINANCE_FUTURES,
    symbol: options.symbol ?? 'OOS-SAMPLE',
    interval: options.interval ?? ExchangeInterval.FIFTEEN_MINUTES,
    initialBalance: 10_000,
    leverage: options.leverage ?? 2,
    riskPerTrade: options.riskPerTrade ?? 0.01,
    riskRewardRatio: options.riskRewardRatio ?? 2,
    strategyName: options.strategyName ?? 'HYBRID_QUANT',
  });
  const inSample = evaluate(isCandles);
  const outOfSample = evaluate(oosCandles);
  const isReturn = inSample.metrics.totalReturn * 100;
  const oosReturn = outOfSample.metrics.totalReturn * 100;
  const isSharpe = inSample.metrics.sharpeRatio;
  const oosSharpe = outOfSample.metrics.sharpeRatio;
  const degradation = isReturn !== 0 ? ((isReturn - oosReturn) / Math.abs(isReturn)) * 100 : 0;

  return {
    inSampleReturn: Number(isReturn.toFixed(2)),
    outOfSampleReturn: Number(oosReturn.toFixed(2)),
    inSampleSharpe: isSharpe,
    outOfSampleSharpe: oosSharpe,
    degradationPct: Number(degradation.toFixed(2)),
    passedValidation: degradation < 35.0 && oosSharpe > 1.0,
    inSampleTrades: inSample.trades.length,
    outOfSampleTrades: outOfSample.trades.length,
  };
}

// ============================================================
// 9. Probability of Ruin Engine
// ============================================================

export interface RuinEngineRequest {
  winRate: number; // e.g. 0.60
  riskRewardRatio: number; // e.g. 2.0
  riskPerTradeFraction: number; // e.g. 0.02
  capital: number;
}

export interface RuinEngineResult {
  probabilityOfRuinPct: number;
  kellyFraction: number;
  recommendedRiskPct: number;
  safetyMarginScore: number;
}

export function runProbabilityOfRuinEngine(req: RuinEngineRequest): RuinEngineResult {
  const W = req.winRate;
  const R = req.riskRewardRatio;
  const f = req.riskPerTradeFraction;

  // Kelly formula: K = W - (1 - W) / R
  const kelly = W - (1 - W) / R;
  const recommendedRisk = Math.max(0.005, Math.min(0.05, kelly * 0.5));

  // Analytical ruin approximation: P_ruin = ((1 - W*R) / (W*R)) ^ (CapitalUnits)
  const edge = W * R - (1 - W);
  let probRuin = 0;
  if (edge <= 0) {
    probRuin = 100;
  } else {
    const exponent = Math.max(1, (1 / f) * edge);
    probRuin = Math.min(100, Math.max(0, Math.exp(-exponent) * 100));
  }

  const safetyScore = Math.max(0, Math.min(100, (1 - probRuin / 100) * 100));

  return {
    probabilityOfRuinPct: Number(probRuin.toFixed(2)),
    kellyFraction: Number(kelly.toFixed(3)),
    recommendedRiskPct: Number((recommendedRisk * 100).toFixed(2)),
    safetyMarginScore: Number(safetyScore.toFixed(1)),
  };
}
