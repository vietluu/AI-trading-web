import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest } from "@/lib/api-client";

export interface ProviderHealth {
  id: string;
  provider: string;
  status: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastItemAt?: string;
  consecutiveFailures: number;
  averageLatencyMs: number;
  lastErrorCode?: string;
  itemsFetchedTotal: number;
  itemsAcceptedTotal: number;
  updatedAt: string;
}

export async function getProviderHealth() {
  return apiRequest<ProviderHealth[]>(API_ENDPOINTS.externalData.providersHealth);
}

export async function triggerProviderRun(providerId: string) {
  return apiRequest(API_ENDPOINTS.externalData.providerRun(providerId), { method: "POST" });
}
