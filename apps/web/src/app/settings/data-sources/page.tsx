"use client";

import { useState } from "react";
import { AccountNav } from "@/components/account-nav";
import { LoadingButton } from "@/components/loading-button";
import { useDataSourcesSettings } from "@/hooks/settings/useSettings";
import { useTranslation } from "@/lib/i18n/i18n-context";

interface SocialProviderItem {
  provider: string;
  displayName: string;
  status: "AVAILABLE" | "NOT_CONFIGURED" | "UNAVAILABLE";
  notes?: string | null;
}

interface DataSourceItem {
  id: string;
  displayName: string;
  sourceId: string;
  provider: string;
  feedUrl: string;
  reliabilityScore: number;
  isEnabled: boolean;
}

interface TestSourceResult {
  sourceId: string;
  itemsFetched: number;
  sampleTitle: string;
}

export default function DataSourcesSettingsPage() {
  const { t } = useTranslation();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [reliabilityScore, setReliabilityScore] = useState(70);

  // Test source feedback
  const [testResult, setTestResult] = useState<TestSourceResult | null>(null);

  const { sourcesQuery, socialProvidersQuery, addSourceMutation, testSourceMutation, deleteSourceMutation, toggleSourceMutation } = useDataSourcesSettings();
  const { data: sources, isLoading } = sourcesQuery;
  const { data: socialProviders } = socialProvidersQuery;
  const normalizedSources = (sources as DataSourceItem[] | undefined) ?? [];
  const normalizedProviders = (socialProviders as SocialProviderItem[] | undefined) ?? [];

  return (
    <div className="container mx-auto max-w-5xl">
      <AccountNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.settings.dataSourcesTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {t.settings.dataSourcesSubtitle}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t.settings.addRssFeed}
        </button>
      </div>

      {testResult && (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
          <div className="flex items-center justify-between mb-1 font-semibold">
            <span>{t.settings.testSuccessful} {testResult.sourceId}</span>
            <button onClick={() => setTestResult(null)} className="hover:underline">{t.settings.dismiss}</button>
          </div>
          <p>Fetched {testResult.itemsFetched} items. Sample: &quot;{testResult.sampleTitle}&quot;</p>
        </div>
      )}

      {/* Configured Sources List */}
      <div className="mb-8 rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold tracking-tight mb-4">{t.settings.configuredFeeds}</h2>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t.settings.loadingSources}</div>
        ) : normalizedSources.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t.settings.noSourcesConfigured}</div>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {normalizedSources.map((src) => (
              <div key={src.id} className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{src.displayName}</span>
                    <span className="font-mono text-muted-foreground">({src.sourceId})</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{src.provider}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-muted-foreground text-[11px] truncate max-w-md">{src.feedUrl}</p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-muted-foreground">
                    {t.settings.reliability}: <strong className="text-foreground">{src.reliabilityScore}</strong>/100
                  </span>

                  <LoadingButton
                    loading={testSourceMutation.isPending}
                    onClick={() => { testSourceMutation.mutate({ id: src.id }); }}
                    className="rounded border border-border px-2.5 py-1 font-medium hover:bg-muted"
                  >
                    {t.settings.testFetch}
                  </LoadingButton>

                  <LoadingButton
                    loading={toggleSourceMutation.isPending}
                    onClick={() => { toggleSourceMutation.mutate({ id: src.id, isEnabled: !src.isEnabled }); }}
                    className={`rounded px-3 py-1 font-semibold ${
                      src.isEnabled ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {src.isEnabled ? t.settings.enabled : t.settings.disabled}
                  </LoadingButton>
                  <LoadingButton
                    loading={deleteSourceMutation.isPending}
                    onClick={() => { deleteSourceMutation.mutate({ id: src.id }); }}
                    className="rounded border border-red-500/20 px-2.5 py-1 font-medium text-red-600 hover:bg-red-500/10"
                  >{t.settings.delete}</LoadingButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Social & Premium Integrations */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold tracking-tight mb-2">{t.settings.socialProvidersTitle}</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t.settings.socialProvidersSubtitle}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {normalizedProviders.map((p) => (
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
              <p className="text-muted-foreground">{p.notes || t.settings.configureApiKeys}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Add Feed Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-bold tracking-tight mb-4">{t.settings.addFeedTitle}</h2>

            <div className="space-y-4 text-xs">
              <div>
                <label className="mb-1 block font-medium">{t.settings.sourceIdentifier}</label>
                <input
                  type="text"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">{t.settings.displayName}</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">{t.settings.feedUrl}</label>
                <input
                  type="url"
                  placeholder="https://example.com/rss.xml"
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium">{t.settings.reliabilityScore} ({reliabilityScore}/100)</label>
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
                onClick={() => {
                  setIsAddModalOpen(false)
                  setSourceId("");
                  setDisplayName("");
                  setFeedUrl("");
                }}
                className="rounded-md border border-border px-4 py-2 text-xs font-medium hover:bg-muted"
              >
                {t.settings.cancel}
              </button>
              <LoadingButton
                disabled={!sourceId || !displayName || !feedUrl || addSourceMutation.isPending}
                loading={addSourceMutation.isPending}
                onClick={() => { addSourceMutation.mutate({ sourceId, displayName, feedUrl, reliabilityScore }); }}
                className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addSourceMutation.isPending ? t.settings.validating : t.settings.addSource}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
