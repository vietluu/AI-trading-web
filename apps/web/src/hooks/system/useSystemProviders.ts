import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/hooks/query-keys";
import { getProviderHealth, triggerProviderRun } from "@/services/system.service";

export function useProviderHealth() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.system.providerHealth(),
    queryFn: getProviderHealth,
  });

  const triggerRunMutation = useMutation({
    mutationFn: (providerId: string) => triggerProviderRun(providerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.providerHealth() });
    },
  });

  return { query, triggerRunMutation };
}
