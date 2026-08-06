import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DecisionOutput,
  FusionRunInput,
  MarketAgentInput,
  MarketAgentOutput,
  NewsAgentOutput,
  NewsSentimentInput,
  SentimentAgentOutput,
  TechnicalAgentInput,
  TechnicalAgentOutput,
} from "@platform/shared";

import { queryKeys } from "@/hooks/query-keys";
import {
  cancelAgentRun,
  cancelPipelineRun,
  cancelPipelineSchedule,
  createPipelineSchedule,
  createReflectionProposal,
  enableLiveTrading,
  getAgentHealth,
  getAgentRunDetail,
  getAgentRunsList,
  getAgentRunTransitions,
  getAgents,
  getLiveTradingDashboard,
  getPerformanceAlerts,
  getPerformanceMetrics,
  getPerformanceRecords,
  getPipelineHealth,
  getPipelineRunDetail,
  getPipelineRuns,
  getPipelineSchedules,
  getPortfolioDashboard,
  getReflectionData,
  getReflectionInsights,
  getReflectionProposals,
  getRiskDashboard,
  killLiveTrading,
  replayPipelineRun,
  reviewReflectionProposal,
  runDecision,
  runPipeline,
  runReflection,
  runSystemDiagnostic,
  runMarketAnalysis,
  runNewsAnalysis,
  runSentimentAnalysis,
  runTechnicalAnalysis,
  syncLiveTradingConnection,
  updatePortfolioStrategyStatus,
  rebalancePortfolio,
} from "@/services/ai-feature.service";

export function useAgentRuns(page = 1, statusFilter = "", typeFilter = "") {
  return useQuery({
    queryKey: queryKeys.ai.agentRuns(page, statusFilter, typeFilter),
    queryFn: () => getAgentRunsList(page, statusFilter, typeFilter),
  });
}

export function useAgentRunDetail(runId: string) {
  return useQuery({
    queryKey: queryKeys.ai.agentRunDetail(runId),
    queryFn: () => getAgentRunDetail(runId),
    enabled: Boolean(runId),
  });
}

export function useAgentRunTransitions(runId: string) {
  return useQuery({
    queryKey: queryKeys.ai.agentRunTransitions(runId),
    queryFn: () => getAgentRunTransitions(runId),
    enabled: Boolean(runId),
  });
}

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.ai.agents(),
    queryFn: getAgents,
  });
}

export function useAgentHealth() {
  return useQuery({
    queryKey: queryKeys.ai.agentHealth(),
    queryFn: getAgentHealth,
  });
}

export interface DiagnosticRunResult {
  id: string;
  agentType: string;
  status: string;
  output?: {
    summary: string;
    observations: string[];
    dataQuality: string;
    usedTools: string[];
    generatedAt: string;
  };
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
}

export type MarketAnalysisResult = MarketAgentOutput;
export type NewsAnalysisResult = NewsAgentOutput;
export type SentimentAnalysisResult = SentimentAgentOutput;
export type TechnicalAnalysisResult = TechnicalAgentOutput;

export interface AnalysisRunResult {
  id: string;
  status: string;
  output?: MarketAnalysisResult | NewsAnalysisResult | SentimentAnalysisResult | TechnicalAnalysisResult;
}

export function useSystemDiagnostic(symbol: string, provider: string) {
  return useMutation<DiagnosticRunResult, Error, void>({
    mutationFn: () => runSystemDiagnostic(symbol, provider),
  });
}

export function useDecisionRunner() {
  const queryClient = useQueryClient();
  return useMutation<DecisionOutput, Error, FusionRunInput>({
    mutationFn: (input) => runDecision(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ai.base });
    },
  });
}

export function useAnalysisRunner(kind: "MARKET" | "NEWS" | "SENTIMENT" | "TECHNICAL") {
  const queryClient = useQueryClient();
  const mutation = useMutation<
    AnalysisRunResult,
    Error,
    MarketAgentInput | NewsSentimentInput | TechnicalAgentInput
  >({
    mutationFn: async (input) => {
      switch (kind) {
        case "MARKET":
          return runMarketAnalysis(input as MarketAgentInput);
        case "NEWS":
          return runNewsAnalysis(input as NewsSentimentInput);
        case "SENTIMENT":
          return runSentimentAnalysis(input as NewsSentimentInput);
        case "TECHNICAL":
          return runTechnicalAnalysis(input as TechnicalAgentInput);
        default:
          throw new Error("Unsupported analysis kind");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ai.base });
    },
  });

  return mutation;
}

export function useLiveTradingDashboard() {
  return useQuery({
    queryKey: queryKeys.ai.liveTrading(),
    queryFn: getLiveTradingDashboard,
  });
}

export function useLiveTradingActions() {
  const queryClient = useQueryClient();
  return {
    syncMutation: useMutation({
      mutationFn: syncLiveTradingConnection,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.liveTrading() });
      },
    }),
    killMutation: useMutation({
      mutationFn: killLiveTrading,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.liveTrading() });
      },
    }),
    enableMutation: useMutation({
      mutationFn: enableLiveTrading,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.liveTrading() });
      },
    }),
  };
}

