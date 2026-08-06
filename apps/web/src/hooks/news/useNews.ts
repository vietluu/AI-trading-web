import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/hooks/query-keys";
import {
  getNewsDetail,
  getNewsFeed,
  markNewsItemRead,
  saveNewsItem,
} from "@/services/news.service";

interface NewsFilters {
  symbolFilter: string;
  minImportance: number;
  savedOnly: boolean;
  unreadOnly: boolean;
}

export function useNewsFeed(filters: NewsFilters) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.news.list(filters),
    queryFn: () => getNewsFeed(filters),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, isSaved }: { id: string; isSaved: boolean }) => saveNewsItem(id, isSaved),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.news.list(filters) });
    },
  });

  const readMutation = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) => markNewsItemRead(id, isRead),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.news.list(filters) });
    },
  });

  return { query, saveMutation, readMutation };
}

export function useNewsDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.news.detail(id),
    queryFn: () => getNewsDetail(id),
    enabled: Boolean(id),
  });
}
