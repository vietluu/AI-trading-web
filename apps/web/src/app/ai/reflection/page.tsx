"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

interface Reflection { summary: string; accuracy: number; strengths: string[]; weaknesses: string[]; patterns: string[]; suggestions: string[]; generatedAt: string; recordCount: number; ready: boolean; }
interface Insight { id: string; summary: string; category: string; severity: string; createdAt: string; }
interface Proposal { id: string; description: string; proposedChange: string; status: string; createdAt: string; }

export default function ReflectionPage() {
  const client = useQueryClient();
  const reflection = useQuery({ queryKey: ["reflection"], queryFn: () => apiRequest<Reflection>("/ai/reflection") });
  const insights = useQuery({ queryKey: ["reflection-insights"], queryFn: () => apiRequest<Insight[]>("/ai/reflection/insights") });
  const proposals = useQuery({ queryKey: ["reflection-proposals"], queryFn: () => apiRequest<Proposal[]>("/ai/reflection/proposals") });
  const run = useMutation({ mutationFn: () => apiRequest<Reflection>("/ai/reflection/run", { method: "POST" }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["reflection"] }); void client.invalidateQueries({ queryKey: ["reflection-insights"] }); } });
  const propose = useMutation({ mutationFn: (suggestion: string) => apiRequest<Proposal>("/ai/reflection/proposals", { method: "POST", body: JSON.stringify({ description: suggestion, proposedChange: suggestion }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["reflection-proposals"] }) });
  const review = useMutation({ mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) => apiRequest<Proposal>(`/ai/reflection/proposals/${id}/review`, { method: "PATCH", body: JSON.stringify({ status, confirmed: true }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["reflection-proposals"] }) });
  const data = reflection.data;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">Reflection</h1><p className="mt-1 text-muted-foreground">Evidence-based suggestions with human-controlled review.</p></div><div className="flex gap-3"><Link className="text-primary hover:underline" href="/ai/performance">Performance</Link><button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={run.isPending || !data?.ready} onClick={() => run.mutate()}>Generate reflection</button></div></div>
    <div className="rounded-lg border bg-card p-6"><p className="text-sm text-muted-foreground">{data?.recordCount ?? 0} evaluated records · {data?.accuracy ?? 0}% accuracy</p><p className="mt-3 text-lg">{data?.summary ?? "Loading reflection…"}</p>{data && !data.ready && <p className="mt-3 text-sm text-amber-300">More records are required before suggestions are generated.</p>}</div>
    <div className="grid gap-4 lg:grid-cols-2">{[["Strengths", data?.strengths], ["Weaknesses", data?.weaknesses], ["Patterns", data?.patterns]].map(([title, values]) => <section className="rounded-lg border bg-card p-5" key={title as string}><h2 className="font-semibold">{title}</h2><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{(values as string[] | undefined)?.map((value) => <li key={value}>• {value}</li>) || <li>None yet.</li>}</ul></section>)}
      <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Suggestions — never auto-applied</h2><div className="mt-3 space-y-3">{data?.suggestions.map((suggestion) => <div className="flex items-start justify-between gap-3 text-sm" key={suggestion}><span className="text-muted-foreground">{suggestion}</span><button className="shrink-0 text-primary hover:underline" onClick={() => propose.mutate(suggestion)}>Create proposal</button></div>)}</div></section></div>
    <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Improvement proposals</h2><p className="mt-1 text-xs text-muted-foreground">Approval records human validation only; it never changes weights, models, or execution behavior.</p><div className="mt-4 space-y-3">{proposals.data?.map((proposal) => <div className="rounded border p-3" key={proposal.id}><div className="flex flex-wrap justify-between gap-2"><p className="text-sm">{proposal.description}</p><span className="text-xs font-semibold">{proposal.status}</span></div>{proposal.status === "PENDING" && <div className="mt-3 flex gap-3"><button className="text-sm text-emerald-400" onClick={() => review.mutate({ id: proposal.id, status: "APPROVED" })}>Approve</button><button className="text-sm text-red-400" onClick={() => review.mutate({ id: proposal.id, status: "REJECTED" })}>Reject</button></div>}</div>)}</div></section>
    <section><h2 className="font-semibold">Stored insights</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{insights.data?.map((insight) => <div className="rounded-lg border bg-card p-4" key={insight.id}><p className="text-xs font-semibold text-muted-foreground">{insight.category} · {insight.severity}</p><p className="mt-2 text-sm">{insight.summary}</p></div>)}</div></section>
  </div>;
}
