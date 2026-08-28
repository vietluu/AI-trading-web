/**
 * Pure domain evaluator: compares available exchange collateral to total equity.
 * No side-effects; no rounding that affects the comparison.
 */
export interface CollateralHealthResult {
  healthy: boolean;
  ratio: number;
  reason?: string;
}

export function evaluateCollateralHealth(
  totalEquity: number,
  availableBalance: number,
  warningRatio: number,
): CollateralHealthResult {
  const equity = Number.isFinite(totalEquity) && totalEquity > 0 ? totalEquity : 0;
  const available = Number.isFinite(availableBalance) && availableBalance >= 0 ? availableBalance : 0;

  if (equity === 0) {
    return { healthy: true, ratio: 0 };
  }

  const ratio = available / equity;

  if (ratio < warningRatio) {
    return {
      healthy: false,
      ratio: Math.round(ratio * 1e10) / 1e10,
      reason: "AVAILABLE_COLLATERAL_BELOW_WARNING_RATIO",
    };
  }

  return { healthy: true, ratio: Math.round(ratio * 1e10) / 1e10 };
}
