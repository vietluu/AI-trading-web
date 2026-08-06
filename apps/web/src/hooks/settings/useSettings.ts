import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/hooks/query-keys";
import { apiRequest } from "@/lib/api-client";
import {
  addSource,
  deleteSource,
  getSocialProviders,
  getSources,
  getSettings,
  saveSettings,
  testSource,
  toggleSource,
} from "@/services/settings.service";
import {
  getExchangeConnection,
  getExchangeConnections,
  getExchangeAccount,
  getExchangeBalances,
  getExchangeOpenOrders,
  getExchangePositions,
  testExchangeConnection,
  toggleExchangeConnection,
  updateExchangeConnection,
  replaceExchangeCredentials,
  deleteExchangeConnection,
} from "@/services/exchanges.service";

export function useAppSettings() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.list(),
    queryFn: getSettings,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.list() });
    },
  });

  return { settingsQuery, saveMutation };
}

export function useDataSourcesSettings() {
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: queryKeys.settings.sources(),
    queryFn: getSources,
  });

  const socialProvidersQuery = useQuery({
    queryKey: queryKeys.settings.socialProviders(),
    queryFn: getSocialProviders,
  });

  const addSourceMutation = useMutation({
    mutationFn: addSource,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.sources() });
    },
  });

  const testSourceMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => testSource(id),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteSource(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.sources() });
    },
  });

  const toggleSourceMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) => toggleSource(id, isEnabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.sources() });
    },
  });

  return {
    sourcesQuery,
    socialProvidersQuery,
    addSourceMutation,
    testSourceMutation,
    deleteSourceMutation,
    toggleSourceMutation,
  };
}

export function useExchangeConnections() {
  return useQuery({
    queryKey: queryKeys.settings.exchangeConnections(),
    queryFn: getExchangeConnections,
    retry: false,
  });
}

interface MacroEvent {
  id: string;
  name: string;
  country?: string;
  currency?: string;
  category: string;
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  scheduledAt: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  unit?: string;
  status: string;
  sourceUrl?: string;
}

interface MacroPreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  previewItems: Record<string, unknown>[];
  errors: { row: number; message: string }[];
}

interface SentimentObservation {
  id?: string;
  provider: string;
  indexType: string;
  value: number;
  classification: string;
  observedAt: string;
  isStale?: boolean;
}

export function useMacroEvents(importanceFilter = "", categoryFilter = "") {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.macro.events(importanceFilter, categoryFilter),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (importanceFilter) params.set("importance", importanceFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      return apiRequest<{ items: MacroEvent[]; pagination: unknown }>(
        `/external-data/macro/events?${params.toString()}`,
      );
    },
  });

  const previewMutation = useMutation({
    mutationFn: async ({ fileContent, fileFormat }: { fileContent: string; fileFormat: "csv" | "json" }) => {
      return apiRequest<MacroPreviewResult>("/external-data/macro/import/preview", {
        method: "POST",
        body: JSON.stringify({ fileContent, fileFormat }),
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ previewResult, fileFormat }: { previewResult: MacroPreviewResult; fileFormat: "csv" | "json" }) => {
      return apiRequest<unknown>("/external-data/macro/import", {
        method: "POST",
        body: JSON.stringify({
          fileName: `manual_import.${fileFormat}`,
          fileFormat,
          items: previewResult.previewItems,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.macro.events("", "") });
    },
  });

  return { query, previewMutation, confirmMutation };
}

export function useSentimentData() {
  const currentQuery = useQuery({
    queryKey: queryKeys.sentiment.current,
    queryFn: async () => apiRequest<SentimentObservation>("/external-data/sentiment"),
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.sentiment.history,
    queryFn: async () => apiRequest<SentimentObservation[]>("/external-data/sentiment/history?limit=30"),
  });

  return { currentQuery, historyQuery };
}

export function useExchangeConnectionDetail(id: string) {
  const queryClient = useQueryClient();

  const connectionQuery = useQuery({
    queryKey: queryKeys.settings.exchangeConnection(id),
    queryFn: () => getExchangeConnection(id),
    retry: false,
  });

  const accountQuery = useQuery({
    queryKey: queryKeys.settings.exchangeAccount(id),
    queryFn: () => getExchangeAccount(id),
    enabled: Boolean(id && connectionQuery.data?.isEnabled && connectionQuery.data.isVerified),
    retry: false,
  });

  const balancesQuery = useQuery({
    queryKey: queryKeys.settings.exchangeBalances(id),
    queryFn: () => getExchangeBalances(id),
    enabled: Boolean(id && connectionQuery.data?.isEnabled && connectionQuery.data.isVerified),
    retry: false,
  });

  const positionsQuery = useQuery({
    queryKey: queryKeys.settings.exchangePositions(id),
    queryFn: () => getExchangePositions(id),
    enabled: Boolean(id && connectionQuery.data?.isEnabled && connectionQuery.data.isVerified),
    retry: false,
  });

  const ordersQuery = useQuery({
    queryKey: queryKeys.settings.exchangeOrders(id),
    queryFn: () => getExchangeOpenOrders(id),
    enabled: Boolean(id && connectionQuery.data?.isEnabled && connectionQuery.data.isVerified),
    retry: false,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ action, totpCode }: { action: "enable" | "disable"; totpCode?: string }) => toggleExchangeConnection(id, action, totpCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.exchangeConnection(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.exchangeConnections() });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => testExchangeConnection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.exchangeConnection(id) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ displayName, totpCode }: { displayName?: string | null; totpCode?: string }) => updateExchangeConnection(id, { displayName }, totpCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.exchangeConnection(id) });
    },
  });

  const replaceCredentialsMutation = useMutation({
    mutationFn: ({ payload, totpCode }: { payload: { apiKey: FormDataEntryValue | null; apiSecret: FormDataEntryValue | null; passphrase?: FormDataEntryValue | null }; totpCode?: string }) => replaceExchangeCredentials(id, payload, totpCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.exchangeConnection(id) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ totpCode }: { totpCode?: string }) => deleteExchangeConnection(id, totpCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.exchangeConnections() });
      void queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(id) });
    },
  });

  return {
    connectionQuery,
    accountQuery,
    balancesQuery,
    positionsQuery,
    ordersQuery,
    toggleMutation,
    testMutation,
    updateMutation,
    replaceCredentialsMutation,
    deleteMutation,
  };
}
