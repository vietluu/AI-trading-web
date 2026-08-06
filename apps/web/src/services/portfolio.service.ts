import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest } from "@/lib/api-client";

export async function getPortfolioDashboard() {
  return apiRequest(API_ENDPOINTS.ai.portfolio);
}

export async function rebalancePortfolio() {
  return apiRequest(API_ENDPOINTS.ai.portfolioRebalance, { method: "POST" });
}

export async function updatePortfolioStrategyStatus(key: string, next: string) {
  return apiRequest(API_ENDPOINTS.ai.portfolioStrategyStatus(key), {
    method: "PATCH",
    body: JSON.stringify({ status: next }),
  });
}
