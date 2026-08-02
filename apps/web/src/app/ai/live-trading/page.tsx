"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";

interface Dashboard {
  mode: string;
  globalTradingEnabled: boolean;
  liveTradingEnabled: boolean;
  connections: Array<{ id: string; provider: string; environment: string; displayName: string | null; isEnabled: boolean; isVerified: boolean }>;
  accounts: Array<{ connectionId: string; totalEquity: number; availableBalance: number; unrealizedPnl: number; marginBalance: number; syncedAt: string }>;
  positions: Array<{ id: string; connectionId: string; symbol: string; side: string; quantity: number; entryPrice: number; markPrice: number | null; liquidationPrice: number | null; leverage: number | null; unrealizedPnl: number; syncedAt: string }>;
  orders: Array<{ id: string; orderId: string | null; clientOrderId: string; provider: string; environment: string; symbol: string; side: string; size: number; price: number | null; status: string; purpose: string; errorCode: string | null; createdAt: string }>;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function LiveTradingPage(): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["live-trading"], queryFn: () => apiRequest<Dashboard>("/ai/live-trading"), refetchInterval: 15_000 });
  const sync = useMutation({
    mutationFn: (connectionId: string) => apiRequest("/ai/live-trading/sync", { method: "POST", body: JSON.stringify({ connectionId }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["live-trading"] }),
  });
  const kill = useMutation({
    mutationFn: () => apiRequest("/ai/live-trading/kill-switch", { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["live-trading"] }),
  });
  if (query.isLoading) return <p className="text-muted-foreground">Loading exchange execution state…</p>;
  if (query.isError) return <p className="text-red-400" role="alert">{query.error.message}</p>;
  const data = query.data;
  if (!data) return <p className="text-muted-foreground">Execution state unavailable.</p>;
  const totals = data.accounts.reduce((value, account) => ({ equity: value.equity + account.totalEquity, available: value.available + account.availableBalance, pnl: value.pnl + account.unrealizedPnl }), { equity: 0, available: 0, pnl: 0 });
  const openOrders = data.orders.filter((order) => ["SUBMITTING", "NEW", "PARTIALLY_FILLED"].includes(order.status));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold">Live trading</h1><p className="mt-1 text-muted-foreground">Exchange-backed execution with mandatory risk approval and idempotent client order IDs.</p></div><div className="flex items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${data.mode === "LIVE" ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300"}`}>{data.mode}</span><button className="rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-50" disabled={!data.globalTradingEnabled || kill.isPending} onClick={() => kill.mutate()}>{kill.isPending ? "Stopping…" : "Kill switch"}</button></div></div>
    {!data.globalTradingEnabled && <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">Global trading is disabled. All new orders are blocked immediately; read-only synchronization remains available.</div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Equity", money.format(totals.equity)], ["Available", money.format(totals.available)], ["Unrealized PnL", money.format(totals.pnl)], ["Open orders", String(openOrders.length)]].map(([label, value]) => <div className="rounded-lg border bg-card p-5" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>
    <section><h2 className="mb-3 text-lg font-semibold">Connections</h2><div className="grid gap-3 md:grid-cols-2">{data.connections.map((connection) => <div className="flex items-center justify-between rounded-lg border bg-card p-4" key={connection.id}><div><p className="font-semibold">{connection.displayName ?? connection.provider}</p><p className="text-xs text-muted-foreground">{connection.environment} · {connection.isVerified ? "verified" : "not verified"} · {connection.isEnabled ? "enabled" : "disabled"}</p></div><button className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" disabled={!connection.isEnabled || !connection.isVerified || sync.isPending} onClick={() => sync.mutate(connection.id)}>Sync</button></div>)}</div>{!data.connections.length && <p className="rounded-lg border p-6 text-center text-muted-foreground">Configure a futures exchange connection first.</p>}</section>
    <Table title="Positions" headings={["Symbol", "Side", "Size", "Entry / Mark", "Leverage", "PnL", "Liquidation"]} empty="No exchange positions.">{data.positions.map((position) => <tr key={position.id}><td className="p-3 font-semibold">{position.symbol}</td><td className={`p-3 ${position.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{position.side}</td><td className="p-3 font-mono">{position.quantity}</td><td className="p-3 font-mono text-xs">{position.entryPrice} / {position.markPrice ?? "—"}</td><td className="p-3">{position.leverage ? `${position.leverage}×` : "—"}</td><td className={`p-3 ${position.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money.format(position.unrealizedPnl)}</td><td className="p-3 font-mono text-xs">{position.liquidationPrice ?? "—"}</td></tr>)}</Table>
    <Table title="Open orders" headings={["Order", "Symbol", "Side", "Size", "Price", "Status"]} empty="No open exchange orders.">{openOrders.map((order) => <OrderRow order={order} key={order.id} />)}</Table>
    <Table title="Trade history" headings={["Order", "Symbol", "Side", "Size", "Price", "Status"]} empty="No execution history.">{data.orders.map((order) => <OrderRow order={order} key={order.id} />)}</Table>
    {(sync.error || kill.error) && <p className="text-sm text-red-400" role="alert">{(sync.error ?? kill.error)?.message}</p>}
  </div>;
}

function Table({ title, headings, empty, children }: { title: string; headings: string[]; empty: string; children: React.ReactNode }): React.JSX.Element {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section><h2 className="mb-3 text-lg font-semibold">{title}</h2><div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>{headings.map((heading) => <th className="p-3" key={heading}>{heading}</th>)}</tr></thead><tbody className="divide-y">{children}</tbody></table>{!hasRows && <p className="p-8 text-center text-muted-foreground">{empty}</p>}</div></section>;
}

function OrderRow({ order }: { order: Dashboard["orders"][number] }): React.JSX.Element {
  return <tr><td className="p-3 font-mono text-xs">{order.orderId ?? order.clientOrderId}<div className="text-muted-foreground">{order.purpose}</div></td><td className="p-3 font-semibold">{order.symbol}</td><td className={order.side === "BUY" ? "p-3 text-emerald-400" : "p-3 text-red-400"}>{order.side}</td><td className="p-3 font-mono">{order.size}</td><td className="p-3 font-mono">{order.price ?? "market"}</td><td className="p-3">{order.status}{order.errorCode && <div className="text-xs text-red-400">{order.errorCode}</div>}</td></tr>;
}
