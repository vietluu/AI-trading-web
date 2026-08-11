import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

interface ConfiguredTradingScope {
  symbols: string[];
  timeframes: string[];
  settings: string[];
  pipelineTriggers: string[];
  settingsTimeframes: string[];
  pipelineTimeframes: string[];
}

export function useConfiguredTradingScope() {
  return useQuery({
    queryKey: ['configured-trading-scope'],
    queryFn: () => apiRequest<ConfiguredTradingScope>('/quant-intelligence/scope'),
    staleTime: 60_000,
  });
}
