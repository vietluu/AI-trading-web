"use client";

import { useState } from "react";
import Link from "next/link";
import { AccountNav } from "@/components/account-nav";
import { LoadingButton } from "@/components/loading-button";
import { useNewsFeed } from "@/hooks/news/useNews";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { useExternalDataSocket } from "@/lib/use-external-data-socket";

export default function NewsPage() {
  const { t } = useTranslation();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [minImportance, setMinImportance] = useState<number>(0);
  const [savedOnly, setSavedOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [highImportanceAlert, setHighImportanceAlert] = useState<{
    title?: string;
    summary?: string;
  } | null>(null);

  // Realtime WebSocket high-importance subscription
  const { isConnected } = useExternalDataSocket(
    [
      { type: "high-importance-news", minimumImportance: 70 },
      { type: "news" },
    ],
    (event, data) => {
      if (event === "HIGH_IMPORTANCE_NEWS_DETECTED") {
        setHighImportanceAlert({
          title: typeof data.title === "string" ? data.title : t.news.highImportance,
          summary: typeof data.summary === "string" ? data.summary : undefined,
        });
      }
    },
  );

  const { query, saveMutation, readMutation } = useNewsFeed({
    symbolFilter,
    minImportance,
    savedOnly,
    unreadOnly,
  });
  const { data, isLoading, isError, refetch } = query;

  return (
    <div className="container mx-auto max-w-6xl">
      <AccountNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.news.title}</h1>
          <p className="text-sm text-muted-foreground">{t.news.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              isConnected ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-500/10 text-zinc-400"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"}`} />
            {isConnected ? t.news.liveStreamActive : t.news.disconnected}
          </span>
          <button
            onClick={() => { void refetch(); }}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            {t.news.refresh}
          </button>
        </div>
      </div>

      {highImportanceAlert && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs text-black font-bold">{t.news.highImportance}</span>
              <span>{highImportanceAlert.title}</span>
            </div>
            <button
              onClick={() => setHighImportanceAlert(null)}
              className="text-xs hover:underline text-amber-300"
            >
              {t.news.dismiss}
            </button>
          </div>
          {highImportanceAlert.summary && (
            <p className="mt-1 text-xs text-amber-200/80">{highImportanceAlert.summary}</p>
          )}
        </div>
      )}

      {/* Filter Controls */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.news.filterBySymbol}</label>
            <input
              type="text"
              placeholder={t.news.placeholderSymbol}
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.news.minImportance} ({minImportance})</label>
            <input
              type="range"
              min="0"
              max="100"
              step="10"
              value={minImportance}
              onChange={(e) => setMinImportance(parseInt(e.target.value, 10))}
              className="w-full accent-primary"
            />
          </div>

          <div className="flex items-center gap-4 pt-5">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={savedOnly}
                onChange={(e) => setSavedOnly(e.target.checked)}
                className="rounded border-border"
              />
              {t.news.savedOnly}
            </label>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="rounded border-border"
              />
              {t.news.unreadOnly}
            </label>
          </div>
        </div>
      </div>

      {/* Articles Feed */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t.news.loading}</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-red-400">{t.news.error}</div>
      ) : !data?.items || data.items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t.news.empty}</div>
      ) : (
        <div className="space-y-4">
          {data.items.map((article) => {
            const isRead = article.userState?.isRead;
            const isSaved = article.userState?.isSaved;

            return (
              <div
                key={article.id}
                className={`rounded-lg border bg-card p-5 transition-colors ${
                  isRead ? "border-border/60 opacity-80" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{article.sourceId}</span>
                    <span>•</span>
                    <span>{new Date(article.publishedAt).toLocaleString()}</span>
                    <span>•</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        article.importanceScore >= 90
                          ? "bg-red-500/20 text-red-400 border border-red-500/30"
                          : article.importanceScore >= 70
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      Importance {article.importanceScore}
                    </span>
                    {article.duplicateCount > 1 && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                        {article.duplicateCount} sources
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <LoadingButton
                      loading={saveMutation.isPending}
                      onClick={() => saveMutation.mutate({ id: article.id, isSaved: !isSaved })}
                      className={`text-xs hover:underline ${isSaved ? "text-amber-400 font-medium" : "text-muted-foreground"}`}
                    >
                      {isSaved ? `★ ${t.news.save}` : `☆ ${t.news.save}`}
                    </LoadingButton>

                    <LoadingButton
                      loading={readMutation.isPending}
                      onClick={() => readMutation.mutate({ id: article.id, isRead: !isRead })}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {isRead ? t.news.markUnread : t.news.markRead}
                    </LoadingButton>
                  </div>
                </div>

                <h2 className="text-base font-semibold tracking-tight hover:text-primary">
                  <Link href={`/news/${article.id}`}>{article.title}</Link>
                </h2>

                {article.summary && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{article.summary}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    {article.symbols.map((sym) => (
                      <span key={sym} className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">
                        ${sym}
                      </span>
                    ))}
                    {article.topics.map((t) => (
                      <span key={t} className="rounded bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                        #{t}
                      </span>
                    ))}
                  </div>

                  <a
                    href={article.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Original Source ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
