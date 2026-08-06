import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/hooks/query-keys";
import { listCredentials } from "@/services/credentials.service";

export function useCredentials() {
  return useQuery({
    queryKey: QUERY_KEYS.credentials.list,
    queryFn: () => listCredentials(),
    retry: false,
  });
}
