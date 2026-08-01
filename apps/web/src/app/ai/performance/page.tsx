"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

interface Metrics { total: number; directionalDecisions: number; winRate: number; accuracy: number; averageReturn: number; maxDrawdown: number; confidenceAccuracyCorrelation: number | null; decisionDistribution: { LONG: number; SHORT: number; WAIT: number }; }
interface Record { id: string; runId: string; symbol: string; horizon: string; decision: string; confidence: number; priceAtDecision: number; priceAfter: number; outcome: string; returnPct: number; evaluatedAt: string; }
interface Alert { kind: string; severity: string; message: string; }

export default function PerformancePage() {
  const metrics = useQuery({ queryKey: ["performance-metrics"], queryFn: () => apiRequest<Metrics>("/ai/performance/metrics"), refetchInterval: 60_000 });
  const records = useQuery({ queryKey: ["performance-records"], queryFn: () => apiRequest<Record[]>("/ai/performance"), refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: ["performance-alerts"], queryFn: () => apiRequest<Alert[]>("/ai/performance/alerts"), refetchInterval: 60_000 });
  const cards = [["Accuracy", `${metrics.data?.accuracy ?? 0}%`], ["Win rate", `${metrics.data?.winRate ?? 0}%`], ["Average virtual return", `${metrics.data?.averageReturn ?? 0}%`], ["Max simulated drawdown", `${metrics.data?.maxDrawdown ?? 0}%`]];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">Decision performance</h1><p className="mt-1 text-muted-foreground">Virtual evaluation only. No orders or funds are involved.</p></div><Link className="text-primary hover:underline" href="/ai/reflection">Reflection →</Link></div>
    {!!alerts.data?.length && <div className="space-y-2">{alerts.data.map((alert) => <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm" key={alert.kind}><span className="font-semibold">{alert.kind}</span> · {alert.message}</div>)}</div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <div className="rounded-lg border bg-card p-5" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>
    <div className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Decision distribution</h2><p className="mt-2 text-sm text-muted-foreground">LONG {metrics.data?.decisionDistribution.LONG ?? 0} · SHORT {metrics.data?.decisionDistribution.SHORT ?? 0} · WAIT {metrics.data?.decisionDistribution.WAIT ?? 0} · Confidence/accuracy correlation {metrics.data?.confidenceAccuracyCorrelation ?? "insufficient data"}</p></div>
    <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>{["Decision", "Horizon", "Prices", "Outcome", "Virtual return", "Evaluated"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody className="divide-y">{records.data?.map((record) => <tr key={record.id}><td className="p-3 font-semibold">{record.decision}<div className="text-xs text-muted-foreground">{record.symbol} · {record.confidence}%</div></td><td className="p-3">{record.horizon}</td><td className="p-3 font-mono text-xs">{record.priceAtDecision} → {record.priceAfter}</td><td className="p-3">{record.outcome}</td><td className={`p-3 ${record.returnPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{record.returnPct}%</td><td className="p-3 text-muted-foreground">{new Date(record.evaluatedAt).toLocaleString()}</td></tr>)}</tbody></table>{!records.data?.length && <p className="p-8 text-center text-muted-foreground">No completed horizon evaluations yet.</p>}</div>
  </div>;
}
