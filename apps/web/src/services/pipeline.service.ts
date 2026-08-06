import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest } from "@/lib/api-client";

export async function getPipelineHealth() {
  return apiRequest(API_ENDPOINTS.pipeline.health);
}

export async function getPipelineSchedules() {
  return apiRequest(API_ENDPOINTS.pipeline.schedules);
}

export async function runPipeline(payload: Record<string, unknown>) {
  return apiRequest(API_ENDPOINTS.pipeline.run, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createPipelineSchedule(payload: Record<string, unknown>) {
  return apiRequest(API_ENDPOINTS.pipeline.schedules, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelPipelineSchedule(id: string) {
  return apiRequest(API_ENDPOINTS.pipeline.byId(id), { method: "DELETE" });
}
