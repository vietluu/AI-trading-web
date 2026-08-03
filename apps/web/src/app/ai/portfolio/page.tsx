"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";

interface PortfolioDashboard {
  source: {
    mode: string;
    kind: "EXCHANGE";
    environment: string;
    available: boolean;
    stale: boolean;
    syncedAt: string | null;
    connectionCount: number;
  };
  config: {
    maxStrategies: number;
    maxTotalExposure: number;
    maxStrategyExposure: number;
    maxDrawdown: number;
  };
  portfolio: {
    equity: number;
    pnl: number;
    grossExposure: number;
    exposurePct: number;
    drawdownPct: number;
    failsafeActive: boolean;
    pnlKind: string;
  };
  strategies: Array<{
    id: string;
    key: string;
    name: string;
    type: string;
    kind: string;
    symbols: string[];
    status: string;
    disabledReason: string | null;
    allocation: { weight: number; allocatedCapital: number };
    performance: null | {
      totalTrades: number;
      source: string;
      winRate: number | null;
      returnPct: number | null;
      drawdownPct: number | null;
      sharpeRatio: number | null;
      realizedPnl: number;
      unrealizedPnl: number;
    };
    exposure: number;
  }>;
  aggregation: Array<{
    symbol: string;
    longNotional: number;
    shortNotional: number;
    grossNotional: number;
    netNotional: number;
    strategyCount: number;
  }>;
  riskEvents: Array<{
    id: string;
    symbol: string;
    side: string;
    approved: boolean;
    reason: string | null;
    requestedNotional: number;
    approvedNotional: number;
    createdAt: string;
  }>;
  unassignedExposure: number;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;
const optionalPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : percent(value);

export default function PortfolioPage(): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["portfolio-dashboard"],
    queryFn: () => apiRequest<PortfolioDashboard>("/ai/portfolio"),
    refetchInterval: 15_000,
  });
  const rebalance = useMutation({
    mutationFn: () => apiRequest("/ai/portfolio/rebalance", { method: "POST" }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["portfolio-dashboard"] }),
  });
  const status = useMutation({
    mutationFn: ({ key, next }: { key: string; next: string }) =>
      apiRequest(`/ai/portfolio/strategies/${key}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["portfolio-dashboard"] }),
  });
  if (query.isLoading)
    return <p className="text-muted-foreground">Loading strategy portfolio…</p>;
  if (query.isError)
    return (
      <p className="text-red-400" role="alert">
        {query.error.message}
      </p>
    );
  if (!query.data)
    return <p className="text-muted-foreground">Portfolio unavailable.</p>;
  const {
    config,
    source,
    portfolio,
    strategies,
    aggregation,
    riskEvents,
    unassignedExposure,
  } = query.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Strategy portfolio</h1>
          <p className="mt-1 text-muted-foreground">
            Exchange-synchronized {source.environment} portfolio data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-3 py-2 text-xs font-semibold ${source.kind === "EXCHANGE" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300"}`}
          >
            {source.mode} · {source.kind}
          </span>
          <button
            className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={rebalance.isPending || !source.available}
            onClick={() => rebalance.mutate()}
          >
            {rebalance.isPending ? "Rebalancing…" : "Rebalance now"}
          </button>
        </div>
      </div>
      {!source.available && source.kind === "EXCHANGE" && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          No synchronized exchange account snapshot is available. Portfolio
          values are intentionally not replaced with demo capital. Verify an
          enabled exchange connection and run Sync.
        </div>
      )}
      {source.stale && source.available && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          Exchange data is stale. Last synchronized{" "}
          {source.syncedAt
            ? new Date(source.syncedAt).toLocaleString()
            : "unknown"}
          .
        </div>
      )}
      {unassignedExposure > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          {money.format(unassignedExposure)} of real exchange exposure is not
          attributed to a strategy. Positions opened before this upgrade remain
          visible but are not assigned retroactively.
        </div>
      )}
      {portfolio.failsafeActive && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Portfolio failsafe is active. New strategy trades are paused.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Portfolio equity", money.format(portfolio.equity)],
          [
            portfolio.pnlKind === "EXCHANGE_MARK_TO_MARKET"
              ? "Exchange PnL"
              : "Realized PnL",
            money.format(portfolio.pnl),
          ],
          [
            "Exposure",
            `${percent(portfolio.exposurePct)} / ${percent(config.maxTotalExposure)}`,
          ],
          [
            "Drawdown",
            `${percent(portfolio.drawdownPct)} / ${percent(config.maxDrawdown)}`,
          ],
        ].map(([label, value]) => (
          <div className="rounded-lg border bg-card p-5" key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Strategies</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {strategies.map((strategy) => (
            <article
              className="rounded-lg border bg-card p-5"
              key={strategy.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{strategy.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {strategy.type} · {strategy.kind.replaceAll("_", " ")}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${strategy.status === "ACTIVE" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}
                >
                  {strategy.status}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Metric
                  label="Allocation"
                  value={percent(strategy.allocation.weight)}
                />
                <Metric
                  label="Capital"
                  value={money.format(strategy.allocation.allocatedCapital)}
                />
                <Metric
                  label="Return"
                  value={optionalPercent(strategy.performance?.returnPct)}
                />
                <Metric
                  label="Drawdown"
                  value={optionalPercent(strategy.performance?.drawdownPct)}
                />
                <Metric
                  label="Win rate"
                  value={optionalPercent(strategy.performance?.winRate)}
                />
                <Metric
                  label="Exposure"
                  value={money.format(strategy.exposure)}
                />
              </div>
              <button
                className="mt-4 w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                disabled={status.isPending || strategy.status === "DISABLED"}
                onClick={() =>
                  status.mutate({
                    key: strategy.key,
                    next: strategy.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                  })
                }
              >
                {strategy.status === "ACTIVE" ? "Pause" : "Activate"}
              </button>
            </article>
          ))}
        </div>
      </section>
      <DataTable
        title="Net exposure"
        headings={["Symbol", "Strategies", "Long", "Short", "Gross", "Net"]}
        empty="No strategy positions."
      >
        {aggregation.map((item) => (
          <tr key={item.symbol}>
            <td className="p-3 font-semibold">{item.symbol}</td>
            <td className="p-3">{item.strategyCount}</td>
            <td className="p-3 text-emerald-400">
              {money.format(item.longNotional)}
            </td>
            <td className="p-3 text-red-400">
              {money.format(item.shortNotional)}
            </td>
            <td className="p-3">{money.format(item.grossNotional)}</td>
            <td className="p-3 font-semibold">
              {money.format(item.netNotional)}
            </td>
          </tr>
        ))}
      </DataTable>
      <DataTable
        title="Portfolio risk decisions"
        headings={[
          "Symbol",
          "Side",
          "Status",
          "Requested",
          "Approved",
          "Reason",
          "Time",
        ]}
        empty="No portfolio risk decisions yet."
      >
        {riskEvents.map((item) => (
          <tr key={item.id}>
            <td className="p-3 font-semibold">{item.symbol}</td>
            <td className="p-3">{item.side}</td>
            <td
              className={`p-3 font-semibold ${item.approved ? "text-emerald-400" : "text-red-400"}`}
            >
              {item.approved ? "APPROVED" : "REJECTED"}
            </td>
            <td className="p-3">{money.format(item.requestedNotional)}</td>
            <td className="p-3">{money.format(item.approvedNotional)}</td>
            <td className="p-3 text-xs">
              {item.reason?.replaceAll("_", " ") ?? "Within limits"}
            </td>
            <td className="p-3 text-xs text-muted-foreground">
              {new Date(item.createdAt).toLocaleString()}
            </td>
          </tr>
        ))}
      </DataTable>
      {(rebalance.error || status.error) && (
        <p className="text-sm text-red-400" role="alert">
          {(rebalance.error ?? status.error)?.message}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function DataTable({
  title,
  headings,
  empty,
  children,
}: {
  title: string;
  headings: string[];
  empty: string;
  children: React.ReactNode;
}) {
  const populated = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              {headings.map((heading) => (
                <th className="p-3" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">{children}</tbody>
        </table>
        {!populated && (
          <p className="p-8 text-center text-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  );
}
