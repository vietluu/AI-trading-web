import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AIConfigDto, AIHistoryDto, AIModel, AIProviderHealth, AIResponseDto, AIUsageDto } from "@platform/shared";
import { QUERY_KEYS } from "@/hooks/query-keys";
import {
  getAIConfig,
  getAIHistory,
  getAIModels,
  getAIProviders,
  getAIToolHistory,
  getAITools,
  getAIToolsHealth,
  getAIUsage,
  testAIRequest,
  testAITool,
  updateAIConfig,
} from "@/services/ai-settings.service";

export function useAIProviders() {
  return useQuery<AIProviderHealth[]>({
    queryKey: QUERY_KEYS.ai.providers,
    queryFn: () => getAIProviders(),
  });
}

export function useAIModels() {
  return useQuery<AIModel[]>({
    queryKey: QUERY_KEYS.ai.models,
    queryFn: () => getAIModels(),
  });
}

export function useAIConfig() {
  return useQuery<AIConfigDto>({
    queryKey: QUERY_KEYS.ai.config,
    queryFn: () => getAIConfig(),
  });
}

export function useAIUsage() {
  return useQuery<AIUsageDto>({
    queryKey: QUERY_KEYS.ai.usage,
    queryFn: () => getAIUsage(),
  });
}

export function useAIHistory() {
  return useQuery<AIHistoryDto[]>({
    queryKey: QUERY_KEYS.ai.history,
    queryFn: () => getAIHistory(),
  });
}

export function useUpdateAIConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (newConfig: Partial<AIConfigDto>) => updateAIConfig(newConfig),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: QUERY_KEYS.ai.config });
    },
  });
}

export function useTestAIRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      prompt: string;
      provider?: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
      model?: string;
      responseFormat?: "text" | "json";
    }) => testAIRequest(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: QUERY_KEYS.ai.usage });
      void client.invalidateQueries({ queryKey: QUERY_KEYS.ai.history });
    },
  });
}

export function useTestAIRequestResult() {
  return useQuery<AIResponseDto | null>({
    queryKey: QUERY_KEYS.ai.history,
    queryFn: () => null,
    enabled: false,
  });
}

export function useAIToolsSettings() {
  const queryClient = useQueryClient();

  const toolsQuery = useQuery({
    queryKey: ["ai-tools-list"],
    queryFn: () => getAITools(),
  });

  const healthQuery = useQuery({
    queryKey: ["ai-tools-health"],
    queryFn: () => getAIToolsHealth(),
    refetchInterval: 10_000,
  });

  const historyQuery = useQuery({
    queryKey: ["ai-tools-history"],
    queryFn: () => getAIToolHistory(),
  });

  const testMutation = useMutation({
    mutationFn: ({ name, args }: { name: string; args: Record<string, unknown> }) => testAITool(name, args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-tools-history"] });
    },
  });

  return { toolsQuery, healthQuery, historyQuery, testMutation };
}
