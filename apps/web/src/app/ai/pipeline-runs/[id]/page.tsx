"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

interface Step { id: string; stepId: string; type: string; status: string; durationMs?: number; errorCode?: string; }
interface Alert { id: string; kind: string; reasoningSummary: string; createdAt: string; }
interface Run { id: string; symbol: string; provider: string; status: string; decision?: string; confidence?: number; dataQuality?: string; skippedReason?: string; errorCode?: string; safeErrorMessage?: string; trigger: string; durationMs?: number; result?: { reasoning?: string; conflictLevel?: string }; steps: Step[]; alerts: Alert[]; }
export default function PipelineRunDetailPage() {
  const { id } = useParams<{ id: string }>(); const client = useQueryClient(); const query = useQuery({ queryKey: ["pipeline-run", id], queryFn: () => apiRequest<Run>(`/pipeline-runs/${id}`), refetchInterval: (q) => ["QUEUED", "RUNNING"].includes(q.state.data?.status ?? "") ? 3000 : false });
  const action = async (path: string, body = {}) => { await apiRequest(path, { method: "POST", body: JSON.stringify(body) }); await client.invalidateQueries({ queryKey: ["pipeline-run", id] }); };
  const run = query.data; if (!run) return <p className="text-muted-foreground">Loading pipeline run…</p>;
  return <div className="space-y-6"><div className="flex justify-between"><div><Link className="text-sm text-primary hover:underline" href="/ai/pipeline-runs">← Run history</Link><h1 className="mt-2 text-3xl font-bold">{run.symbol} pipeline</h1><p className="font-mono text-xs text-muted-foreground">{run.id}</p></div><div className="flex gap-2"><button className="rounded border px-3 py-2" onClick={() => void action(`/pipeline-runs/${id}/replay`, { mode: "REPLAY_WITH_STORED_CONTEXT" })}>Replay stored</button>{["QUEUED", "RUNNING"].includes(run.status) && <button className="rounded border border-red-500 px-3 py-2 text-red-500" onClick={() => void action(`/pipeline-runs/${id}/cancel`)}>Cancel</button>}</div></div>
    <section className="grid gap-4 md:grid-cols-5">{[["Status", run.status], ["Decision", run.decision ?? "—"], ["Confidence", run.confidence == null ? "—" : `${run.confidence}%`], ["Quality", run.dataQuality ?? "—"], ["Duration", run.durationMs == null ? "—" : `${run.durationMs}ms`]].map(([k,v]) => <div className="rounded-lg border bg-card p-4" key={k}><p className="text-xs uppercase text-muted-foreground">{k}</p><p className="mt-2 font-semibold">{v}</p></div>)}</section>
    {(run.result?.reasoning || run.skippedReason || run.errorCode) && <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Outcome</h2>{run.result?.reasoning && <p className="mt-2 text-sm">{run.result.reasoning}</p>}{run.skippedReason && <p className="mt-2 text-sm text-amber-500">Filter: {run.skippedReason}</p>}{run.errorCode && <p className="mt-2 text-sm text-red-500">{run.errorCode}: {run.safeErrorMessage}</p>}</section>}
    <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Steps</h2><div className="mt-3 space-y-2">{run.steps.map((step) => <div className="flex justify-between rounded border p-3 text-sm" key={step.id}><span>{step.stepId} <span className="text-muted-foreground">· {step.type}</span></span><span>{step.status}{step.durationMs != null ? ` · ${step.durationMs}ms` : ""}</span></div>)}</div></section>
    {!!run.alerts.length && <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Alerts</h2>{run.alerts.map((alert) => <div className="mt-3 rounded border border-amber-500/30 p-3 text-sm" key={alert.id}><strong>{alert.kind}</strong><p>{alert.reasoningSummary}</p></div>)}</section>}
  </div>;
}
