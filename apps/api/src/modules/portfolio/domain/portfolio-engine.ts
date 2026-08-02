export type StrategyType = "AI" | "RULE_BASED" | "HYBRID";
export type StrategyKind =
  "AI_CORE" | "TREND_FOLLOWING" | "MEAN_REVERSION" | "BREAKOUT" | "NEWS_DRIVEN";
export type StrategyStatus = "ACTIVE" | "PAUSED" | "DISABLED";
export type PositionSide = "LONG" | "SHORT";

export interface StrategyMetrics {
  totalTrades: number;
  winRate: number;
  returnPct: number;
  drawdownPct: number;
  sharpeRatio?: number | null;
}

export interface StrategySnapshot {
  id: string;
  key: string;
  status: StrategyStatus;
  performance: StrategyMetrics;
}

export interface PortfolioLimits {
  maxStrategies: number;
  maxTotalExposure: number;
  maxStrategyExposure: number;
  maxDrawdown: number;
  disableMinTrades: number;
  disableReturnPct: number;
  disableWinRate: number;
}

export interface StrategyPositionSnapshot {
  strategyId: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  markPrice: number;
}

export interface AllocationResult {
  strategyId: string;
  weight: number;
  allocatedCapital: number;
  disabled: boolean;
}

export interface PortfolioRiskInput {
  strategyId: string;
  symbol: string;
  side: PositionSide;
  requestedNotional: number;
  equity: number;
  peakEquity: number;
  allocatedCapital: number;
  positions: StrategyPositionSnapshot[];
}

export interface PortfolioRiskResult {
  approved: boolean;
  reason?: string;
  approvedNotional: number;
  totalExposurePct: number;
  strategyExposurePct: number;
  correlatedStrategies: number;
  failsafe: boolean;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 8): number =>
  Number(value.toFixed(digits));
const notional = (position: StrategyPositionSnapshot): number =>
  Math.abs(position.quantity * position.markPrice);

export function shouldDisableStrategy(
  metrics: StrategyMetrics,
  limits: PortfolioLimits,
): boolean {
  return (
    metrics.drawdownPct >= limits.maxDrawdown ||
    (metrics.totalTrades >= limits.disableMinTrades &&
      metrics.returnPct <= limits.disableReturnPct &&
      metrics.winRate < limits.disableWinRate)
  );
}

function performanceScore(metrics: StrategyMetrics): number {
  const sharpe = Number.isFinite(metrics.sharpeRatio)
    ? Number(metrics.sharpeRatio)
    : 0;
  return Math.max(
    0.05,
    1 +
      clamp(metrics.returnPct, -0.5, 1) * 4 +
      clamp(sharpe, -3, 5) * 0.15 -
      clamp(metrics.drawdownPct, 0, 1) * 5 +
      clamp(metrics.winRate - 0.5, -0.5, 0.5),
  );
}

/** Distributes deployable capital using performance scores and a hard per-strategy cap. */
export function calculateAllocations(
  strategies: StrategySnapshot[],
  equity: number,
  limits: PortfolioLimits,
): AllocationResult[] {
  const selected = strategies.slice(0, limits.maxStrategies);
  const disabled = new Set(
    selected
      .filter(
        (strategy) =>
          strategy.status === "DISABLED" ||
          shouldDisableStrategy(strategy.performance, limits),
      )
      .map((strategy) => strategy.id),
  );
  const active = selected.filter(
    (strategy) => strategy.status === "ACTIVE" && !disabled.has(strategy.id),
  );
  const weights = new Map<string, number>();
  let remaining = 1;
  let candidates = [...active];
  while (candidates.length && remaining > 1e-12) {
    const scoreTotal = candidates.reduce(
      (sum, strategy) => sum + performanceScore(strategy.performance),
      0,
    );
    const capped: StrategySnapshot[] = [];
    for (const strategy of candidates) {
      const proposed =
        (performanceScore(strategy.performance) / scoreTotal) * remaining;
      if (proposed >= limits.maxStrategyExposure) {
        weights.set(strategy.id, limits.maxStrategyExposure);
        remaining -= limits.maxStrategyExposure;
      } else capped.push(strategy);
    }
    if (capped.length === candidates.length) {
      for (const strategy of capped)
        weights.set(
          strategy.id,
          (weights.get(strategy.id) ?? 0) +
            (performanceScore(strategy.performance) / scoreTotal) * remaining,
        );
      remaining = 0;
    }
    candidates = capped;
  }
  return selected.map((strategy) => {
    const weight = round(weights.get(strategy.id) ?? 0, 6);
    return {
      strategyId: strategy.id,
      weight,
      allocatedCapital: round(Math.max(0, equity) * weight),
      disabled: disabled.has(strategy.id),
    };
  });
}

