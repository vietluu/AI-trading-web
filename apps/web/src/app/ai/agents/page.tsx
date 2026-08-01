"use client";

import { useQuery } from "@tanstack/react-query";

interface AgentDefinition {
  type: string;
  version: number;
  displayName: string;
  description: string;
  status: string;
  executionMode: string;
  promptId: string;
  promptVersion: number;
  allowedToolNames: string[];
  requiredCapabilities: string[];
}

interface AgentHealth {
  agentType: string;
  version: number;
  status: string;
  healthStatus: string;
  reasons: string[];
  avgLatencyMs: number;
  successRatePct: number;
  totalRuns: number;
  activeRuns: number;
}

export default function AgentRegistryPage() {
  const { data: agents = [], isLoading: loadingAgents } = useQuery<AgentDefinition[]>({
    queryKey: ["agents"],
    queryFn: async (): Promise<AgentDefinition[]> => {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      const payload = (await res.json()) as AgentDefinition[];
      return payload;
    },
  });

  const { data: healthList = [], isLoading: loadingHealth, refetch: refetchHealth } = useQuery<AgentHealth[]>({
    queryKey: ["agents-health"],
    queryFn: async (): Promise<AgentHealth[]> => {
      const res = await fetch("/api/agents/health");
      if (!res.ok) throw new Error("Failed to fetch health status");
      const payload = (await res.json()) as AgentHealth[];
      return payload;
    },
  });

  const getHealthForAgent = (type: string) => {
    return healthList.find((h) => h.agentType === type);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Multi-Agent Framework</h1>
          <p className="text-muted-foreground mt-1">
            Registered agent definitions, capability bounds, and health diagnostics
          </p>
        </div>
        <button
          onClick={() => refetchHealth()}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
        >
          Refresh Health
        </button>
      </div>

      {loadingAgents || loadingHealth ? (
        <div className="p-8 text-center text-muted-foreground">Loading registered agents...</div>
      ) : agents.length === 0 ? (
        <div className="p-8 text-center border border-dashed rounded-lg text-muted-foreground">
          No agent definitions registered yet.
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
                      <span className="text-muted-foreground">Execution Mode:</span>
                      <span className="font-medium font-mono">{agent.executionMode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Prompt Template:</span>
                      <span className="font-medium font-mono">
                        {agent.promptId} (v{agent.promptVersion})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Allowed Tools:</span>
                      <span className="font-medium">{agent.allowedToolNames.length} tools</span>
                    </div>
                  </div>

                  {agent.allowedToolNames.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Allowed Tools:</p>
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
                    <span>Success Rate: </span>
                    <span className="font-semibold text-foreground">
                      {health ? `${health.successRatePct}%` : "N/A"}
                    </span>
                  </div>
                  <div>
                    <span>Avg Latency: </span>
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
