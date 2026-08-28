export type EvaluationHorizon = "SHORT" | "M15" | "M30" | "MID" | "H2" | "H4" | "LONG";

/**
 * Returns the maximum absolute time difference (ms) between the desired
 * target candle closeTime and the anchor target time that is still
 * considered provenance-eligible for a given horizon.
 */
export function performanceDriftToleranceMs(
  horizon: string,
  horizonDurationMs: number,
): number {
  switch (horizon) {
    case "M15":
    case "M30":
      return 60_000;
    case "MID":
    case "H2":
    case "H4":
      return 120_000;
    case "LONG":
      return 300_000;
    default: // SHORT and any other
      return Math.min(60_000, Math.max(15_000, Math.round(horizonDurationMs * 0.1)));
  }
}
