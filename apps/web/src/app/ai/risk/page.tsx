"use client";

import { useState } from "react";
import { useRiskDashboard } from "@/hooks/ai/useAiFeature";
import { PaginationControls } from "@/components/pagination-controls";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;

export default function RiskPage(): React.JSX.Element {
  const query = useRiskDashboard();
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  if (query.isLoading)
    return <p className="text-muted-foreground">Loading portfolio risk…</p>;
  if (query.isError)
    return (
      <p className="text-red-400" role="alert">
        {query.error.message}
      </p>
    );
  if (!query.data)
    return <p className="text-muted-foreground">Risk controls unavailable.</p>;
  const { config, portfolio, assessments } = query.data;
  const approved = assessments.filter((item) => item.approved).length;
  const rejected = assessments.length - approved;
  const cards = [
    ["Risk per trade", percent(config.riskPerTrade)],
    [
      "Portfolio exposure",
      `${percent(portfolio.exposurePct)} / ${percent(config.maxExposure)}`,
    ],
    [
      "Drawdown",
      `${percent(portfolio.drawdownPct)} / ${percent(config.maxDrawdown)}`,
    ],
    ["Open positions", `${portfolio.openPositions} / ${config.maxPositions}`],
    ["Gross exposure", money.format(portfolio.exposure)],
    ["Maximum leverage", `${config.maxLeverage}×`],
    ["Approved", String(approved)],
    ["Rejected", String(rejected)],
  ];

  const totalPages = Math.ceil(assessments.length / pageSize);
  const paginatedAssessments = assessments.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Risk management</h1>
        <p className="mt-1 text-muted-foreground">
          Mandatory pre-execution controls for trade and portfolio exposure.
        </p>
      </div>
      {portfolio.drawdownPct >= config.maxDrawdown && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          Trading is halted because the maximum drawdown limit has been reached.
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
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Risk decisions</h2>
          <span className="text-xs text-muted-foreground">
            {assessments.length} total records
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                {[
                  "Decision",
                  "Status",
                  "Risk score",
                  "Size / leverage",
                  "SL / TP",
                  "Reason",
                  "Time",
                ].map((heading) => (
                  <th className="p-3" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {paginatedAssessments.map((item) => (
                <tr key={item.id}>
                  <td className="p-3 font-semibold">
                    {item.symbol}
                    <div className="text-xs text-muted-foreground">
                      {item.decision} · score {item.confidence}/100
                    </div>
                  </td>
                  <td
                    className={`p-3 font-semibold ${item.approved ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {item.approved ? "APPROVED" : "REJECTED"}
                  </td>
                  <td className="p-3">{item.riskScore.toFixed(1)} / 100</td>
                  <td className="p-3 font-mono text-xs">
                    {item.positionSize ?? "—"} /{" "}
                    {item.leverage ? `${item.leverage}×` : "—"}
                  </td>
                  <td className="p-3 font-mono text-xs">
                    {item.stopLoss ?? "—"} / {item.takeProfit ?? "—"}
                  </td>
                  <td className="p-3 text-xs">
                    {item.reason?.replaceAll("_", " ") ?? "Within limits"}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!assessments.length && (
            <p className="p-8 text-center text-muted-foreground">
              No trade risk assessments yet.
            </p>
          )}
          <PaginationControls
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            totalItems={assessments.length}
            totalPages={totalPages}
          />
        </div>
      </section>
    </div>
  );
}