export function assessPortfolioRisk(
  input: PortfolioRiskInput,
  limits: PortfolioLimits,
): PortfolioRiskResult {
  const reject = (
    reason: string,
    totalExposure: number,
    strategyExposure: number,
    correlatedStrategies = 0,
    failsafe = false,
  ): PortfolioRiskResult => ({
    approved: false,
    reason,
    approvedNotional: 0,
    totalExposurePct: round(
      input.equity > 0 ? totalExposure / input.equity : 1,
      6,
    ),
    strategyExposurePct: round(
      input.equity > 0 ? strategyExposure / input.equity : 1,
      6,
    ),
    correlatedStrategies,
    failsafe,
  });
  if (
    ![input.equity, input.peakEquity, input.requestedNotional].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return reject("INVALID_PORTFOLIO_DATA", 0, 0);
  const drawdown = Math.max(
    0,
    (input.peakEquity - input.equity) / input.peakEquity,
  );
  const currentTotal = input.positions.reduce(
    (sum, item) => sum + notional(item),
    0,
  );
  const currentStrategy = input.positions
    .filter((item) => item.strategyId === input.strategyId)
    .reduce((sum, item) => sum + notional(item), 0);
  if (drawdown >= limits.maxDrawdown)
    return reject(
      "PORTFOLIO_FAILSAFE_ACTIVE",
      currentTotal,
      currentStrategy,
      0,
      true,
    );
  const correlated = new Set(
    input.positions
      .filter(
        (item) =>
          item.strategyId !== input.strategyId &&
          item.symbol === input.symbol &&
          item.side === input.side &&
          notional(item) > 0,
      )
      .map((item) => item.strategyId),
  ).size;
  if (correlated > 0)
    return reject(
      "CORRELATED_DIRECTION_LIMIT",
      currentTotal,
      currentStrategy,
      correlated,
    );

  // Replacing a strategy's existing symbol target does not double count it.
  const replaced = input.positions.find(
    (item) =>
      item.strategyId === input.strategyId && item.symbol === input.symbol,
  );
  const replacedNotional = replaced ? notional(replaced) : 0;
  const retainedTotal = Math.max(0, currentTotal - replacedNotional);
  const retainedStrategy = Math.max(0, currentStrategy - replacedNotional);
  const strategyCapacity = Math.max(
    0,
    Math.min(
      input.allocatedCapital,
      input.equity * limits.maxStrategyExposure,
    ) - retainedStrategy,
  );
  const portfolioCapacity = Math.max(
    0,
    input.equity * limits.maxTotalExposure - retainedTotal,
  );
  const approvedNotional = Math.min(
    input.requestedNotional,
    strategyCapacity,
    portfolioCapacity,
  );
  if (approvedNotional <= 0)
    return reject(
      strategyCapacity <= 0
        ? "MAX_STRATEGY_EXPOSURE_EXCEEDED"
        : "MAX_TOTAL_EXPOSURE_EXCEEDED",
      currentTotal,
      currentStrategy,
    );
  const projectedTotal = retainedTotal + approvedNotional;
  const projectedStrategy = retainedStrategy + approvedNotional;
  return {
    approved: true,
    approvedNotional: round(approvedNotional),
    totalExposurePct: round(projectedTotal / input.equity, 6),
    strategyExposurePct: round(projectedStrategy / input.equity, 6),
    correlatedStrategies: 0,
    failsafe: false,
  };
}

export function aggregatePositions(positions: StrategyPositionSnapshot[]) {
  const groups = new Map<
    string,
    {
      symbol: string;
      longNotional: number;
      shortNotional: number;
      strategies: Set<string>;
    }
  >();
  for (const position of positions) {
    const group = groups.get(position.symbol) ?? {
      symbol: position.symbol,
      longNotional: 0,
      shortNotional: 0,
      strategies: new Set<string>(),
    };
    const value = notional(position);
    if (position.side === "LONG") group.longNotional += value;
    else group.shortNotional += value;
    group.strategies.add(position.strategyId);
    groups.set(position.symbol, group);
  }
  return [...groups.values()].map((group) => ({
    symbol: group.symbol,
    longNotional: round(group.longNotional),
    shortNotional: round(group.shortNotional),
    grossNotional: round(group.longNotional + group.shortNotional),
    netNotional: round(group.longNotional - group.shortNotional),
    strategyCount: group.strategies.size,
  }));
}
