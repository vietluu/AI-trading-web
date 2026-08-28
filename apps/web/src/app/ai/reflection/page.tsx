"use client";

import { useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import {
  useLiveEligibilityReview,
  useReflectionActions,
  useReflectionData,
  useSelfLearningLifecycle,
} from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function ReflectionPage() {
  const { t } = useTranslation();
  const reflection = useReflectionData();
  const lifecycle = useSelfLearningLifecycle();
  const liveReviewMutation = useLiveEligibilityReview();
  const [confirmed, setConfirmed] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    insights,
    proposals,
    runMutation,
    createProposalMutation,
    reviewProposalMutation,
  } = useReflectionActions();
  const data = reflection.data;
  const candidate = lifecycle.data?.eligibleCandidate;

  const handleApprove = async () => {
    if (!candidate) return;
    setErrorMessage(null);
    try {
      await liveReviewMutation.mutateAsync({
        action: "APPROVE",
        version: candidate.version,
        configurationHash: candidate.configurationHash,
        confirmed: true,
      });
      setConfirmed(false);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to approve strategy version",
      );
    }
  };

  const handleReject = async () => {
    if (!candidate) return;
    setErrorMessage(null);
    try {
      await liveReviewMutation.mutateAsync({
        action: "REJECT",
        version: candidate.version,
        configurationHash: candidate.configurationHash,
        confirmed: true,
        reason: rejectReason.trim() || undefined,
      });
      setConfirmed(false);
      setRejectReason("");
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to reject candidate",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t.ai.reflectionTitle}</h1>
          <p className="mt-1 text-muted-foreground">
            {t.ai.reflectionSubtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-primary/40 bg-primary/15 px-3.5 py-2 text-xs font-semibold text-primary transition-all hover:bg-primary/25"
            href={ROUTES.ai.performance}
          >
            <span>{t.ai.reflectionLink}</span>
          </Link>
          <button
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-card/60 px-3.5 py-2 text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-muted disabled:opacity-50"
            disabled={runMutation.isPending || !data?.ready}
            onClick={() => runMutation.mutate()}
          >
            <span>{t.ai.generateReflection}</span>
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

      {candidate && (
        <div className="rounded-lg border border-emerald-500/40 bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-emerald-400">
                LIVE Promotion Candidate Review
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Version {candidate.version} · Hash:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {candidate.configurationHash.slice(0, 16)}...
                </code>
              </p>
            </div>
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
              LIVE_ELIGIBLE
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2">Eligibility Gate Metric</th>
                  <th className="pb-2">Observed Value</th>
                  <th className="pb-2">Threshold</th>
                  <th className="pb-2">Gate Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                <tr>
                  <td className="py-2 font-medium">Out-of-Sample Accuracy</td>
                  <td className="py-2">{(candidate.metrics.outOfSampleAccuracy * 100).toFixed(1)}%</td>
                  <td className="py-2 text-muted-foreground">&ge; 55.0%</td>
                  <td className="py-2 font-semibold text-emerald-400">
                    {candidate.metrics.outOfSampleAccuracy >= 0.55 ? "PASS" : "FAIL"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-medium">Expectancy</td>
                  <td className="py-2">{candidate.metrics.expectancy.toFixed(4)}</td>
                  <td className="py-2 text-muted-foreground">&gt; 0.0000</td>
                  <td className="py-2 font-semibold text-emerald-400">
                    {candidate.metrics.expectancy > 0 ? "PASS" : "FAIL"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-medium">Profit Factor</td>
                  <td className="py-2">{candidate.metrics.profitFactor.toFixed(2)}</td>
                  <td className="py-2 text-muted-foreground">&ge; 1.30</td>
                  <td className="py-2 font-semibold text-emerald-400">
                    {candidate.metrics.profitFactor >= 1.3 ? "PASS" : "FAIL"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-medium">Sharpe Ratio</td>
                  <td className="py-2">{candidate.metrics.sharpeRatio.toFixed(2)}</td>
                  <td className="py-2 text-muted-foreground">&ge; 0.50</td>
                  <td className="py-2 font-semibold text-emerald-400">
                    {candidate.metrics.sharpeRatio >= 0.5 ? "PASS" : "FAIL"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-medium">Maximum Drawdown</td>
                  <td className="py-2">{candidate.metrics.maxDrawdownPct.toFixed(1)}%</td>
                  <td className="py-2 text-muted-foreground">&le; 10.0%</td>
                  <td className="py-2 font-semibold text-emerald-400">
                    {candidate.metrics.maxDrawdownPct <= 10.0 ? "PASS" : "FAIL"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-medium">Completed Shadow Trades</td>
                  <td className="py-2">{candidate.metrics.shadowTrades}</td>
                  <td className="py-2 text-muted-foreground">&ge; 100</td>
                  <td className="py-2 font-semibold text-emerald-400">
                    {candidate.metrics.shadowTrades >= 100 ? "PASS" : "FAIL"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-medium">Completed Canary Trades</td>
                  <td className="py-2">{candidate.metrics.canaryTrades}</td>
                  <td className="py-2 text-muted-foreground">&ge; 100</td>
                  <td className="py-2 font-semibold text-emerald-400">
                    {candidate.metrics.canaryTrades >= 100 ? "PASS" : "FAIL"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 rounded bg-muted/40 p-3">
            <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border text-primary focus:ring-primary"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I confirm promoting strategy version <strong>v{candidate.version}</strong> (hash: {candidate.configurationHash.slice(0, 10)}...) to LIVE trading.
              </span>
            </label>
          </div>

          {errorMessage && (
            <p className="mt-3 text-xs font-medium text-red-400">
              Error: {errorMessage}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!confirmed || liveReviewMutation.isPending}
              onClick={handleApprove}
            >
              {liveReviewMutation.isPending ? "Promoting..." : `Approve Version ${candidate.version} for LIVE`}
            </button>
            <input
              type="text"
              className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Rejection reason (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <button
              className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-40"
              disabled={liveReviewMutation.isPending}
              onClick={handleReject}
            >
              Reject Candidate
            </button>
          </div>
        </div>
      )}

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
