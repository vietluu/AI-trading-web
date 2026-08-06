"use client";

import { use } from "react";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import { useAgentActions, useAgentRunDetail, useAgentRunTransitions } from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function AgentRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation();
  const resolvedParams = use(params);
  const runId = resolvedParams.id;

  const { data: run, isLoading } = useAgentRunDetail(runId);
  const { data: transitions = [] } = useAgentRunTransitions(runId);
  const { cancelMutation } = useAgentActions();

  if (isLoading) {
    return <div className="container mx-auto p-6 text-center text-muted-foreground">{t.ai.loadingRunDetail}</div>;
  }

  if (!run) {
    return <div className="container mx-auto p-6 text-center text-muted-foreground">{t.ai.runNotFound}</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <Link href={ROUTES.ai.agentRuns} className="text-xs text-primary hover:underline font-mono mb-1 inline-block">
            &larr; {t.ai.backToRuns}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight font-mono">Run: {run.id}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {run.agentType} <span className="font-mono text-xs">v{run.agentVersion}</span>
          </p>
        </div>

        {run.status !== "COMPLETED" && run.status !== "FAILED" && run.status !== "CANCELLED" && (
          <button
            onClick={() => cancelMutation.mutate(runId)}
            disabled={cancelMutation.isPending}
            className="px-4 py-2 bg-destructive text-destructive-foreground text-sm font-medium rounded-md hover:bg-destructive/90 transition-colors"
          >
            {cancelMutation.isPending ? t.ai.cancelling : t.ai.cancelRun}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="border rounded-lg p-5 bg-card space-y-4">
            <h3 className="font-semibold text-lg">{t.ai.executionOutput}</h3>
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
            <h3 className="font-semibold text-lg">{t.ai.stateTransitionsTimeline}</h3>
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
            <h3 className="font-semibold text-base border-b pb-2">{t.ai.runMetadata}</h3>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.ai.status}:</span>
              <span className="font-semibold font-mono">{run.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.ai.source}:</span>
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
              <span className="text-muted-foreground">{t.ai.duration}:</span>
              <span className="font-mono text-xs">{run.durationMs ? `${run.durationMs}ms` : "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.ai.promptTokens}</span>
              <span className="font-mono text-xs">{run.inputTokens}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.ai.completionTokens}</span>
              <span className="font-mono text-xs">{run.outputTokens}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.ai.estimatedCost}</span>
              <span className="font-mono text-xs">${Number(run.estimatedCost).toFixed(5)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
