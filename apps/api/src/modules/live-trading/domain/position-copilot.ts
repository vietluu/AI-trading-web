import type {
  CopilotDecision,
  PositionCopilotInput,
} from "./position-copilot.types";

/**
 * Validates the Ironclad Asymmetric Safety Guard:
 * Copilot is strictly prohibited from widening risk (moving stop loss away from market).
 */
export function assertAsymmetricSafety(
  side: "LONG" | "SHORT",
  currentStopLoss: number,
  proposedStopLoss?: number,
): { valid: boolean; violation?: string } {
  if (proposedStopLoss === undefined || !Number.isFinite(proposedStopLoss)) {
    return { valid: true };
  }

  if (side === "LONG" && proposedStopLoss < currentStopLoss - 1e-8) {
    return {
      valid: false,
      violation: `SAFETY_GUARD_VIOLATION: Proposed LONG stop loss (${proposedStopLoss}) is lower than current stop loss (${currentStopLoss}). Widening risk is strictly prohibited.`,
    };
  }

  if (side === "SHORT" && proposedStopLoss > currentStopLoss + 1e-8) {
    return {
      valid: false,
      violation: `SAFETY_GUARD_VIOLATION: Proposed SHORT stop loss (${proposedStopLoss}) is higher than current stop loss (${currentStopLoss}). Widening risk is strictly prohibited.`,
    };
  }

  return { valid: true };
}

/**
 * Evaluates active in-flight position health and generates dynamic adaptation decisions.
 */
export function evaluatePositionCopilot(
  input: PositionCopilotInput,
): CopilotDecision {
  const evaluatedAt = input.context.now ?? new Date();
  const currentProfit =
    input.side === "LONG"
      ? input.markPrice - input.entryPrice
      : input.entryPrice - input.markPrice;
  const initialRisk = Math.abs(input.entryPrice - input.initialStopLoss);
  const currentR = initialRisk > 0 ? currentProfit / initialRisk : 0;
  const atr = input.context.technicalState?.atr ?? input.plan.atr ?? input.entryPrice * 0.01;

  let thesisHealthScore = 80;
  const news = input.context.newsSentiment;
  const onchain = input.context.onchainFlow;
  const tech = input.context.technicalState;

  // 1. Evaluate News Sentiment Impact
  if (news && news.importance >= 70) {
    const isHostileNews =
      (input.side === "LONG" && news.score <= -0.4) ||
      (input.side === "SHORT" && news.score >= 0.4);
    if (isHostileNews) {
      thesisHealthScore -= 45;
    }
  }

  // 2. Evaluate Onchain Whale Inflow Impact
  if (onchain && onchain.whaleAlertDetected) {
    if (onchain.inflowSeverity === "CRITICAL" || onchain.inflowSeverity === "HIGH") {
      thesisHealthScore -= 35;
    } else if (onchain.inflowSeverity === "MEDIUM") {
      thesisHealthScore -= 20;
    }
  }

  // 3. Evaluate Technical Divergence
  const hasOpposingDivergence =
    (input.side === "LONG" && (tech?.rsiDivergence === "BEARISH" || tech?.macdDivergence === "BEARISH")) ||
    (input.side === "SHORT" && (tech?.rsiDivergence === "BULLISH" || tech?.macdDivergence === "BULLISH"));

  if (hasOpposingDivergence) {
    thesisHealthScore -= 25;
  }

  // Normalize health score
  thesisHealthScore = Math.max(0, Math.min(100, thesisHealthScore));

  // ─── Decision Tree ───

  // Scenario A: Thesis Broken with Severe Hostile Event (e.g. Breaking News Shock)
  if (thesisHealthScore < 40) {
    if (currentR < 0.8) {
      return {
        action: "DEFENSIVE_EXIT",
        confidence: 88,
        reason: `Thesis broken (Health: ${thesisHealthScore}/100) due to severe hostile event. Executing defensive exit to avoid full stop loss.`,
        closeRatio: 1.0,
        urgency: "CRITICAL",
        evaluatedAt,
        thesisHealthScore,
      };
    }

    // In profit but thesis compromised -> Tighten SL aggressively
    const candidateStop =
      input.side === "LONG"
        ? Number((input.markPrice - 0.4 * atr).toFixed(8))
        : Number((input.markPrice + 0.4 * atr).toFixed(8));

    const safety = assertAsymmetricSafety(input.side, input.currentStopLoss, candidateStop);
    if (safety.valid) {
      return {
        action: "TIGHTEN_STOP_LOSS",
        confidence: 85,
        reason: `Thesis compromised but currently in profit (${currentR.toFixed(2)}R). Tightening stop loss to protect realized gains.`,
        proposedStopLoss: candidateStop,
        urgency: "HIGH",
        evaluatedAt,
        thesisHealthScore,
      };
    }
  }

  // Scenario B: Momentum Exhaustion near Target Resistance/Support
  const isNearTargetBoundary =
    (input.side === "LONG" && tech?.nearResistance) ||
    (input.side === "SHORT" && tech?.nearSupport);

  if (currentR >= 1.2 && hasOpposingDivergence && isNearTargetBoundary) {
    return {
      action: "ACCELERATE_TP",
      confidence: 86,
      reason: `Momentum exhaustion detected with divergence near key boundary (${currentR.toFixed(2)}R achieved). Accelerating profit taking before reversal.`,
      closeRatio: 1.0,
      urgency: "HIGH",
      evaluatedAt,
      thesisHealthScore,
    };
  }

  // Scenario C: Onchain Whale Dump Warning while in Healthy Profit
  if (onchain?.whaleAlertDetected && currentR >= 0.8) {
    const candidateStop =
      input.side === "LONG"
        ? Math.max(input.currentStopLoss, input.entryPrice + input.entryPrice * 0.001)
        : Math.min(input.currentStopLoss, input.entryPrice - input.entryPrice * 0.001);

    const safety = assertAsymmetricSafety(input.side, input.currentStopLoss, candidateStop);
    if (safety.valid && candidateStop !== input.currentStopLoss) {
      return {
        action: "TIGHTEN_STOP_LOSS",
        confidence: 82,
        reason: `Onchain whale activity detected. Tightening stop loss to lock in breakeven buffer (${candidateStop}).`,
        proposedStopLoss: Number(candidateStop.toFixed(8)),
        urgency: "HIGH",
        evaluatedAt,
        thesisHealthScore,
      };
    }
  }

  // Scenario D: Volatility Surge (Disorderly volume expansion)
  if (input.triggerEvent === "VOLATILITY_SURGE" && (tech?.volumeSpikeRatio ?? 0) >= 3.0) {
    return {
      action: "DE_RISK_REDUCE",
      confidence: 78,
      reason: `Disorderly volatility surge with ${tech?.volumeSpikeRatio}x volume expansion. De-risking 50% position.`,
      closeRatio: 0.5,
      urgency: "MEDIUM",
      evaluatedAt,
      thesisHealthScore,
    };
  }

  // Scenario E: Default - Thesis remains valid (or temporary whipsaw)
  return {
    action: "HOLD",
    confidence: 80,
    reason: `Thesis remains healthy (${thesisHealthScore}/100). Normal trade plan and exchange stops remain authoritative.`,
    urgency: "LOW",
    evaluatedAt,
    thesisHealthScore,
  };
}
