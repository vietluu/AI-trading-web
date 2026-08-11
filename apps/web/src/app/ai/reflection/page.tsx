"use client";

import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import {
  useReflectionActions,
  useReflectionData,
  useSelfLearningLifecycle,
} from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function ReflectionPage() {
  const { t } = useTranslation();
  const reflection = useReflectionData();
  const lifecycle = useSelfLearningLifecycle();
  const {
    insights,
    proposals,
    runMutation,
    createProposalMutation,
    reviewProposalMutation,
  } = useReflectionActions();
  const data = reflection.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t.ai.reflectionTitle}</h1>
          <p className="mt-1 text-muted-foreground">
            {t.ai.reflectionSubtitle}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            className="text-nowrap rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
            href={ROUTES.ai.performance}
          >
            {t.ai.reflectionLink}
          </Link>
          <button
            className="rounded-lg bg-muted-foreground px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={runMutation.isPending || !data?.ready}
            onClick={() => runMutation.mutate()}
          >
            {t.ai.generateReflection}
          </button>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {data?.recordCount ?? 0} evaluated records · {data?.accuracy ?? 0}%
          accuracy
        </p>
        <p className="mt-3 text-lg">
          {data?.summary ?? t.ai.loadingReflection}
        </p>
        {data && !data.ready && (
          <p className="mt-3 text-sm text-amber-300">
            {t.ai.moreRecordsRequired}
          </p>
        )}
      </div>
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Automated deployment lifecycle</h2>
            <p className="mt-1 text-xs text-muted-foreground">Shadow has 0% live impact; canary uses a bounded percentage before full promotion.</p>
          </div>
          <span className="rounded-full border px-3 py-1 text-xs font-bold">{lifecycle.data?.stage ?? "LOADING"}</span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {[
            ["Live version", lifecycle.data?.liveVersion ?? "-"],
            ["Candidate", lifecycle.data?.candidateVersion ?? "-"],
            ["Candidate impact", `${lifecycle.data?.candidateImpactPct ?? 0}%`],
            ["Shadow evaluated", lifecycle.data?.evidence.evaluatedShadowSignals ?? 0],
            ["Canary records", lifecycle.data?.evidence.canaryRecords ?? 0],
            ["Live records", lifecycle.data?.evidence.liveRecords ?? 0],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-semibold">{value}</p>
            </div>
          ))}
        </div>
        {lifecycle.data?.shadowPerformance && (
          <p className="mt-4 text-xs text-muted-foreground">
            Shadow: {lifecycle.data.shadowPerformance.tradesCount} outcomes · accuracy {lifecycle.data.shadowPerformance.accuracy.toFixed(2)}% · PF {lifecycle.data.shadowPerformance.profitFactor.toFixed(2)} · return {lifecycle.data.shadowPerformance.totalReturn.toFixed(4)}%
          </p>
        )}
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Actual exchange trading</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Calculated only from synchronized exchange fills, not virtual pipeline returns.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Closed trades", data?.actualTrading?.totalTrades ?? 0],
            ["Complete", data?.actualTrading?.completeTrades ?? 0],
            ["Win rate", `${data?.actualTrading?.winRate ?? 0}%`],
            ["Gross PnL", data?.actualTrading?.grossPnl ?? 0],
            ["Fees/rebates", data?.actualTrading?.fees ?? 0],
            ["Net PnL", data?.actualTrading?.netPnl ?? 0],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          [t.ai.strengths, data?.strengths],
          [t.ai.weaknesses, data?.weaknesses],
          [t.ai.patterns, data?.patterns],
        ].map(([title, values]) => (
          <section
            className="rounded-lg border bg-card p-5"
            key={title as string}
          >
            <h2 className="font-semibold">{title}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {(values as string[] | undefined)?.map((value) => (
                <li key={value}>• {value}</li>
              )) || <li>{t.ai.noneYet}</li>}
            </ul>
          </section>
        ))}
        <section className="rounded-lg border bg-card p-5">
          <h2 className="font-semibold">{t.ai.suggestions}</h2>
          <div className="mt-3 space-y-3">
            {data?.suggestions.map((suggestion) => (
              <div
                className="flex items-start justify-between gap-3 text-sm"
                key={suggestion}
              >
                <span className="text-muted-foreground">{suggestion}</span>
                <button
                  className="shrink-0 text-primary hover:underline"
                  onClick={() => createProposalMutation.mutate(suggestion)}
                >
                  {t.ai.createProposal}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="font-semibold">{t.ai.improvementProposals}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.ai.approvalNotice}
        </p>
        <div className="mt-4 space-y-3">
          {proposals.data?.map((proposal) => (
            <div className="rounded border p-3" key={proposal.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <p className="text-sm">{proposal.description}</p>
                <span className="text-xs font-semibold">{proposal.status}</span>
              </div>
              {proposal.status === "PENDING" && (
                <div className="mt-3 flex gap-3">
                  <button
                    className="text-sm text-emerald-400"
                    onClick={() =>
                      reviewProposalMutation.mutate({
                        id: proposal.id,
                        status: "APPROVED",
                      })
                    }
                  >
                    {t.ai.approve}
                  </button>
                  <button
                    className="text-sm text-red-400"
                    onClick={() =>
                      reviewProposalMutation.mutate({
                        id: proposal.id,
                        status: "REJECTED",
                      })
                    }
                  >
                    {t.ai.reject}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-semibold">{t.ai.storedInsights}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {insights.data?.map((insight) => (
            <div className="rounded-lg border bg-card p-4" key={insight.id}>
              <p className="text-xs font-semibold text-muted-foreground">
                {insight.category} · {insight.severity}
              </p>
              <p className="mt-2 text-sm">{insight.summary}</p>
            </div>
          ))}
          {!insights.data?.length && (
            <p className="text-sm text-muted-foreground">{t.ai.noInsights}</p>
          )}
        </div>
      </section>
    </div>
  );
}
