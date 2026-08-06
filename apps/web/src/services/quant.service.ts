import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest } from "@/lib/api-client";

export async function getRecommendations(): Promise<RecommendationItem[]> {
  return apiRequest(API_ENDPOINTS.quant.recommendations);
}

interface RecommendationItem {
  id: string;
  title: string;
  moduleSource: string;
  problemStatement: string;
  evidenceText: string;
  expectedBenefit: string;
  estimatedRisk: string;
  priority: string;
  implementationCost: string;
  rollbackPlan: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
}

export async function reviewRecommendation(id: string, action: "APPROVE" | "REJECT") {
  return apiRequest(API_ENDPOINTS.quant.recommendationReview(id), {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}
