import { useMutation } from "@tanstack/react-query";

import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { QUERY_KEYS } from "@/hooks/query-keys";
import { apiRequest } from "@/lib/api-client";

interface DiagnosticResult {
  id: string;
  agentType: string;
  status: string;
  output?: {
    summary: string;
    observations: string[];
    dataQuality: string;
    usedTools: string[];
    generatedAt: string;
  };
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
}

export function useAiAgentDiagnostics() {
  return useMutation<DiagnosticResult, Error, { symbol: string; provider: string }>({
    mutationKey: QUERY_KEYS.ai.agentRuns(),
    mutationFn: ({ symbol, provider }) =>
      apiRequest<DiagnosticResult>(API_ENDPOINTS.ai.agentRun("system-diagnostic"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, provider }),
      }),
  });
}
