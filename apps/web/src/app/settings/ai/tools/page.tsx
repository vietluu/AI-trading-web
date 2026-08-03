"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ToolDefinitionDto, ToolHealthDto, ToolInvocationRecordDto, ToolResultDto } from "@platform/shared";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

export default function AIToolsSettingsPage() {
  const [selectedTool, setSelectedTool] = useState<string>("market.ticker.get");
  const [testArguments, setTestArguments] = useState<string>('{\n  "symbol": "BTC-USDT"\n}');
  const [executionOutput, setExecutionOutput] = useState<ToolResultDto | null>(null);

  // Fetch registered tools
  const { data: tools, isLoading: isLoadingTools } = useQuery<ToolDefinitionDto[]>({
    queryKey: ["ai-tools-list"],
    queryFn: () => apiRequest<ToolDefinitionDto[]>("/ai/tools", { headers: { Accept: "application/json" } }),
  });

  // Fetch tools health
  const { data: health } = useQuery<ToolHealthDto[]>({
    queryKey: ["ai-tools-health"],
    queryFn: () => apiRequest<ToolHealthDto[]>("/ai/tools/health", { headers: { Accept: "application/json" } }),
    refetchInterval: 10000,
  });

  // Fetch invocation history
  const { data: history, refetch: refetchHistory } = useQuery<ToolInvocationRecordDto[]>({
    queryKey: ["ai-tools-history"],
    queryFn: () => apiRequest<ToolInvocationRecordDto[]>("/ai/tools/history?limit=30", { headers: { Accept: "application/json" } }),
  });

  // Execute manual tool test
  const testMutation = useMutation({
    mutationFn: async ({ name, args }: { name: string; args: Record<string, unknown> }) => {
      return apiRequest<ToolResultDto>(`/ai/tools/${name}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    },
    onSuccess: (data: ToolResultDto) => {
      setExecutionOutput(data);
      void refetchHistory();
    },
  });

  const handleRunTest = () => {
    try {
      const parsed = JSON.parse(testArguments) as Record<string, unknown>;
      testMutation.mutate({ name: selectedTool, args: parsed });
    } catch {
      alert("Invalid JSON in tool test arguments");
    }
  };

  const getHealthForTool = (name: string) => {
    return health?.find((h) => h.name === name);
  };

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-7xl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Tool Calling Framework Diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            Monitor registered safe tools, policy controls, provider mappers, and tool invocation history.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/ai"
            className="px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted transition-colors"
          >
            ← Back to AI Provider Settings
          </Link>
        </div>
      </div>

      {/* Catalog Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <span>Registered AI Tools</span>
          <span className="text-xs font-normal text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
            {tools?.length || 0} Safe Tools
          </span>
        </h2>

        {isLoadingTools ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading tool catalog...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools?.map((tool) => {
              const h = getHealthForTool(tool.name);
              return (
                <div key={tool.name} className="p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-all flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-xs font-semibold text-primary">{tool.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold ${tool.sideEffect === "NONE" || tool.sideEffect === "READ_ONLY" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400"}`}>
                        {tool.sideEffect}
                      </span>
                    </div>
                    <h3 className="font-medium text-sm text-foreground">{tool.displayName}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{tool.description}</p>
                  </div>

                  <div className="pt-2 border-t border-border/50 text-[11px] space-y-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Category: <strong className="text-foreground">{tool.category}</strong></span>
                      <span>Sensitivity: <strong className="text-foreground">{tool.sensitivity}</strong></span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Latency: <strong className="text-foreground">{h?.averageLatencyMs ?? 0}ms</strong></span>
                      <span>Success: <strong className="text-emerald-400">{h?.successRatePct ?? 100}%</strong></span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual Sandbox & Invocation History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sandbox */}
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <h3 className="text-base font-semibold text-foreground">Read-Only Tool Test Sandbox</h3>
          <p className="text-xs text-muted-foreground">
            Simulate a policy-controlled tool invocation in development mode.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Select Tool</label>
              <select
                value={selectedTool}
                onChange={(e) => setSelectedTool(e.target.value)}
                className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
              >
                {tools?.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.displayName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">JSON Arguments</label>
              <textarea
                rows={4}
                value={testArguments}
                onChange={(e) => setTestArguments(e.target.value)}
                className="w-full font-mono text-xs rounded-md border border-border bg-background p-2 text-foreground"
              />
            </div>

            <button
              onClick={handleRunTest}
              disabled={testMutation.isPending}
              className="w-full py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {testMutation.isPending ? "Executing Tool..." : "Run Tool Invocation"}
            </button>
          </div>

          {executionOutput && (
            <div className="space-y-2 pt-3 border-t border-border">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-foreground">Result Payload</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${executionOutput.status === "SUCCESS" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                  {executionOutput.status} ({executionOutput.metadata.durationMs}ms)
                </span>
              </div>
              <pre className="font-mono text-[11px] p-3 rounded-md bg-muted text-foreground overflow-x-auto max-h-48">
                {JSON.stringify(executionOutput.data || executionOutput.error, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* History */}
        <div className="p-5 rounded-xl border border-border bg-card space-y-4">
          <h3 className="text-base font-semibold text-foreground">Recent Tool Invocation History</h3>

          {history && history.length > 0 ? (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="pb-2">Tool</th>
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Latency</th>
                    <th className="pb-2">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-muted/50 transition-colors">
                      <td className="py-2 font-mono text-foreground font-medium">{h.toolName}</td>
                      <td className="py-2 text-muted-foreground">{h.invocationSource}</td>
                      <td className="py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${h.status === "SUCCESS" ? "text-emerald-400" : "text-red-400"}`}>
                          {h.status}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">{h.durationMs}ms</td>
                      <td className="py-2 text-muted-foreground">{h.estimatedResultTokens} tok</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No recent tool executions recorded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
