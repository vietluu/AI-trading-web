export interface ClosedTradeCycleInput {
  id?: string;
  connectionId?: string;
  strategyId?: string | null;
  symbol?: string;
  side?: string;
  positionSide?: string | null;
  quantity?: unknown;
  entryPrice?: unknown;
  grossPnl?: unknown;
  fee?: unknown;
  netPnl: unknown;
  returnPct: number | null;
  sourceDataComplete?: boolean;
  openedAt?: Date | null;
  closedAt?: Date;
}

export interface ClosedTradeCycle {
  tradeIds: string[];
  strategyId: string | null;
  symbol: string;
  positionSide: string;
  quantity: number;
  grossPnl: number;
  fee: number;
  netPnl: number;
  returnPct: number | null;
  sourceDataComplete: boolean;
  openedAt: Date | null;
  closedAt: Date | null;
}

/** Combines partial TP/SL/imported closing orders from the same opening order. */
export function aggregateClosedTradeCycles(
  trades: ClosedTradeCycleInput[],
): ClosedTradeCycle[] {
  const cycles = new Map<string, ClosedTradeCycle & { entryNotional: number }>();

  trades.forEach((trade, index) => {
    const openedAt = trade.openedAt ?? null;
    const symbol = trade.symbol ?? "UNKNOWN";
    const positionSide = trade.positionSide ?? trade.side ?? "UNKNOWN";
    const key = openedAt
      ? [
          trade.connectionId ?? "UNKNOWN",
          trade.strategyId ?? "UNASSIGNED",
          symbol,
          positionSide,
          openedAt.toISOString(),
        ].join(":")
      : `unmatched:${trade.id ?? index}`;
    const quantity = finiteNumber(trade.quantity);
    const entryPrice = finiteNumber(trade.entryPrice);
    const entryNotional = quantity > 0 && entryPrice > 0
      ? quantity * entryPrice
      : 0;
    const existing = cycles.get(key);
    if (!existing) {
      cycles.set(key, {
        tradeIds: trade.id ? [trade.id] : [],
        strategyId: trade.strategyId ?? null,
        symbol,
        positionSide,
        quantity,
        grossPnl: finiteNumber(trade.grossPnl),
        fee: finiteNumber(trade.fee),
        netPnl: finiteNumber(trade.netPnl),
        returnPct: trade.returnPct,
        sourceDataComplete: trade.sourceDataComplete ?? false,
        openedAt,
        closedAt: trade.closedAt ?? null,
        entryNotional,
      });
      return;
    }

    if (trade.id) existing.tradeIds.push(trade.id);
    existing.quantity += quantity;
    existing.grossPnl += finiteNumber(trade.grossPnl);
    existing.fee += finiteNumber(trade.fee);
    existing.netPnl += finiteNumber(trade.netPnl);
    existing.entryNotional += entryNotional;
    existing.sourceDataComplete =
      existing.sourceDataComplete && (trade.sourceDataComplete ?? false);
    if (trade.closedAt && (!existing.closedAt || trade.closedAt > existing.closedAt)) {
      existing.closedAt = trade.closedAt;
    }
  });

  return [...cycles.values()].map(({ entryNotional, ...cycle }) => ({
    ...cycle,
    returnPct: entryNotional > 0
      ? cycle.netPnl / entryNotional
      : cycle.returnPct,
  }));
}

function finiteNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}
