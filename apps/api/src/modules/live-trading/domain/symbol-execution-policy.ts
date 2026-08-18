import type { DecisionOutput } from "@platform/shared";

export interface SymbolExecutionPolicyConfig {
  cautionSymbols: readonly string[];
  minimumTrades: number;
  minimumWinRate: number;
  minimumProfitFactor: number;
  strongSignalConfidence: number;
  strongSignalOpportunity: number;
  strongSignalExpectedValue: number;
  sizeFactor: number;
}

export interface SymbolExecutionPolicyResult {
  allowed: boolean;
  sizeFactor: number;
  reason?: "SYMBOL_CAUTION_QUALITY_GATE";
  evidence?: {
    sampleSize: number;
    winRate: number;
    profitFactor: number | null;
    underperforming: boolean;
    strongSignal: boolean;
  };
}

export const DEFAULT_SYMBOL_EXECUTION_POLICY: SymbolExecutionPolicyConfig = {
  cautionSymbols: ['LINK-USDT', 'ETH-USDT'],
  minimumTrades: 5,
  minimumWinRate: 0.45,
  minimumProfitFactor: 1.1,
  strongSignalConfidence: 80,
  strongSignalOpportunity: 75,
  strongSignalExpectedValue: 0.12,
  sizeFactor: 0.5,
};

const normalizeSymbol = (value: string) =>
  value.trim().toUpperCase().replace(/[/_]/g, "-");

export function evaluateSymbolExecutionPolicy(input: {
  symbol: string;
  decision: DecisionOutput;
  closedTrades: ReadonlyArray<{ netPnl: { toString(): string } | number }>;
  config: SymbolExecutionPolicyConfig;
}): SymbolExecutionPolicyResult {
  const cautionSymbols = new Set(
    input.config.cautionSymbols.map(normalizeSymbol),
  );
  if (!cautionSymbols.has(normalizeSymbol(input.symbol))) {
    return { allowed: true, sizeFactor: 1 };
  }

  const pnls = input.closedTrades
    .map((trade) => Number(trade.netPnl))
    .filter(Number.isFinite);
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const winRate = pnls.length ? wins.length / pnls.length : 0;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0;
  const enoughEvidence = pnls.length >= input.config.minimumTrades;
  const underperforming =
    !enoughEvidence ||
    winRate < input.config.minimumWinRate ||
    (profitFactor !== null && profitFactor < input.config.minimumProfitFactor);
  if (!underperforming) return { allowed: true, sizeFactor: 1 };

  const strongSignal =
    input.decision.confidence >= input.config.strongSignalConfidence &&
    input.decision.opportunityScore >= input.config.strongSignalOpportunity &&
    input.decision.expectedValue >= input.config.strongSignalExpectedValue &&
    input.decision.conflictLevel === "LOW" &&
    input.decision.dataQuality === "GOOD";
  const evidence = {
    sampleSize: pnls.length,
    winRate,
    profitFactor,
    underperforming,
    strongSignal,
  };
  if (!strongSignal) {
    return {
      allowed: false,
      sizeFactor: 0,
      reason: "SYMBOL_CAUTION_QUALITY_GATE",
      evidence,
    };
  }
  return {
    allowed: true,
    sizeFactor: Math.max(0.05, Math.min(1, input.config.sizeFactor)),
    evidence,
  };
}
