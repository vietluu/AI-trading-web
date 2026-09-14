"use client";

import { useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import {
  usePerformanceDashboard,
  useRecoveryCohortComparison,
} from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { useExchangeSymbols } from "@/hooks/useExchangeSymbols";

export default function PerformancePage() {
  const { t } = useTranslation();
  const { symbols: dynamicSymbols } = useExchangeSymbols();
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const symbols = ["", ...dynamicSymbols];
  const { metrics, records, alerts } = usePerformanceDashboard(selectedSymbol);
  const recoveryQuery = useRecoveryCohortComparison(
    selectedSymbol
      ? `BINANCE_FUTURES:${selectedSymbol}:15m:RECOVERY_RECLAIM:IMMATURE`
      : undefined,
  );
  const cards = [
    [t.ai.accuracy, `${metrics.data?.accuracy ?? 0}%`],
    [t.ai.winRate, `${metrics.data?.winRate ?? 0}%`],
    [t.ai.averageVirtualReturn, `${metrics.data?.averageReturn ?? 0}%`],
    [t.ai.maxSimulatedDrawdown, `${metrics.data?.maxDrawdown ?? 0}%`],
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t.ai.performanceTitle}</h1>
          <p className="mt-1 text-muted-foreground">
            {t.ai.performanceSubtitle}
          </p>
        </div>
        <Link
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-primary/40 bg-primary/15 px-3.5 py-2 text-xs font-semibold text-primary transition-all hover:bg-primary/25"
          href={ROUTES.ai.reflection}
        >
          <span>{t.ai.performanceLink}</span>
        </Link>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.ai.symbolFilter}
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={selectedSymbol}
            onChange={(event) => setSelectedSymbol(event.target.value)}
          >
            <option value="">{t.ai.allSymbols}</option>
            {symbols.filter(Boolean).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!!alerts.data?.length && (
        <div className="space-y-2">
          {alerts.data.map((alert) => (
            <div
              className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm"
              key={alert.kind}
            >
              <span className="font-semibold">{alert.kind}</span> ·{" "}
              {alert.message}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div className="rounded-lg border bg-card p-5" key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-semibold">{t.ai.decisionDistribution}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          LONG {metrics.data?.decisionDistribution.LONG ?? 0} · SHORT{" "}
          {metrics.data?.decisionDistribution.SHORT ?? 0} · WAIT{" "}
          {metrics.data?.decisionDistribution.WAIT ?? 0} · Confidence/accuracy
          correlation{" "}
          {metrics.data?.confidenceAccuracyCorrelation ?? "insufficient data"}
        </p>
      </div>

      {/* Recovery Cohort Holdout Comparison (Simulated Shadow vs Realized Control) */}
      <div
        className="rounded-lg border bg-card p-5 space-y-4"
        data-testid="recovery-cohort-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>Recovery Cohort Comparison</span>
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/20">
                Simulated Shadow Evidence
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Read-only holdout evaluation between Control (Realized) and Candidate (Shadow Simulation).
            </p>
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            Cohort: {recoveryQuery.data?.cohortKey ?? "Loading..."}
          </div>
        </div>

        {recoveryQuery.data && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Control Column */}
            <div className="rounded-md border border-border/80 bg-background/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Control (Realized)</span>
                <span className="text-xs font-mono text-muted-foreground">
                  Samples: {recoveryQuery.data.control.metrics.sampleSize}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  Win Rate:{" "}
                  {(recoveryQuery.data.control.metrics.winRate * 100).toFixed(1)}%
                </div>
                <div>
                  Profit Factor: {recoveryQuery.data.control.metrics.profitFactor}
                </div>
                <div>
                  Mean Net R: {recoveryQuery.data.control.metrics.meanNetR}R
                </div>
                <div>
                  LCB Net R:{" "}
                  {recoveryQuery.data.control.metrics.lowerConfidenceBoundNetR}R
                </div>
                <div>
                  Max Drawdown: {recoveryQuery.data.control.metrics.maxDrawdown}
                </div>
                <div>
                  Stop-first Rate:{" "}
                  {(
                    recoveryQuery.data.control.metrics.stopBeforeTargetRate * 100
                  ).toFixed(1)}
                  %
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                Exclusions:{" "}
                {recoveryQuery.data.control.metrics.exclusions.totalExcluded}{" "}
                (Dup:{" "}
                {recoveryQuery.data.control.metrics.exclusions.duplicateCount},
                Inc:{" "}
                {recoveryQuery.data.control.metrics.exclusions.incompleteCount})
              </div>
            </div>

            {/* Candidate Column */}
            <div className="rounded-md border border-border/80 bg-background/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm">Candidate (Shadow)</span>
                  <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    Simulated
                  </span>
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  Samples: {recoveryQuery.data.candidate.metrics.sampleSize}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  Win Rate:{" "}
                  {(recoveryQuery.data.candidate.metrics.winRate * 100).toFixed(1)}%
                </div>
                <div>
                  Profit Factor:{" "}
                  {recoveryQuery.data.candidate.metrics.profitFactor}
                </div>
                <div>
                  Mean Net R: {recoveryQuery.data.candidate.metrics.meanNetR}R
                </div>
                <div>
                  LCB Net R:{" "}
                  {recoveryQuery.data.candidate.metrics.lowerConfidenceBoundNetR}R
                </div>
                <div>
                  Max Drawdown: {recoveryQuery.data.candidate.metrics.maxDrawdown}
                </div>
                <div>
                  2x Cost Resilient:{" "}
                  {recoveryQuery.data.candidate.metrics.sensitivity
                    .doubledCostResilient
                    ? "Yes"
                    : "No"}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                Folds: {recoveryQuery.data.candidate.walkForwardFolds.length} ·
                Calibration: {recoveryQuery.data.candidate.calibrationQuality}
              </div>
            </div>
          </div>
        )}

        {/* Promotion Eligibility Gates (Read-Only) */}
        {recoveryQuery.data && (
          <div className="rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">
                Promotion Eligibility (Read-Only Guard):
              </span>
              <span
                className={`font-semibold px-2 py-0.5 rounded text-xs ${
                  recoveryQuery.data.candidate.promotionEligibility.eligible
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                }`}
              >
                {recoveryQuery.data.candidate.promotionEligibility.eligible
                  ? "ELIGIBLE"
                  : "LOCKED (FAIL CLOSED)"}
              </span>
            </div>
            {recoveryQuery.data.candidate.promotionEligibility.reasons.length >
              0 && (
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <span className="font-medium">Active Blockers:</span>
                <ul className="list-disc list-inside text-red-400/80 text-[11px] space-y-0.5">
                  {recoveryQuery.data.candidate.promotionEligibility.reasons.map(
                    (r) => (
                      <li key={r}>{r}</li>
                    ),
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">

        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              {[
                t.ai.decision,
                t.ai.symbol,
                t.ai.horizon,
                t.ai.prices,
                t.ai.outcome,
                t.ai.virtualReturn,
                t.ai.leverage,
                t.ai.netRoe,
                t.ai.evaluated,
              ].map((h) => (
                <th className="p-3" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.data?.map((record) => (
              <tr key={record.id}>
                <td className="p-3 font-semibold">
                  {record.decision}
                  <div className="text-xs text-muted-foreground">
                    score {record.confidence}/100
                  </div>
                </td>
                <td className="p-3 font-medium">{record.symbol}</td>
                <td className="p-3">
                  {record.horizon}
                  {record.strategyKey && (
                    <div className="text-xs text-muted-foreground">{record.strategyKey}</div>
                  )}
                </td>
                <td className="p-3 font-mono text-xs">
                  {record.priceAtDecision} → {record.priceAfter}
                </td>
                <td className="p-3">{record.outcome}</td>
                <td
                  className={`p-3 ${record.returnPct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {record.returnPct}%
                </td>
                <td className="p-3">
                  {record.leverage}x
                  <div className="text-xs text-muted-foreground">
                    {record.leverageSource}
                  </div>
                </td>
                <td
                  className={`p-3 ${record.netRoePct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {record.netRoePct}%
                </td>
                <td className="p-3 text-muted-foreground">
                  {new Date(record.evaluatedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!records.data?.length && (
          <p className="p-8 text-center text-muted-foreground">
            {t.ai.noCompletedEvaluations}
          </p>
        )}
      </div>
    </div>
  );
}
