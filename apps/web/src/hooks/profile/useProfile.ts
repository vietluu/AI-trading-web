import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/hooks/query-keys";
import { checkCurrentUser } from "@/services/auth.service";

export function useProfile() {
  return useQuery({
    queryKey: QUERY_KEYS.auth.me,
    queryFn: () => checkCurrentUser(),
    retry: false,
  });
}
