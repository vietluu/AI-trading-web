import type { DecisionOutput, MarketRegime, RiskOutput } from "@platform/shared";
import type { TradePlan, TradePlanMarketContext, StoredProbe } from "./trade-plan-engine";
import type { CanonicalSetup, ExecutionContext } from "../../pipeline/domain/execution-context";

export interface RiskAccount {
  balance: number;
  equity: number;
  peakEquity: number;
  /** Free collateral reported by the exchange; omitted for paper accounts. */
  availableBalance?: number;
}

export interface RiskPosition {
  symbol: string;
  side?: "LONG" | "SHORT";
  size: number;
  markPrice: number;
  /** Actual average fill price; required at runtime for staged adds. */
  entryPrice?: number;
  stopLoss?: number;
  protectionVerified?: boolean;
  stagedEntry?: StoredProbe;
}

export interface LastTradeRecord {
  symbol: string;
  direction: "LONG" | "SHORT";
  createdAt: Date;
}

export interface RecentClosedTradeRecord {
  symbol?: string;
  direction?: "LONG" | "SHORT";
  setup?: CanonicalSetup;
  regime?: MarketRegime["type"];
  configurationHash?: string;
  sourceDataCutoff?: string;
  netPnl: number;
  closedAt: Date;
}

export interface ExecutionPlanInput {
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  timeInForce?: 'IOC' | 'GTC';
  expiryCandles?: number;
}

export interface RiskInput {
  symbol: string;
  decision: DecisionOutput;
  account: RiskAccount;
  currentPositions: RiskPosition[];
  marketData: {
    price: number;
    volatility: number;
    tradePlanContext?: TradePlanMarketContext;
  };
  lastTradeAt?: Date;
  lastTrades?: LastTradeRecord[];
  /** Newest first; used to prevent immediate re-entry after net losses. */
  recentClosedTrades?: RecentClosedTradeRecord[];
  now?: Date;
  executionContext?: ExecutionContext;
  executionPlan?: ExecutionPlanInput;
}

export interface RiskLimits {
  riskPerTrade: number;
  maxPositions: number;
  /** Conservative crypto-beta proxy: cap simultaneous positions in one direction. */
  maxSameDirectionPositions?: number;
  maxLeverage: number;
  maxDrawdown: number;
  /** Drawdown at which new-entry risk is cut to one half. Defaults to 8%. */
  drawdownReducedPct?: number;
  /** Drawdown at which new entries become 0.10R diagnostic probes. Defaults to 12%. */
  drawdownDiagnosticProbePct?: number;
  /** Drawdown at which all new entries halt. Defaults to 15%. */
  drawdownHaltPct?: number;
  maxExposure: number;
  cooldownMs: number;
  /** Base pause after one net losing trade; consecutive losses escalate to 4x. */
  lossReentryCooldownMs?: number;
  /** Timed circuit breaker after this many newest-first consecutive losses. */
  maxConsecutiveLosses?: number;
  /** Pause duration for the consecutive-loss circuit breaker. */
  lossStreakPauseMs?: number;
  minimumConfidence: number;
  stopLossPct: number;
  riskRewardRatio: number;
  highVolatility: number;
  abnormalVolatility: number;
  highVolatilitySizeFactor: number;
  /** Estimated entry + exit fees/slippage as a fraction of notional. */
  estimatedRoundTripCostPct: number;
  /** Reject entries whose estimated round-trip cost consumes too much stop distance. */
  maxRoundTripCostToStopRatio?: number;
  /** Maximum planned stop loss as a fraction of the margin committed. */
  maxStopLossRoe: number;
  /** Extra stop-ROE budget for short-lived, boundary-confirmed range trades. */
  rangeScalpRoeMultiplier: number;
  /** Required estimated price distance between the stop and liquidation. */
  minLiquidationBufferPct: number;
}

export type DrawdownRequestedAction =
  | "ENTER"
  | "PROBE"
  | "PROTECTIVE_EXIT"
  | "REDUCE_ONLY";

export type DrawdownRiskTier =
  | "NORMAL"
  | "REDUCED"
  | "DIAGNOSTIC_PROBE"
  | "HALTED";

export interface DrawdownRiskPolicy {
  tier: DrawdownRiskTier;
  maxSizeFactor: number;
}

export interface RiskEvaluation extends RiskOutput {
  exposurePct: number;
  drawdownPct: number;
  plannedLoss?: number;
  plannedEquityRiskPct?: number;
  plannedMarginRoe?: number;
  tradePlan?: TradePlan;
}
