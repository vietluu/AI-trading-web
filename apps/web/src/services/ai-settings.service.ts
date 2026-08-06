import type {
  AIConfigDto,
  AIHistoryDto,
  AIModel,
  AIProviderHealth,
  AIResponseDto,
  AIUsageDto,
  ToolDefinitionDto,
  ToolHealthDto,
  ToolInvocationRecordDto,
  ToolResultDto,
} from "@platform/shared";

import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest, resolveApiUrl } from "@/lib/api-client";

export async function getAIProviders() {
  return apiRequest<AIProviderHealth[]>(API_ENDPOINTS.ai.providers);
}

export async function getAIModels() {
  return apiRequest<AIModel[]>(API_ENDPOINTS.ai.models);
}

export async function getAIConfig() {
  return apiRequest<AIConfigDto>(API_ENDPOINTS.ai.config);
}

export async function getAIUsage() {
  return apiRequest<AIUsageDto>(API_ENDPOINTS.ai.usage);
}

export async function getAIHistory(limit = 30) {
  return apiRequest<AIHistoryDto[]>(API_ENDPOINTS.ai.history(limit));
}

export async function updateAIConfig(newConfig: Partial<AIConfigDto>) {
  return apiRequest(API_ENDPOINTS.ai.config, {
    method: "PUT",
    body: JSON.stringify(newConfig),
  });
}

export async function testAIRequest(body: {
  prompt: string;
  provider?: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
  model?: string;
  responseFormat?: "text" | "json";
}) {
  return apiRequest<AIResponseDto>(API_ENDPOINTS.ai.test, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function streamAIChat(payload: {
  prompt: string;
  provider: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OLLAMA";
  model: string;
}) {
  return fetch(resolveApiUrl(API_ENDPOINTS.ai.chatStream), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getAITools() {
  return apiRequest<ToolDefinitionDto[]>(API_ENDPOINTS.ai.tools, {
    headers: { Accept: "application/json" },
  });
}

export async function getAIToolsHealth() {
  return apiRequest<ToolHealthDto[]>(API_ENDPOINTS.ai.toolsHealth, {
    headers: { Accept: "application/json" },
  });
}

export async function getAIToolHistory(limit = 30) {
  const path = `${API_ENDPOINTS.ai.toolsHistory}?limit=${String(limit)}`;
  return apiRequest<ToolInvocationRecordDto[]>(path, {
    headers: { Accept: "application/json" },
  });
}

export async function testAITool(name: string, args: Record<string, unknown>) {
  return apiRequest<ToolResultDto>(`${API_ENDPOINTS.ai.tools}/${name}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}
