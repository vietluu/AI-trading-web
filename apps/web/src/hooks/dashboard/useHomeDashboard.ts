import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/hooks/query-keys";
import {
  getHomeRecommendations,
  getHomeResearchRuns,
  getHomeSession,
  getHomeSymbolOpportunities,
} from "@/services/home-dashboard.service";

export function useHomeSession() {
  return useQuery({
    queryKey: queryKeys.auth.homeSession,
    queryFn: getHomeSession,
    retry: false,
    staleTime: 30_000,
  });
}

export function useHomeRecommendations() {
  return useQuery({
    queryKey: queryKeys.dashboard.recommendations,
    queryFn: getHomeRecommendations,
  });
}

export function useHomeSymbolOpportunities() {
  return useQuery({
    queryKey: queryKeys.dashboard.symbolOpportunities,
    queryFn: getHomeSymbolOpportunities,
    staleTime: 60_000,
  });
}

export function useHomeResearchRuns() {
  return useQuery({
    queryKey: queryKeys.dashboard.researchRuns,
    queryFn: getHomeResearchRuns,
    refetchInterval: 30_000,
  });
}
