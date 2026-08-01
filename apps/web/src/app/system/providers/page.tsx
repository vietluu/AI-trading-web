"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AccountNav } from "@/components/account-nav";
import { apiRequest } from "@/lib/api-client";

interface ProviderHealth {
  id: string;
  provider: string;
  status: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastItemAt?: string;
  consecutiveFailures: number;
  averageLatencyMs: number;
  lastErrorCode?: string;
  itemsFetchedTotal: number;
  itemsAcceptedTotal: number;
  updatedAt: string;
}

export default function SystemProvidersPage() {
  const queryClient = useQueryClient();

  const { data: providers, isLoading, isError, refetch } = useQuery({
    queryKey: ["provider-health"],
    queryFn: async () => {
      return apiRequest<ProviderHealth[]>("/external-data/providers/health");
    },
  });

  const triggerRunMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiRequest(`/external-data/providers/${providerId}/run`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-health"] });
    },
  });

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <AccountNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">External Provider Health & Telemetry</h1>
          <p className="text-sm text-muted-foreground">
            Realtime metrics, latency, rate limits, and failure tracking for external data ingestion.
          </p>
        </div>

        <button
          onClick={() => { void refetch(); }}
          className="rounded-md border border-border px-3.5 py-2 text-xs font-medium hover:bg-muted"
        >
          Refresh Health Status
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading provider metrics...</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-red-400">Failed to load provider health status.</div>
      ) : !providers || providers.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No provider health metrics recorded yet.</div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-3 font-semibold">Provider</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Avg Latency</th>
                  <th className="p-3 font-semibold">Consecutive Failures</th>
                  <th className="p-3 font-semibold">Items Accepted</th>
                  <th className="p-3 font-semibold">Last Attempt</th>
                  <th className="p-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {providers.map((p) => (
                  <tr key={p.provider} className="hover:bg-muted/30">
                    <td className="p-3 font-semibold font-mono text-foreground">{p.provider}</td>
                    <td className="p-3">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          p.status === "HEALTHY"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : p.status === "DEGRADED"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : p.status === "NOT_CONFIGURED"
                            ? "bg-zinc-800 text-zinc-400"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono">{p.averageLatencyMs} ms</td>
                    <td className="p-3 font-mono font-medium">
                      <span className={p.consecutiveFailures > 0 ? "text-red-400 font-bold" : "text-muted-foreground"}>
                        {p.consecutiveFailures}
                      </span>
                    </td>
                    <td className="p-3 font-mono">{p.itemsAcceptedTotal}</td>
                    <td className="p-3 font-mono text-muted-foreground">
                      {p.lastAttemptAt ? new Date(p.lastAttemptAt).toLocaleTimeString() : "-"}
                    </td>
                    <td className="p-3">
                      <button
                        disabled={p.status === "NOT_CONFIGURED" || triggerRunMutation.isPending}
                        onClick={() => { triggerRunMutation.mutate(p.provider); }}
                        className="rounded border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-40"
                      >
                        Trigger Run
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
