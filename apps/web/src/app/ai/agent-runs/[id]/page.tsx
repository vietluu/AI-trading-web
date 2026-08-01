"use client";

import { use } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";

interface AgentRunDetail {
  id: string;
  agentType: string;
  agentVersion: number;
  status: string;
  invocationSource: string;
  provider?: string;
  model?: string;
  inputHash: string;
  sanitizedInput?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  failureCode?: string;
  safeFailureMessage?: string;
  traceId?: string;
  correlationId?: string;
  createdAt: string;
}

interface Transition {
  id: string;
  fromState: string;
  toState: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export default function AgentRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const runId = resolvedParams.id;

  const { data: run, isLoading } = useQuery<AgentRunDetail>({
    queryKey: ["agent-run-detail", runId],
    queryFn: async (): Promise<AgentRunDetail> => {
      const res = await fetch(`/api/agent-runs/${runId}`);
      if (!res.ok) throw new Error("Failed to fetch run details");
      const payload = (await res.json()) as AgentRunDetail;
      return payload;
    },
  });

  const { data: transitions = [] } = useQuery<Transition[]>({
    queryKey: ["agent-run-transitions", runId],
    queryFn: async (): Promise<Transition[]> => {
      const res = await fetch(`/api/agent-runs/${runId}/transitions`);
      if (!res.ok) return [];
      const payload = (await res.json()) as Transition[];
      return payload;
    },
  });

  const cancelMutation = useMutation<unknown, Error, void>({
    mutationFn: async (): Promise<unknown> => {
      const res = await fetch(`/api/agent-runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to cancel run");
      const payload = (await res.json()) as unknown;
      return payload;
    },
  });

  if (isLoading) {
    return <div className="container mx-auto p-6 text-center text-muted-foreground">Loading run detail...</div>;
  }

  if (!run) {
    return <div className="container mx-auto p-6 text-center text-muted-foreground">Run not found</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <Link href="/ai/agent-runs" className="text-xs text-primary hover:underline font-mono mb-1 inline-block">
            &larr; Back to Runs
          </Link>
          <h1 className="text-2xl font-bold tracking-tight font-mono">Run: {run.id}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {run.agentType} <span className="font-mono text-xs">v{run.agentVersion}</span>
          </p>
        </div>

        {run.status !== "COMPLETED" && run.status !== "FAILED" && run.status !== "CANCELLED" && (
          <button
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="px-4 py-2 bg-destructive text-destructive-foreground text-sm font-medium rounded-md hover:bg-destructive/90 transition-colors"
          >
            {cancelMutation.isPending ? "Cancelling..." : "Cancel Run"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="border rounded-lg p-5 bg-card space-y-4">
            <h3 className="font-semibold text-lg">Execution Output</h3>
            {run.output ? (
              <pre className="bg-muted p-4 rounded text-xs font-mono overflow-x-auto max-h-96">
                {JSON.stringify(run.output, null, 2)}
              </pre>
            ) : run.safeFailureMessage ? (
              <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded text-sm font-mono">
                Error ({run.failureCode}): {run.safeFailureMessage}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No output produced yet.</p>
            )}
          </div>

          <div className="border rounded-lg p-5 bg-card space-y-4">
            <h3 className="font-semibold text-lg">State Transitions Timeline</h3>
            <div className="space-y-3">
              {transitions.map((t) => (
                <div key={t.id} className="flex items-center gap-3 text-xs border-b pb-2">
                  <span className="font-mono text-muted-foreground">
                    {new Date(t.createdAt).toLocaleTimeString()}
                  </span>
                  <span className="font-mono font-semibold bg-muted px-2 py-0.5 rounded">
                    {t.fromState} &rarr; {t.toState}
                  </span>
                  <span className="text-muted-foreground">{t.reason}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="border rounded-lg p-5 bg-card space-y-3 text-sm">
            <h3 className="font-semibold text-base border-b pb-2">Run Metadata</h3>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status:</span>
              <span className="font-semibold font-mono">{run.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Source:</span>
              <span className="font-mono text-xs">{run.invocationSource}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider:</span>
              <span className="font-mono text-xs">{run.provider || "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model:</span>
              <span className="font-mono text-xs">{run.model || "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Duration:</span>
              <span className="font-mono text-xs">{run.durationMs ? `${run.durationMs}ms` : "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prompt Tokens:</span>
              <span className="font-mono text-xs">{run.inputTokens}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completion Tokens:</span>
              <span className="font-mono text-xs">{run.outputTokens}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. Cost:</span>
              <span className="font-mono text-xs">${Number(run.estimatedCost).toFixed(5)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
