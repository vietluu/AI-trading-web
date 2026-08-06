import { settingsViewSchema } from "@platform/shared";

import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest, apiRequestValidated } from "@/lib/api-client";

export async function getSettings() {
  return apiRequestValidated(API_ENDPOINTS.settings, settingsViewSchema);
}

export async function saveSettings(payload: Record<string, unknown>) {
  return apiRequest(API_ENDPOINTS.settings, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function getSources() {
  return apiRequest<unknown[]>(API_ENDPOINTS.externalData.sources);
}

export async function getSocialProviders() {
  return apiRequest<unknown[]>(API_ENDPOINTS.externalData.socialProviders);
}

export async function addSource(payload: { sourceId: string; displayName: string; feedUrl: string; reliabilityScore: number }) {
  return apiRequest(API_ENDPOINTS.externalData.sources, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function testSource(id: string) {
  return apiRequest(API_ENDPOINTS.externalData.sourceTest(id), { method: "POST" });
}

export async function deleteSource(id: string) {
  return apiRequest(API_ENDPOINTS.externalData.sourceById(id), { method: "DELETE" });
}

export async function toggleSource(id: string, isEnabled: boolean) {
  return apiRequest(API_ENDPOINTS.externalData.sourceById(id), {
    method: "PATCH",
    body: JSON.stringify({ isEnabled }),
  });
}
