import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/hooks/query-keys";
import { fetchHealth } from "@/lib/health-client";

export function useHealthStatus() {
  return useQuery({
    queryKey: queryKeys.health.status(),
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
  });
}
