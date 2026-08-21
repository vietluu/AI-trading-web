export interface LiveAccountMetric {
  totalEquity: number;
  availableBalance: number;
  unrealizedPnl: number;
}

export interface LivePositionMetric {
  unrealizedPnl: number;
}

export function calculateLiveTradingTotals(
  accounts: LiveAccountMetric[],
  positions: LivePositionMetric[],
) {
  const accountUpl = accounts.reduce(
    (sum, account) => sum + account.unrealizedPnl,
    0,
  );
  return {
    equity: accounts.reduce((sum, account) => sum + account.totalEquity, 0),
    available: accounts.reduce(
      (sum, account) => sum + account.availableBalance,
      0,
    ),
    pnl:
      positions.length > 0
        ? positions.reduce((sum, position) => sum + position.unrealizedPnl, 0)
        : accountUpl,
  };
}
