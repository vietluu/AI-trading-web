"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

interface Run { id: string; symbol: string; provider: string; status: string; decision?: string; confidence?: number; durationMs?: number; trigger: string; errorCode?: string; createdAt: string; }
interface Response { data: Run[]; total: number; }
export default function PipelineRunsPage() {
  const query = useQuery({ queryKey: ["pipeline-runs"], queryFn: () => apiRequest<Response>("/pipeline-runs?limit=50") , refetchInterval: 5000 });
  return <div className="space-y-6"><div className="flex justify-between"><div><h1 className="text-3xl font-bold">Pipeline runs</h1><p className="mt-1 text-muted-foreground">End-to-end runtime history and outcomes.</p></div><Link className="text-primary hover:underline" href="/ai/pipeline">Automation →</Link></div>
    <div className="overflow-hidden rounded-lg border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>{["Run", "Status", "Decision", "Confidence", "Trigger", "Duration", "Created"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody className="divide-y">{query.data?.data.map((run) => <tr key={run.id} className="hover:bg-muted/40"><td className="p-3"><Link className="font-mono text-primary hover:underline" href={`/ai/pipeline-runs/${run.id}`}>{run.id.slice(0, 8)}</Link><div className="text-xs text-muted-foreground">{run.symbol} · {run.provider}</div></td><td className="p-3 font-semibold">{run.status}</td><td className="p-3">{run.decision ?? "—"}</td><td className="p-3">{run.confidence == null ? "—" : `${run.confidence}%`}</td><td className="p-3">{run.trigger}</td><td className="p-3">{run.durationMs == null ? "—" : `${run.durationMs}ms`}</td><td className="p-3 text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{!query.data?.data.length && <p className="p-8 text-center text-muted-foreground">No pipeline runs yet.</p>}</div>
  </div>;
}
