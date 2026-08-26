import type { DecisionOutput, RiskOutput } from "@platform/shared";
import type { TradePlan, TradePlanMarketContext } from "./trade-plan-engine";

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
}

export interface LastTradeRecord {
  symbol: string;
  direction: "LONG" | "SHORT";
  createdAt: Date;
}

export interface RecentClosedTradeRecord {
  netPnl: number;
  closedAt: Date;
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
}

export interface RiskLimits {
  riskPerTrade: number;
  maxPositions: number;
  /** Conservative crypto-beta proxy: cap simultaneous positions in one direction. */
  maxSameDirectionPositions?: number;
  maxLeverage: number;
  maxDrawdown: number;
  maxExposure: number;
  cooldownMs: number;
  /** Base pause after one net losing trade; consecutive losses escalate to 4x. */
  lossReentryCooldownMs?: number;
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

export interface RiskEvaluation extends RiskOutput {
  exposurePct: number;
  drawdownPct: number;
  plannedLoss?: number;
  plannedEquityRiskPct?: number;
  plannedMarginRoe?: number;
  tradePlan?: TradePlan;
}
