import type { DecisionOutput, RiskOutput } from "@platform/shared";
import type { TradePlan, TradePlanMarketContext } from "./trade-plan-engine";

export interface RiskAccount {
  balance: number;
  equity: number;
  peakEquity: number;
}

export interface RiskPosition {
  symbol: string;
  size: number;
  markPrice: number;
}

export interface LastTradeRecord {
  symbol: string;
  direction: "LONG" | "SHORT";
  createdAt: Date;
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
  now?: Date;
}

export interface RiskLimits {
  riskPerTrade: number;
  maxPositions: number;
  maxLeverage: number;
  maxDrawdown: number;
  maxExposure: number;
  cooldownMs: number;
  minimumConfidence: number;
  stopLossPct: number;
  riskRewardRatio: number;
  highVolatility: number;
  abnormalVolatility: number;
  highVolatilitySizeFactor: number;
}

export interface RiskEvaluation extends RiskOutput {
  exposurePct: number;
  drawdownPct: number;
  tradePlan?: TradePlan;
}
