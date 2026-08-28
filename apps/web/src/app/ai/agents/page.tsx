"use client";

import { useAgentHealth, useAgents } from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

import Link from "next/link";
import { Activity, RefreshCw } from "lucide-react";
import { ROUTES } from "@/constants/routes";

export default function AgentRegistryPage() {
  const { t, language } = useTranslation();
  const { data: agents = [], isLoading: loadingAgents } = useAgents();
  const { data: healthList = [], isLoading: loadingHealth, refetch: refetchHealth, isFetching: isRefreshing } = useAgentHealth();

  const getHealthForAgent = (type: string) => {
    return healthList.find((h) => h.agentType === type);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t.ai.agentsTitle}</h1>
          <p className="text-muted-foreground mt-1">{t.ai.agentsSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card/60 px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground"
            href={ROUTES.ai.diagnostic}
          >
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>{language === "vi" ? "Chẩn đoán Hệ thống" : "Diagnostics"}</span>
          </Link>
          <button
            onClick={() => refetchHealth()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/15 px-3.5 py-2 text-xs font-semibold text-primary transition hover:bg-primary/25 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>{t.ai.refreshHealth}</span>
          </button>
        </div>
      </div>

      {loadingAgents || loadingHealth ? (
        <div className="p-8 text-center text-muted-foreground">{t.ai.loadingAgents}</div>
      ) : agents.length === 0 ? (
        <div className="p-8 text-center border border-dashed rounded-lg text-muted-foreground">
          {t.ai.noAgents}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => {
            const health = getHealthForAgent(agent.type);
            const isHealthy = health?.healthStatus === "HEALTHY";
            const isDegraded = health?.healthStatus === "DEGRADED";

            return (
              <div
                key={`${agent.type}:${agent.version}`}
                className="border rounded-lg p-5 bg-card shadow-sm flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      v{agent.version}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                        isHealthy
                          ? "bg-green-500/15 text-green-600 dark:text-green-400"
                          : isDegraded
                          ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                          : "bg-red-500/15 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {health?.healthStatus || agent.status}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold mt-2">{agent.displayName}</h3>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">{agent.type}</p>
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{agent.description}</p>

                  <div className="mt-4 space-y-2 border-t pt-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.ai.executionMode}</span>
                      <span className="font-medium font-mono">{agent.executionMode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.ai.promptTemplate}</span>
                      <span className="font-medium font-mono">
                        {agent.promptId} (v{agent.promptVersion})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.ai.allowedTools}</span>
                      <span className="font-medium">{agent.allowedToolNames.length} tools</span>
                    </div>
                  </div>

                  {agent.allowedToolNames.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">{t.ai.allowedTools}</p>
                      <div className="flex flex-wrap gap-1">
                        {agent.allowedToolNames.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] font-mono bg-accent/50 text-accent-foreground px-1.5 py-0.5 rounded"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t pt-3 flex justify-between text-xs text-muted-foreground">
                  <div>
                    <span>{t.ai.successRate}</span>
                    <span className="font-semibold text-foreground">
                      {health ? `${health.successRatePct}%` : "N/A"}
                    </span>
                  </div>
                  <div>
                    <span>{t.ai.avgLatency}</span>
                    <span className="font-semibold text-foreground">
                      {health ? `${health.avgLatencyMs}ms` : "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
