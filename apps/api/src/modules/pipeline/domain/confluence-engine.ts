export * from "./confluence-engine.types";
import {
  type ConfluenceEvaluation,
  type ConfluenceSignal,
  type ConfluenceSizeConfig,
  DEFAULT_CONFLUENCE_SIZE_CONFIG,
} from "./confluence-engine.types";


/**
 * Computes a multi-factor composite ranking score from quantitative dimensions.
 * Combines confidence (40%), opportunity score (30%), normalized EV (20%), and risk safety (10%).
 */
export function computeMultiFactorCompositeScore(signal: {
  confidence: number;
  opportunityScore: number;
  expectedValue: number;
  riskScore: number;
}): number {
  const normConfidence = Math.max(0, Math.min(100, Number(signal.confidence) || 0));
  const normOpportunity = Math.max(0, Math.min(100, Number(signal.opportunityScore) || 0));
  const normEv = Math.max(-50, Math.min(50, (Number(signal.expectedValue) || 0) * 100));
  const normSafety = Math.max(0, Math.min(100, 100 - (Number(signal.riskScore) || 0)));

  const composite =
    normConfidence * 0.4 +
    normOpportunity * 0.3 +
    normEv * 0.2 +
    normSafety * 0.1;

  return Number(composite.toFixed(3));
}

/**
 * Calculates the execution size multiplier based on directional concordance and signal quality.
 */
export function computeConcordanceSizeFactor(
  concordanceCount: number,
  config: ConfluenceSizeConfig = DEFAULT_CONFLUENCE_SIZE_CONFIG,
  selectedSignal?: Pick<ConfluenceSignal, "opportunityScore" | "expectedValue">,
): number {
  if (!Number.isFinite(concordanceCount) || concordanceCount < config.minSignalsForBoost) {
    return 1.0;
  }
  let boost = config.boostPerSignal * (concordanceCount - 1);
  if (config.qualityBonus && selectedSignal) {
    const oppQualifies =
      config.qualityBonus.minOpportunityScore !== undefined &&
      selectedSignal.opportunityScore >= config.qualityBonus.minOpportunityScore;
    const evQualifies =
      config.qualityBonus.minExpectedValue !== undefined &&
      selectedSignal.expectedValue >= config.qualityBonus.minExpectedValue;
    if (oppQualifies || evQualifies) {
      boost += config.qualityBonus.bonusMultiplier ?? 0.1;
    }
  }
  const rawFactor = 1.0 + boost;
  return Number(Math.min(rawFactor, config.maxSizeFactor).toFixed(3));
}

/**
 * Compares two actionable confluence signals for ranking priority.
 */
export function compareConfluenceSignals(
  a: ConfluenceSignal,
  b: ConfluenceSignal,
): number {
  return (
    b.compositeScore - a.compositeScore ||
    b.confidence - a.confidence ||
    b.opportunityScore - a.opportunityScore ||
    b.expectedValue - a.expectedValue ||
    a.symbol.localeCompare(b.symbol)
  );
}

/**
 * Evaluates a batch of concurrent trading signals across symbols, selects the best candidate,
 * computes the concordance size boost, and separates rejected candidates for shadow logging.
 */
export function evaluateConfluence(
  signals: ConfluenceSignal[],
  totalSymbols: number,
  config: ConfluenceSizeConfig = DEFAULT_CONFLUENCE_SIZE_CONFIG,
): ConfluenceEvaluation | null {
  if (!signals || signals.length === 0) {
    return null;
  }

  const longSignals = signals.filter((s) => s.decision === "LONG");
  const shortSignals = signals.filter((s) => s.decision === "SHORT");

  let dominantDirection: "LONG" | "SHORT";
  if (longSignals.length > shortSignals.length) {
    dominantDirection = "LONG";
  } else if (shortSignals.length > longSignals.length) {
    dominantDirection = "SHORT";
  } else {
    // Equal count - pick direction of the signal with highest composite score
    const bestLong = longSignals.length > 0 ? [...longSignals].sort(compareConfluenceSignals)[0] : undefined;
    const bestShort = shortSignals.length > 0 ? [...shortSignals].sort(compareConfluenceSignals)[0] : undefined;
    if (!bestLong) {
      dominantDirection = "SHORT";
    } else if (!bestShort) {
      dominantDirection = "LONG";
    } else {
      dominantDirection = compareConfluenceSignals(bestLong, bestShort) <= 0 ? "LONG" : "SHORT";
    }
  }

  const alignedSignals = (dominantDirection === "LONG" ? longSignals : shortSignals).sort(compareConfluenceSignals);
  const opposingSignals = (dominantDirection === "LONG" ? shortSignals : longSignals).sort(compareConfluenceSignals);

  const selected = alignedSignals[0];
  if (!selected) {
    return null;
  }

  const rejected = [...alignedSignals.slice(1), ...opposingSignals];
  const concordanceCount = alignedSignals.length;
  const safeTotal = Math.max(concordanceCount, totalSymbols > 0 ? totalSymbols : signals.length);
  const concordanceRatio = Number((concordanceCount / safeTotal).toFixed(3));
  const sizeFactor = computeConcordanceSizeFactor(concordanceCount, config, selected);

  return {
    selected,
    rejected,
    concordanceCount,
    totalSymbols: safeTotal,
    concordanceRatio,
    sizeFactor,
    direction: dominantDirection,
  };
}
