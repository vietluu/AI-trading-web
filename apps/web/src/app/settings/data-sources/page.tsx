"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AccountNav } from "@/components/account-nav";
import { apiRequest } from "@/lib/api-client";

interface ExternalSource {
  id: string;
  sourceId: string;
  displayName: string;
  provider: string;
  sourceType: string;
  feedUrl: string;
  isEnabled: boolean;
  reliabilityScore: number;
  lastFetchedAt?: string;
  lastError?: string;
}

interface SocialProviderInfo {
  provider: string;
  displayName: string;
  status: string;
  notes?: string;
}

interface TestSourceResult {
  sourceId: string;
  itemsFetched: number;
  sampleTitle: string;
}

export default function DataSourcesSettingsPage() {
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [reliabilityScore, setReliabilityScore] = useState(70);

  // Test source feedback
  const [testResult, setTestResult] = useState<TestSourceResult | null>(null);

  const { data: sources, isLoading } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      return apiRequest<ExternalSource[]>("/external-data/sources");
    },
  });

  const { data: socialProviders } = useQuery({
    queryKey: ["social-providers"],
    queryFn: async () => {
      return apiRequest<SocialProviderInfo[]>("/external-data/social/providers");
    },
  });

  const addSourceMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<unknown>("/external-data/sources", {
        method: "POST",
        body: JSON.stringify({
          sourceId,
          displayName,
          feedUrl,
          reliabilityScore,
        }),
      });
    },
    onSuccess: () => {
      setIsAddModalOpen(false);
      setSourceId("");
      setDisplayName("");
      setFeedUrl("");
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  const testSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<TestSourceResult>(`/external-data/sources/${id}/test`, {
        method: "POST",
      });
    },
    onSuccess: (res) => {
      setTestResult(res);
    },
  });

  const toggleSourceMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      return apiRequest<unknown>(`/external-data/sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <AccountNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">External Data Sources</h1>
          <p className="text-sm text-muted-foreground">
            Manage public RSS/Atom feeds, exchange announcement channels, and external API providers.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Add RSS Feed
        </button>
      </div>

      {testResult && (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
          <div className="flex items-center justify-between mb-1 font-semibold">
            <span>Test Successful for {testResult.sourceId}</span>
            <button onClick={() => setTestResult(null)} className="hover:underline">Dismiss</button>
          </div>
          <p>Fetched {testResult.itemsFetched} items. Sample: &quot;{testResult.sampleTitle}&quot;</p>
        </div>
      )}

      {/* Configured Sources List */}
      <div className="mb-8 rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold tracking-tight mb-4">Configured Feeds & Sources</h2>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading sources...</div>
        ) : !sources || sources.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No custom sources configured.</div>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {sources.map((src) => (
              <div key={src.id} className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{src.displayName}</span>
                    <span className="font-mono text-muted-foreground">({src.sourceId})</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{src.provider}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-muted-foreground text-[11px] truncate max-w-md">{src.feedUrl}</p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    Reliability: <strong className="text-foreground">{src.reliabilityScore}</strong>/100
                  </span>

                  <button
                    onClick={() => { testSourceMutation.mutate(src.id); }}
                    className="rounded border border-border px-2.5 py-1 font-medium hover:bg-muted"
                  >
                    Test Fetch
                  </button>

                  <button
                    onClick={() => { toggleSourceMutation.mutate({ id: src.id, isEnabled: !src.isEnabled }); }}
                    className={`rounded px-3 py-1 font-semibold ${
                      src.isEnabled ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {src.isEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Social & Premium Integrations */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold tracking-tight mb-2">Social & Community Data Providers</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Integrations require user-owned credentials stored safely through Phase 2 encryption.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {socialProviders?.map((p) => (
            <div key={p.provider} className="rounded-md border border-border p-4 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{p.displayName}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                    p.status === "AVAILABLE"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : p.status === "NOT_CONFIGURED"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <p className="text-muted-foreground">{p.notes || "Configure API keys in Security settings to enable ingestion."}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Add Feed Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-bold tracking-tight mb-4">Add Custom RSS / Atom Feed</h2>

            <div className="space-y-4 text-xs">
              <div>
                <label className="mb-1 block font-medium">Source Identifier (e.g. coindesk-news)</label>
                <input
                  type="text"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">Feed URL (HTTP/HTTPS only, SSRF protected)</label>
                <input
                  type="url"
                  placeholder="https://example.com/rss.xml"
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">Source Reliability Score ({reliabilityScore}/100)</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={reliabilityScore}
                  onChange={(e) => setReliabilityScore(parseInt(e.target.value, 10))}
                  className="w-full accent-primary"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-md border border-border px-4 py-2 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                disabled={!sourceId || !displayName || !feedUrl || addSourceMutation.isPending}
                onClick={() => { addSourceMutation.mutate(); }}
                className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addSourceMutation.isPending ? "Validating..." : "Add Source"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
