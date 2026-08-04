"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  AIConfigDto,
  AIHistoryDto,
  AIModel,
  AIProviderHealth,
  AIResponseDto,
  AIUsageDto,
} from "@platform/shared";
import { AccountNav } from "@/components/account-nav";
import { apiRequest, resolveApiUrl } from "@/lib/api-client";

export default function AISettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"telemetry" | "config" | "sandbox" | "history">("telemetry");

  // Prompt Sandbox state
  const [testPrompt, setTestPrompt] = useState("Analyze the impact of recent CPI data on BTC futures leverage.");
  const [testProvider, setTestProvider] = useState<"OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA">("GEMINI");
  const [testModel, setTestModel] = useState("gemini-3.1-flash-lite");
  const [testResponseFormat, setTestResponseFormat] = useState<"text" | "json">("text");
  const [testResult, setTestResult] = useState<AIResponseDto | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamOutput, setStreamOutput] = useState("");

  // Queries
  const providersQuery = useQuery<AIProviderHealth[]>({
    queryKey: ["ai-providers"],
    queryFn: () => apiRequest("/ai/providers"),
  });

  const modelsQuery = useQuery<AIModel[]>({
    queryKey: ["ai-models"],
    queryFn: () => apiRequest("/ai/models"),
  });

  const configQuery = useQuery<AIConfigDto>({
    queryKey: ["ai-config"],
    queryFn: () => apiRequest("/ai/config"),
  });

  const usageQuery = useQuery<AIUsageDto>({
    queryKey: ["ai-usage"],
    queryFn: () => apiRequest("/ai/usage"),
  });

  const historyQuery = useQuery<AIHistoryDto[]>({
    queryKey: ["ai-history"],
    queryFn: () => apiRequest("/ai/history?limit=30"),
  });

  // Config Update Mutation
  const updateConfigMutation = useMutation({
    mutationFn: (newConfig: Partial<AIConfigDto>) =>
      apiRequest("/ai/config", {
        method: "PUT",
        body: JSON.stringify(newConfig),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-config"] });
    },
  });

  // Prompt Test Mutation
  const testPromptMutation = useMutation({
    mutationFn: (body: {
      prompt: string;
      provider?: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
      model?: string;
      responseFormat?: "text" | "json";
    }) =>
      apiRequest<AIResponseDto>("/ai/test", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setTestResult(data);
      void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-history"] });
    },
  });

  const handleStreamPrompt = async () => {
    setIsStreaming(true);
    setStreamOutput("");
    setTestResult(null);

    try {
      const res = await fetch(resolveApiUrl("/ai/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: testPrompt,
          provider: testProvider,
          model: testModel,
        }),
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split("\n\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr === "[DONE]") break;
            try {
              const chunk = JSON.parse(dataStr) as { deltaToken?: string };
              if (chunk.deltaToken) {
                setStreamOutput((prev) => prev + chunk.deltaToken);
              }
            } catch {
              // ignore JSON error
            }
          }
        }
      }
    } catch (err) {
      console.error("Streaming failed", err);
    } finally {
      setIsStreaming(false);
      void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-history"] });
    }
  };

  return (
    <div className="container mx-auto max-w-6xl">
      <AccountNav />

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            AI Infrastructure & Provider Telemetry
          </h1>
          <p className="text-sm text-muted-foreground">
            Provider-independent LLM orchestrator, prompt engine, memory manager, token budgets, and health monitoring.
          </p>
        </div>
      </div>

      {/* Usage & Budget Banner */}
      {usageQuery.data && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">Today Cost</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              ${usageQuery.data.totalCost.toFixed(4)}
            </p>

            <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${Math.min(100, (usageQuery.data.totalCost / (usageQuery.data.dailyBudget || 1)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Limit: ${usageQuery.data.dailyBudget.toFixed(2)} / day
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">Today Tokens</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {usageQuery.data.totalTokens.toLocaleString()}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Prompt: {usageQuery.data.promptTokens.toLocaleString()} | Completion: {usageQuery.data.completionTokens.toLocaleString()}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">Requests Today</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {usageQuery.data.requestCount}
            </p>
            <p className="mt-2 text-xs text-emerald-500 font-medium">
              Budget Status: {usageQuery.data.isBlocked ? "BLOCKED" : "OK"}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">Budget Remaining</p>
            <p className="mt-1 text-2xl font-bold text-emerald-400">
              ${usageQuery.data.budgetRemaining.toFixed(2)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Daily Allowance</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("telemetry")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "telemetry"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Providers & Health
        </button>
        <button
          onClick={() => setActiveTab("config")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "config"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          User AI Settings
        </button>
        <button
          onClick={() => setActiveTab("sandbox")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "sandbox"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Prompt Sandbox
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Execution History
        </button>
      </div>

      {/* Tab 1: Telemetry */}
      {activeTab === "telemetry" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {providersQuery.data?.map((p) => (
              <div
                key={p.provider}
                className="rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-lg">
                      {p.provider}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      p.status === "HEALTHY"
                        ? "bg-emerald-500/10 text-emerald-500"
                        : p.status === "DEGRADED"
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-rose-500/10 text-rose-500"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Latency:</span>{" "}
                    <span className="font-mono text-foreground">{p.latencyMs} ms</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Models Count:</span>{" "}
                    <span className="font-mono text-foreground">{p.models.length}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Supported Models:</span>{" "}
                    <span className="font-mono text-xs text-foreground">
                      {p.models.join(", ")}
                    </span>
                  </div>
                  {p.lastError && (
                    <div className="col-span-2 text-rose-400 text-xs">
                      Error: {p.lastError}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Model Registry Matrix */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Registered Model Matrix
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3">Model</th>
                    <th className="p-3">Provider</th>
                    <th className="p-3">Context Window</th>
                    <th className="p-3">Capabilities</th>
                    <th className="p-3">Pricing (In/Out per 1k)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {modelsQuery.data?.map((m) => (
                    <tr key={m.name} className="hover:bg-muted/30">
                      <td className="p-3 font-semibold text-foreground">
                        {m.displayName} ({m.name})
                      </td>
                      <td className="p-3 font-mono">{m.provider}</td>
                      <td className="p-3 font-mono">{m.contextWindow.toLocaleString()} tokens</td>
                      <td className="p-3">
                        <div className="flex gap-1.5 flex-wrap">
                          {m.capabilities.supportsTools && (
                            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                              Tools
                            </span>
                          )}
                          {m.capabilities.supportsJSON && (
                            <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400">
                              JSON
                            </span>
                          )}
                          {m.capabilities.supportsStreaming && (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                              Stream
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-muted-foreground">
                        ${m.pricing.inputCostPer1k} / ${m.pricing.outputCostPer1k}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Config */}
      {activeTab === "config" && configQuery.data && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm max-w-2xl">
          <h2 className="text-lg font-bold text-foreground mb-4">User AI Preferences</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              updateConfigMutation.mutate({
                preferredProvider: form.get("preferredProvider") as "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA",
                preferredModel: form.get("preferredModel") as string,
                temperature: Number(form.get("temperature")),
                maxTokens: Number(form.get("maxTokens")),
                dailyBudget: Number(form.get("dailyBudget")),
                monthlyBudget: Number(form.get("monthlyBudget")),
                fallbackEnabled: form.get("fallbackEnabled") === "on",
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Preferred Provider
              </label>
              <select
                name="preferredProvider"
                defaultValue={configQuery.data.preferredProvider}
                className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
              >
                <option value="OPENAI">OpenAI</option>
                <option value="ANTHROPIC">Anthropic (Claude)</option>
                <option value="GEMINI">Google Gemini</option>
                <option value="OLLAMA">Ollama (Local Models)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Preferred Model Name
              </label>
              <input
                type="text"
                name="preferredModel"
                defaultValue={configQuery.data.preferredModel}
                className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Temperature (0.0 to 1.0)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  name="temperature"
                  defaultValue={configQuery.data.temperature}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Max Output Tokens
                </label>
                <input
                  type="number"
                  name="maxTokens"
                  defaultValue={configQuery.data.maxTokens}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Daily Budget ($)
                </label>
                <input
                  type="number"
                  step="1"
                  name="dailyBudget"
                  defaultValue={configQuery.data.dailyBudget}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Monthly Budget ($)
                </label>
                <input
                  type="number"
                  step="5"
                  name="monthlyBudget"
                  defaultValue={configQuery.data.monthlyBudget}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="fallbackEnabled"
                name="fallbackEnabled"
                defaultChecked={configQuery.data.fallbackEnabled}
                className="rounded border-border"
              />
              <label htmlFor="fallbackEnabled" className="text-xs font-medium text-foreground">
                Enable Automated Provider Fallback Cascade
              </label>
            </div>

            <button
              type="submit"
              disabled={updateConfigMutation.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {updateConfigMutation.isPending ? "Saving..." : "Save AI Settings"}
            </button>
          </form>
        </div>
      )}

      {/* Tab 3: Sandbox */}
      {activeTab === "sandbox" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Prompt Form */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-bold text-foreground mb-4">Prompt Sandbox</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Provider
                  </label>
                  <select
                    value={testProvider}
                    onChange={(e) =>
                      setTestProvider(
                        e.target.value as "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA"
                      )
                    }
                    className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  >
                    <option value="OPENAI">OpenAI</option>
                    <option value="ANTHROPIC">Anthropic (Claude)</option>
                    <option value="GEMINI">Google Gemini</option>
                    <option value="OLLAMA">Ollama (Local)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Model
                  </label>
                  <input
                    type="text"
                    value={testModel}
                    onChange={(e) => setTestModel(e.target.value)}
                    className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Response Format
                </label>
                <select
                  value={testResponseFormat}
                  onChange={(e) =>
                    setTestResponseFormat(e.target.value as "text" | "json")
                  }
                  className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                >
                  <option value="text">Text Output</option>
                  <option value="json">Structured JSON Output</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  User Prompt
                </label>
                <textarea
                  rows={5}
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  className="w-full rounded-md border border-border bg-background p-3 text-sm text-foreground font-mono"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() =>
                    testPromptMutation.mutate({
                      prompt: testPrompt,
                      provider: testProvider,
                      model: testModel,
                      responseFormat: testResponseFormat,
                    })
                  }
                  disabled={testPromptMutation.isPending || isStreaming}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {testPromptMutation.isPending ? "Executing..." : "Execute Call"}
                </button>

                <button
                  onClick={handleStreamPrompt}
                  disabled={isStreaming || testPromptMutation.isPending}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  {isStreaming ? "Streaming..." : "Stream Tokens"}
                </button>
              </div>
            </div>
          </div>

          {/* Response Output Box */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-bold text-foreground mb-4">Response Output</h2>

            {isStreaming && (
              <div className="rounded-lg bg-muted/40 p-4 font-mono text-sm text-foreground min-h-[200px] whitespace-pre-wrap">
                {streamOutput}
                <span className="inline-block animate-pulse font-bold text-emerald-400">
                  ▍
                </span>
              </div>
            )}

            {testResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-2">
                  <span>Latency: <strong className="text-foreground">{testResult.latencyMs} ms</strong></span>
                  <span>Tokens: <strong className="text-foreground">{testResult.usage.totalTokens}</strong></span>
                  <span>Cost: <strong className="text-emerald-400">${testResult.usage.estimatedCost.toFixed(6)}</strong></span>
                </div>

                <div className="rounded-lg bg-muted/40 p-4 font-mono text-sm text-foreground whitespace-pre-wrap max-h-[350px] overflow-y-auto">
                  {testResult.json ? JSON.stringify(testResult.json, null, 2) : testResult.text}
                </div>
              </div>
            )}

            {!isStreaming && !testResult && (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                Run a prompt call or token stream to preview results.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: History */}
      {activeTab === "history" && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-bold text-foreground mb-4">Past AI Execution Log</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-3">Time</th>
                  <th className="p-3">Provider / Model</th>
                  <th className="p-3">Prompt Excerpt</th>
                  <th className="p-3">Latency</th>
                  <th className="p-3">Tokens</th>
                  <th className="p-3">Est. Cost</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {historyQuery.data?.map((h) => (
                  <tr key={h.id} className="hover:bg-muted/30">
                    <td className="p-3 text-muted-foreground">
                      {new Date(h.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="p-3 font-semibold text-foreground">
                      {h.provider} / {h.model}
                    </td>
                    <td className="p-3 max-w-xs truncate text-muted-foreground">
                      {h.prompt}
                    </td>
                    <td className="p-3">{h.latencyMs} ms</td>
                    <td className="p-3">{h.totalTokens}</td>
                    <td className="p-3 text-emerald-400">${h.estimatedCost.toFixed(6)}</td>
                    <td className="p-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          h.success
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-rose-500/10 text-rose-500"
                        }`}
                      >
                        {h.success ? "SUCCESS" : "FAILED"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
