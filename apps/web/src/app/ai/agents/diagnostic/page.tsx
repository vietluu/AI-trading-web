"use client";

import { useEffect, useMemo, useState } from "react";
import { useSystemDiagnostic, type DiagnosticRunResult } from "@/hooks/ai/useAiFeature";
import { useConfiguredTradingScope } from '@/hooks/useConfiguredTradingScope';

export default function SystemDiagnosticPage() {
  const scope = useConfiguredTradingScope();
  const symbols = useMemo(() => scope.data?.symbols ?? [], [scope.data?.symbols]);
  const [symbol, setSymbol] = useState("");
  const [provider, setProvider] = useState("OPENAI");
  useEffect(() => {
    if (!symbol && symbols[0]) setSymbol(symbols[0]);
  }, [symbol, symbols]);

  const runMutation = useSystemDiagnostic(symbol, provider);
  const runData: DiagnosticRunResult | undefined = runMutation.data;

  const errorMessage = runMutation.error instanceof Error ? runMutation.error.message : "Diagnostic run failed";

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Diagnostic Agent</h1>
        <p className="text-muted-foreground mt-1">
          Execute the internal non-trading diagnostic agent to verify context, prompt, tool, and model pipelines
        </p>
      </div>

      <div className="border rounded-lg p-6 bg-card max-w-xl space-y-4">
        <h2 className="text-lg font-semibold">Run Configuration</h2>

        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Target Symbol</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-background border rounded px-3 py-2 text-sm font-mono"
          >
            {!symbol && <option value="">No symbol selected</option>}
            {symbols.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">AI Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full bg-background border rounded px-3 py-2 text-sm"
          >
            <option value="OPENAI">OpenAI</option>
            <option value="ANTHROPIC">Anthropic</option>
            <option value="GEMINI">Google Gemini</option>
            <option value="OLLAMA">Ollama (Local)</option>
          </select>
        </div>

        <button
          onClick={() => runMutation.mutate(undefined)}
          disabled={!symbol || runMutation.isPending}
          className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
        >
          {runMutation.isPending ? "Executing Diagnostic Agent..." : "Run Diagnostic Agent"}
        </button>

        {runMutation.isError && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 rounded text-sm">
            {errorMessage}
          </div>
        )}
      </div>

      {runMutation.isSuccess && runData && (
        <div className="border rounded-lg p-6 bg-card space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <h2 className="text-lg font-semibold">Diagnostic Execution Result</h2>
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded bg-green-500/15 text-green-600">
              {runData.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono bg-muted p-3 rounded">
            <div>
              <span className="text-muted-foreground block">Run ID</span>
              <span className="font-semibold">{runData.id.slice(0, 8)}...</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Duration</span>
              <span className="font-semibold">{runData.durationMs}ms</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Tokens</span>
              <span className="font-semibold">
                {runData.inputTokens + runData.outputTokens}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Data Quality</span>
              <span className="font-semibold">{runData.output?.dataQuality || "N/A"}</span>
            </div>
          </div>

          {runData.output && (
            <div className="space-y-4 pt-2">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-1">Executive Summary</h3>
                <p className="text-sm border p-3 rounded bg-background">{runData.output.summary}</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-1">Key Observations</h3>
                <ul className="list-disc list-inside text-sm space-y-1 border p-3 rounded bg-background">
                  {runData.output.observations.map((obs, idx) => (
                    <li key={idx}>{obs}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-1">Tools Invoked</h3>
                <div className="flex flex-wrap gap-1.5 border p-3 rounded bg-background">
                  {runData.output.usedTools.map((tool) => (
                    <span key={tool} className="text-xs font-mono bg-accent px-2 py-0.5 rounded">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
