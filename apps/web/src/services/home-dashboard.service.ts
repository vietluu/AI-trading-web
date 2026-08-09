import { apiRequest } from "@/lib/api-client";
import type { PipelineRun } from "@/services/ai-feature.service";

export interface DashboardRecommendation {
  id: string;
  title: string;
  priority: string;
  status: string;
  moduleSource: string;
}

export interface SymbolOpportunity {
  symbol: string;
  provider: string;
  opportunityScore: number;
  price: number;
  volume24h: number;
  change24hPct: number;
  reasons: string[];
  isCommon: boolean;
}

export function getHomeSession() {
  return apiRequest<{ expiresAt: string }>("/auth/session");
}

export function getHomeRecommendations() {
  return apiRequest<DashboardRecommendation[]>(
    "/quant-intelligence/recommendations",
  );
}

export function getHomeSymbolOpportunities() {
  return apiRequest<SymbolOpportunity[]>("/exchanges/recommendations?limit=6");
}

export function getHomeResearchRuns() {
  return apiRequest<{ data: PipelineRun[]; total: number }>(
    "/pipeline-runs?status=COMPLETED&limit=20",
  );
}
