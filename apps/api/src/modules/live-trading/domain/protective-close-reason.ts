export type ProtectiveClosePurpose = "STOP_LOSS" | "TAKE_PROFIT";

interface ProtectiveOpeningOrder {
  symbol: string;
  side: string;
  stopLoss: unknown;
  takeProfit: unknown;
  protectiveClientOrderId: string | null;
  createdAt: Date;
}

interface ProtectiveChildOrder {
  symbol: string;
  side: string;
  status: string;
  reduceOnly?: boolean;
  averagePrice?: string;
  sourceCode?: string;
  algoClientOrderId?: string;
  createdAt?: Date;
}

const OKX_PROTECTIVE_CHILD_SOURCES = new Set(["7", "13"]);

function normalizedClientId(value: string | null | undefined): string {
  return (value ?? "").replace(/[^a-zA-Z0-9]/g, "");
}

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Classify an OKX system-generated reduce-only child using the protection
 * levels persisted on its opening order. Unknown source codes remain imported
 * so manual and unrelated external closes are never relabeled as TP/SL.
 */
export function inferProtectiveClosePurpose(
  order: ProtectiveChildOrder,
  openingOrders: ProtectiveOpeningOrder[],
): ProtectiveClosePurpose | undefined {
  if (
    order.status !== "FILLED" ||
    !order.reduceOnly ||
    !order.sourceCode ||
    !OKX_PROTECTIVE_CHILD_SOURCES.has(order.sourceCode)
  ) {
    return undefined;
  }
  const exitPrice = positiveNumber(order.averagePrice);
  if (!exitPrice) return undefined;

  const closingTime = order.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const oppositeOpeningSide = order.side === "SELL" ? "BUY" : "SELL";
  const candidates = openingOrders.filter(
    (candidate) =>
      candidate.symbol === order.symbol &&
      candidate.side === oppositeOpeningSide &&
      candidate.createdAt.getTime() <= closingTime &&
      Boolean(
        positiveNumber(candidate.stopLoss) ||
          positiveNumber(candidate.takeProfit),
      ),
  );
  if (!candidates.length) return undefined;

  const algoClientId = normalizedClientId(order.algoClientOrderId);
  const linked = algoClientId
    ? candidates.find(
        (candidate) =>
          normalizedClientId(candidate.protectiveClientOrderId) ===
          algoClientId,
      )
    : undefined;
  const opening =
    linked ??
    candidates.reduce((latest, candidate) =>
      candidate.createdAt > latest.createdAt ? candidate : latest,
    );
  const stopLoss = positiveNumber(opening.stopLoss);
  const takeProfit = positiveNumber(opening.takeProfit);
  if (!stopLoss) return takeProfit ? "TAKE_PROFIT" : undefined;
  if (!takeProfit) return "STOP_LOSS";

  const stopDistance = Math.abs(exitPrice - stopLoss) / stopLoss;
  const takeDistance = Math.abs(exitPrice - takeProfit) / takeProfit;
  return stopDistance <= takeDistance ? "STOP_LOSS" : "TAKE_PROFIT";
}
