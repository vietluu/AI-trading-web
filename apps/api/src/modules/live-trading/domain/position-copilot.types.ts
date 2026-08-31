import type { TradePlan } from "../../risk/domain/trade-plan-engine";

export type CopilotTriggerEvent =
  | "NEWS_SHOCK"
  | "ONCHAIN_WHALE_PRESSURE"
  | "MOMENTUM_EXHAUSTION"
  | "THESIS_BROKEN"
  | "REASSESSMENT_DUE"
  | "VOLATILITY_SURGE"
  | "SCHEDULED_POLL";

export type CopilotActionType =
  | "HOLD"
  | "DEFENSIVE_EXIT"
  | "ACCELERATE_TP"
  | "TIGHTEN_STOP_LOSS"
  | "DE_RISK_REDUCE";

export interface InFlightMarketContext {
  markPrice: number;
  newsSentiment?: {
    score: number; // -1.0 (very negative) to +1.0 (very positive)
    importance: number; // 0 - 100
    headline?: string;
    isShock?: boolean;
  };
  onchainFlow?: {
    exchangeNetInflowUsd?: number;
    whaleAlertDetected?: boolean;
    inflowSeverity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };
  technicalState?: {
    rsi?: number;
    rsiDivergence?: "BULLISH" | "BEARISH" | "NONE";
    macdDivergence?: "BULLISH" | "BEARISH" | "NONE";
    atr?: number;
    nearResistance?: boolean;
    nearSupport?: boolean;
    volumeSpikeRatio?: number;
  };
  marketRegime?: string;
  now?: Date;
}

export interface PositionCopilotInput {
  positionId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  quantity: number;
  initialStopLoss: number;
  currentStopLoss: number;
  takeProfit?: number;
  highestMark?: number;
  lowestMark?: number;
  openedAt: Date;
  plan: TradePlan;
  triggerEvent: CopilotTriggerEvent;
  context: InFlightMarketContext;
}

export interface CopilotDecision {
  action: CopilotActionType;
  confidence: number;
  reason: string;
  proposedStopLoss?: number;
  closeRatio?: number; // 0.0 to 1.0 (1.0 = close all, 0.5 = close 50%)
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evaluatedAt: Date;
  thesisHealthScore: number; // 0 - 100 (100 = perfectly healthy, < 40 = broken)
  safetyViolations?: string[];
}
