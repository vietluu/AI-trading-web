"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";

interface Dashboard {
  mode: "SIGNAL_ONLY" | "PAPER_TRADING";
  account: { balance: number; equity: number; marginUsed: number };
  positions: Array<{ symbol: string; side: string; size: number; entryPrice: number; markPrice: number; leverage: number; unrealizedPnL: number }>;
  trades: Array<{ id: string; symbol: string; side: string; entryPrice: number; exitPrice: number; size: number; pnl: number; fee: number; closeReason: string; closedAt: string }>;
  metrics: { totalTrades: number; winRate: number; averageReturn: number; maxDrawdown: number; profitFactor: number | null; totalPnl: number };
  equityCurve: Array<{ at: string; equity: number }>;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function PaperTradingPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["paper-trading"], queryFn: () => apiRequest<Dashboard>("/ai/paper-trading"), refetchInterval: 15_000 });
  const data = query.data;
  if (query.isLoading) return <p className="text-muted-foreground">Loading simulated account…</p>;
  if (query.isError) return <p className="text-red-400" role="alert">{query.error.message}</p>;
  if (!data) return <p className="text-muted-foreground">Paper account unavailable.</p>;
  const cards = [
    ["Balance", money.format(data.account.balance)], ["Equity", money.format(data.account.equity)],
    ["Unrealized", money.format(data.account.equity - data.account.balance)], ["Margin used", money.format(data.account.marginUsed)],
    ["Total PnL", money.format(data.metrics.totalPnl)], ["Win rate", `${data.metrics.winRate}%`],
    ["Max drawdown", `${data.metrics.maxDrawdown}%`], ["Profit factor", data.metrics.profitFactor ?? "∞"],
  ];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">Paper trading</h1><p className="mt-1 text-muted-foreground">Deterministic futures simulation. No real orders, API keys, or funds are used.</p></div><span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-300">{data.mode}</span></div>
    {data.mode === "SIGNAL_ONLY" && <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm">Signal-only mode is active. Pipeline decisions are recorded, but positions are not opened.</div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <div className="rounded-lg border bg-card p-5" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>
    <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Equity curve</h2><EquityChart points={data.equityCurve} /></section>
    <section><h2 className="mb-3 text-lg font-semibold">Open positions</h2><div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>{["Symbol", "Side", "Size", "Entry / Mark", "Leverage", "Unrealized PnL"].map((heading) => <th className="p-3" key={heading}>{heading}</th>)}</tr></thead><tbody className="divide-y">{data.positions.map((position) => <tr key={position.symbol}><td className="p-3 font-semibold">{position.symbol}</td><td className={`p-3 ${position.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{position.side}</td><td className="p-3 font-mono">{position.size}</td><td className="p-3 font-mono">{position.entryPrice} / {position.markPrice}</td><td className="p-3">{position.leverage}×</td><td className={`p-3 ${position.unrealizedPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money.format(position.unrealizedPnL)}</td></tr>)}</tbody></table>{!data.positions.length && <p className="p-8 text-center text-muted-foreground">No open simulated positions.</p>}</div></section>
    <section><h2 className="mb-3 text-lg font-semibold">Trade history · {data.metrics.totalTrades} closed</h2><div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>{["Trade", "Entry / Exit", "Size", "Net result", "Close reason", "Closed"].map((heading) => <th className="p-3" key={heading}>{heading}</th>)}</tr></thead><tbody className="divide-y">{data.trades.map((trade) => <tr key={trade.id}><td className="p-3 font-semibold">{trade.symbol}<div className="text-xs text-muted-foreground">{trade.side}</div></td><td className="p-3 font-mono text-xs">{trade.entryPrice} → {trade.exitPrice}</td><td className="p-3 font-mono">{trade.size}</td><td className={`p-3 ${trade.pnl - trade.fee >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money.format(trade.pnl - trade.fee)}<div className="text-xs text-muted-foreground">fees {money.format(trade.fee)}</div></td><td className="p-3">{trade.closeReason.replaceAll("_", " ")}</td><td className="p-3 text-muted-foreground">{new Date(trade.closedAt).toLocaleString()}</td></tr>)}</tbody></table>{!data.trades.length && <p className="p-8 text-center text-muted-foreground">No closed simulated trades yet.</p>}</div></section>
  </div>;
}

function EquityChart({ points }: { points: Array<{ at: string; equity: number }> }): React.JSX.Element {
  const width = 800, height = 180, padding = 12;
  const values = points.map((point) => point.equity), minimum = Math.min(...values), maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const coordinates = points.map((point, index) => `${padding + index * (width - padding * 2) / Math.max(1, points.length - 1)},${height - padding - (point.equity - minimum) / span * (height - padding * 2)}`).join(" ");
  return <div className="mt-4"><svg aria-label="Paper account equity curve" className="h-48 w-full" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}><polyline fill="none" points={coordinates} stroke="currentColor" strokeWidth="3" className="text-sky-400" /></svg><div className="flex justify-between text-xs text-muted-foreground"><span>{money.format(minimum)}</span><span>{points.length} snapshots</span><span>{money.format(maximum)}</span></div></div>;
}
