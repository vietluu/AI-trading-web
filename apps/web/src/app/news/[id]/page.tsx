"use client";

import { use } from "react";
import Link from "next/link";
import { AccountNav } from "@/components/account-nav";
import { ROUTES } from "@/constants/routes";
import { useNewsDetail } from "@/hooks/news/useNews";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation();
  const { id } = use(params);

  const { data: article, isLoading, isError } = useNewsDetail(id);

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <AccountNav />

      <div className="mb-4">
        <Link href={ROUTES.news} className="text-xs text-primary hover:underline">
          {t.news.backToFeed}
        </Link>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t.news.detailLoading}</div>
      ) : isError || !article ? (
        <div className="py-12 text-center text-sm text-red-400">{t.news.detailError}</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-3">
              <span className="font-semibold text-foreground">{article.sourceId}</span>
              <span>•</span>
              <span>{new Date(article.publishedAt).toLocaleString()}</span>
              {article.author && (
                <>
                  <span>•</span>
                  <span>By {article.author}</span>
                </>
              )}
            </div>

            <h1 className="text-2xl font-bold tracking-tight mb-4">{article.title}</h1>

            <div className="mb-6 flex flex-wrap gap-2">
              <span className="rounded bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                Source Reliability: {article.reliabilityScore}/100
              </span>
              <span className="rounded bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400 border border-amber-500/20">
                Importance Score: {article.importanceScore}/100
              </span>
            </div>

            {article.excerpt && (
              <div className="rounded-md bg-muted/40 p-4 text-sm text-foreground mb-6">
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">{t.news.sanitizedExcerpt}</h3>
                <p className="leading-relaxed">{article.excerpt}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border">
              <div className="flex flex-wrap gap-1.5">
                {article.symbols.map((sym) => (
                  <span key={sym} className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                    ${sym}
                  </span>
                ))}
                {article.topics.map((t) => (
                  <span key={t} className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    #{t}
                  </span>
                ))}
              </div>

              <a
                href={article.canonicalUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t.news.originalSource}
              </a>
            </div>
          </div>

          {/* Importance Breakdown */}
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-sm font-semibold tracking-tight mb-3">{t.news.importanceFactors}</h2>
            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
              {article.importanceReasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>

          {/* Duplicate Sources Attributions */}
          {article.sourceReferences.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-6">
              <h2 className="text-sm font-semibold tracking-tight mb-3">
                {t.news.associatedSources} ({article.sourceReferences.length})
              </h2>
              <div className="divide-y divide-border rounded-md border border-border">
                {article.sourceReferences.map((ref) => (
                  <div key={ref.id} className="flex items-center justify-between p-3 text-xs">
                    <div>
                      <span className="font-medium text-foreground">{ref.sourceName}</span>
                      <span className="ml-2 text-muted-foreground">{new Date(ref.publishedAt).toLocaleString()}</span>
                    </div>
                    <a href={ref.canonicalUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {t.news.link}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