export function usePerformanceDashboard(symbol?: string) {
  const metrics = useQuery({
    queryKey: queryKeys.ai.performance(symbol),
    queryFn: () => getPerformanceMetrics(symbol),
  });
  const records = useQuery({
    queryKey: queryKeys.ai.performanceRecords(symbol),
    queryFn: () => getPerformanceRecords(symbol),
  });
  const alerts = useQuery({
    queryKey: queryKeys.ai.performanceAlerts(symbol),
    queryFn: () => getPerformanceAlerts(symbol),
  });

  return { metrics, records, alerts };
}

export function usePortfolioDashboard() {
  return useQuery<Awaited<ReturnType<typeof getPortfolioDashboard>>>({
    queryKey: queryKeys.ai.portfolio(),
    queryFn: getPortfolioDashboard,
  });
}

export function usePortfolioActions() {
  const queryClient = useQueryClient();
  return {
    rebalanceMutation: useMutation({
      mutationFn: rebalancePortfolio,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.portfolio() });
      },
    }),
    updateStrategyStatusMutation: useMutation({
      mutationFn: ({ key, next }: { key: string; next: string }) => updatePortfolioStrategyStatus(key, next),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.portfolio() });
      },
    }),
  };
}

export function useReflectionData() {
  return useQuery<Awaited<ReturnType<typeof getReflectionData>>>({
    queryKey: queryKeys.ai.reflection(),
    queryFn: getReflectionData,
  });
}

export function useReflectionActions() {
  const queryClient = useQueryClient();
  return {
    insights: useQuery<Awaited<ReturnType<typeof getReflectionInsights>>>({
      queryKey: queryKeys.ai.reflectionInsights(),
      queryFn: getReflectionInsights,
    }),
    proposals: useQuery<Awaited<ReturnType<typeof getReflectionProposals>>>({
      queryKey: queryKeys.ai.reflectionProposals(),
      queryFn: getReflectionProposals,
    }),
    runMutation: useMutation<Awaited<ReturnType<typeof runReflection>>, Error, void>({
      mutationFn: runReflection,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.reflection() });
      },
    }),
    createProposalMutation: useMutation<Awaited<ReturnType<typeof createReflectionProposal>>, Error, string>({
      mutationFn: createReflectionProposal,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.reflectionProposals() });
      },
    }),
    reviewProposalMutation: useMutation<Awaited<ReturnType<typeof reviewReflectionProposal>>, Error, { id: string; status: "APPROVED" | "REJECTED" }>({
      mutationFn: ({ id, status }) => reviewReflectionProposal(id, status),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.reflectionProposals() });
      },
    }),
  };
}

export function useRiskDashboard() {
  return useQuery<Awaited<ReturnType<typeof getRiskDashboard>>>({
    queryKey: queryKeys.ai.risk(),
    queryFn: getRiskDashboard,
  });
}

export function usePipelineDashboard() {
  return useQuery<Awaited<ReturnType<typeof getPipelineHealth>>>({
    queryKey: queryKeys.ai.pipelineHealth(),
    queryFn: getPipelineHealth,
  });
}

export function usePipelineSchedules() {
  return useQuery<Awaited<ReturnType<typeof getPipelineSchedules>>>({
    queryKey: queryKeys.ai.pipelineSchedules(),
    queryFn: getPipelineSchedules,
  });
}

export function usePipelineRuns() {
  return useQuery<Awaited<ReturnType<typeof getPipelineRuns>>>({
    queryKey: queryKeys.ai.pipelineRuns(),
    queryFn: getPipelineRuns,
  });
}

export function usePipelineRunDetail(runId: string, shouldPoll = false) {
  return useQuery<Awaited<ReturnType<typeof getPipelineRunDetail>>>({
    queryKey: queryKeys.ai.pipelineRunDetail(runId),
    queryFn: () => getPipelineRunDetail(runId),
    enabled: Boolean(runId),
    refetchInterval: shouldPoll
      ? (query) => (["QUEUED", "RUNNING"].includes(query.state.data?.status ?? "") ? 3000 : false)
      : false,
  });
}

export function usePipelineActions() {
  const queryClient = useQueryClient();
  return {
    runMutation: useMutation({
      mutationFn: (payload: Record<string, unknown>) => runPipeline(payload),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.pipelineRuns() });
      },
    }),
    createScheduleMutation: useMutation({
      mutationFn: createPipelineSchedule,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.pipelineSchedules() });
      },
    }),
    cancelScheduleMutation: useMutation({
      mutationFn: cancelPipelineSchedule,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.pipelineSchedules() });
      },
    }),
    replayMutation: useMutation({
      mutationFn: replayPipelineRun,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.pipelineRuns() });
      },
    }),
    cancelRunMutation: useMutation({
      mutationFn: cancelPipelineRun,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.pipelineRuns() });
      },
    }),
  };
}

export function useAgentActions() {
  const queryClient = useQueryClient();
  return {
    cancelMutation: useMutation({
      mutationFn: cancelAgentRun,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ai.agentRuns() });
      },
    }),
  };
}
