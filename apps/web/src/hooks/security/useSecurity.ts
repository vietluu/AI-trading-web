import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/hooks/query-keys";
import { checkCurrentUser, getSessions } from "@/services/auth.service";

export function useSecurityUser() {
  return useQuery({
    queryKey: QUERY_KEYS.auth.me,
    queryFn: () => checkCurrentUser(),
    retry: false,
  });
}

export function useSecuritySessions() {
  return useQuery({
    queryKey: QUERY_KEYS.auth.sessions,
    queryFn: () => getSessions(),
    retry: false,
  });
}
