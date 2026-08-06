"use client";

import { useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import { usePerformanceDashboard } from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function PerformancePage() {
  const { t } = useTranslation();
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const symbols = [
    "",
    "BTC-USDT",
    "ETH-USDT",
    "SOL-USDT",
    "BNB-USDT",
    "XRP-USDT",
    "DOGE-USDT",
    "ADA-USDT",
    "AVAX-USDT",
    "LINK-USDT",
    "NEAR-USDT",
    "SUI-USDT",
  ];
  const { metrics, records, alerts } = usePerformanceDashboard(selectedSymbol);
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
          className="text-primary hover:underline"
          href={ROUTES.ai.reflection}
        >
          {t.ai.performanceLink}
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
                    {record.confidence}%
                  </div>
                </td>
                <td className="p-3 font-medium">{record.symbol}</td>
                <td className="p-3">{record.horizon}</td>
                <td className="p-3 font-mono text-xs">
                  {record.priceAtDecision} → {record.priceAfter}
                </td>
                <td className="p-3">{record.outcome}</td>
                <td
                  className={`p-3 ${record.returnPct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {record.returnPct}%
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
