"use client";

import { useState } from "react";
import Link from "next/link";
import { useAgentRuns } from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

export default function AgentRunHistoryPage() {
  const { t } = useTranslation();
  const page = 1;
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const { data, isLoading } = useAgentRuns(page, statusFilter, typeFilter);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t.ai.agentExecutionRunsTitle}</h1>
        <p className="text-muted-foreground mt-1">{t.ai.agentExecutionRunsSubtitle}</p>
      </div>

      <div className="flex gap-4 items-center bg-card p-4 border rounded-lg">
        <div className="w-48">
          <label className="text-xs font-semibold text-muted-foreground block mb-1">{t.ai.filterStatus}</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-background border rounded px-3 py-1.5 text-sm"
          >
            <option value="">{t.ai.allStatuses}</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
            <option value="RUNNING">RUNNING</option>
            <option value="QUEUED">QUEUED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>

        <div className="w-48">
          <label className="text-xs font-semibold text-muted-foreground block mb-1">{t.ai.filterAgentType}</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full bg-background border rounded px-3 py-1.5 text-sm"
          >
            <option value="">{t.ai.allAgents}</option>
            <option value="SYSTEM_DIAGNOSTIC">SYSTEM_DIAGNOSTIC</option>
            <option value="MARKET_ANALYST">MARKET_ANALYST</option>
            <option value="TECHNICAL_ANALYST">TECHNICAL_ANALYST</option>
            <option value="NEWS_ANALYST">NEWS_ANALYST</option>
            <option value="SENTIMENT_ANALYST">SENTIMENT_ANALYST</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">{t.ai.loadingRunHistory}</div>
      ) : !data || data.data.length === 0 ? (
        <div className="p-8 text-center border border-dashed rounded-lg text-muted-foreground">
          {t.ai.noRunsFound}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground text-xs uppercase">
              <tr>
                <th className="p-3">{t.ai.runIdAgent}</th>
                <th className="p-3">{t.ai.status}</th>
                <th className="p-3">{t.ai.source}</th>
                <th className="p-3">{t.ai.providerModel}</th>
                <th className="p-3">{t.ai.tokensCost}</th>
                <th className="p-3">{t.ai.duration}</th>
                <th className="p-3">{t.ai.created}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.data.map((run) => (
                <tr key={run.id} className="hover:bg-muted/50 transition-colors">
                  <td className="p-3 font-mono">
                    <Link href={`/ai/agent-runs/${run.id}`} className="text-primary font-medium hover:underline">
                      {run.id.slice(0, 8)}...
                    </Link>
                    <div className="text-xs text-muted-foreground font-sans font-semibold mt-0.5">
                      {run.agentType} <span className="font-mono text-[10px]">v{run.agentVersion}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        run.status === "COMPLETED"
                          ? "bg-green-500/15 text-green-600"
                          : run.status === "FAILED"
                          ? "bg-red-500/15 text-red-600"
                          : "bg-blue-500/15 text-blue-600"
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{run.invocationSource}</td>
                  <td className="p-3 font-mono text-xs">
                    {run.provider ? `${run.provider} / ${run.model}` : "N/A"}
                  </td>
                  <td className="p-3 font-mono text-xs">
                    <div>{run.inputTokens + run.outputTokens} tokens</div>
                    <div className="text-[10px] text-muted-foreground">${Number(run.estimatedCost).toFixed(4)}</div>
                  </td>
                  <td className="p-3 font-mono text-xs">{run.durationMs ? `${run.durationMs}ms` : "N/A"}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
