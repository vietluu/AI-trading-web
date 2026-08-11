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

import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest } from "@/lib/api-client";

export interface AgentRun {
  id: string;
  agentType: string;
  agentVersion: number;
  status: string;
  invocationSource: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  failureCode?: string;
  createdAt: string;
}

export interface AgentRunListResponse {
  data: AgentRun[];
  total: number;
}

export interface AgentRunDetail extends AgentRun {
  inputHash: string;
  sanitizedInput?: Record<string, unknown>;
  output?: Record<string, unknown>;
  safeFailureMessage?: string;
  traceId?: string;
  correlationId?: string;
}

export interface Transition {
  id: string;
  fromState: string;
  toState: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface AgentDefinition {
  type: string;
  version: number;
  displayName: string;
  description: string;
  status: string;
  executionMode: string;
  promptId: string;
  promptVersion: number;
  allowedToolNames: string[];
  requiredCapabilities: string[];
}

export interface AgentHealth {
  agentType: string;
  version: number;
  status: string;
  healthStatus: string;
  reasons: string[];
  avgLatencyMs: number;
  successRatePct: number;
  totalRuns: number;
  activeRuns: number;
}

export interface DiagnosticResult {
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

export interface LiveTradingDashboard {
  mode: string;
  globalTradingEnabled: boolean;
  liveTradingEnabled: boolean;
  connections: Array<{
    id: string;
    provider: string;
    environment: string;
    displayName: string | null;
    isEnabled: boolean;
    isVerified: boolean;
  }>;
  accounts: Array<{
    connectionId: string;
    totalEquity: number;
    availableBalance: number;
    unrealizedPnl: number;
    marginBalance: number;
    syncedAt: string;
  }>;
  positions: Array<{
    id: string;
    connectionId: string;
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    markPrice: number | null;
    liquidationPrice: number | null;
    leverage: number | null;
    unrealizedPnl: number;
    syncedAt: string;
  }>;
  orders: Array<{
    id: string;
    orderId: string | null;
    clientOrderId: string;
    provider: string;
    environment: string;
    symbol: string;
    side: string;
    size: number;
    price: number | null;
    status: string;
    purpose: string;
    errorCode: string | null;
    createdAt: string;
  }>;
}

export interface PerformanceMetrics {
  total: number;
  directionalDecisions: number;
  winRate: number;
  accuracy: number;
  averageReturn: number;
  maxDrawdown: number;
  confidenceAccuracyCorrelation: number | null;
  decisionDistribution: { LONG: number; SHORT: number; WAIT: number };
}

export interface PerformanceRecord {
  id: string;
  runId: string;
  symbol: string;
  horizon: string;
  decision: string;
  confidence: number;
  priceAtDecision: number;
  priceAfter: number;
  outcome: string;
  returnPct: number;
  evaluatedAt: string;
}

export interface PerformanceAlert {
  kind: string;
  severity: string;
  message: string;
}

export interface PortfolioDashboard {
  source: {
    mode: string;
    kind: "EXCHANGE";
    environment: string;
    available: boolean;
    stale: boolean;
    syncedAt: string | null;
    connectionCount: number;
  };
  config: {
    maxStrategies: number;
    maxTotalExposure: number;
    maxStrategyExposure: number;
    maxDrawdown: number;
  };
  portfolio: {
    equity: number;
    pnl: number;
    grossExposure: number;
    exposurePct: number;
    drawdownPct: number;
    failsafeActive: boolean;
    pnlKind: string;
  };
  strategies: Array<{
    id: string;
    key: string;
    name: string;
    type: string;
    kind: string;
    symbols: string[];
    status: string;
    disabledReason: string | null;
    allocation: { weight: number; allocatedCapital: number };
    performance: null | {
      totalTrades: number;
      source: string;
      winRate: number | null;
      returnPct: number | null;
      drawdownPct: number | null;
      sharpeRatio: number | null;
      realizedPnl: number;
      unrealizedPnl: number;
    };
    exposure: number;
  }>;
  aggregation: Array<{
    symbol: string;
    longNotional: number;
    shortNotional: number;
    grossNotional: number;
    netNotional: number;
    strategyCount: number;
  }>;
  riskEvents: Array<{
    id: string;
    symbol: string;
    side: string;
    approved: boolean;
    reason: string | null;
    requestedNotional: number;
    approvedNotional: number;
    createdAt: string;
  }>;
  unassignedExposure: number;
  unassignedClosedTrades: number;
  unassignedRealizedPnl: number;
}

export interface ReflectionSummary {
  summary: string;
  accuracy: number;
  strengths: string[];
  weaknesses: string[];
  patterns: string[];
  suggestions: string[];
  generatedAt: string;
  recordCount: number;
  ready: boolean;
  actualTrading?: {
    source: "EXCHANGE_CLOSED_TRADE_LEDGER";
    totalTrades: number;
    completeTrades: number;
    winRate: number;
    grossPnl: number;
    fees: number;
    netPnl: number;
    profitFactor: number | null;
  };
}

export interface SelfLearningLifecycle {
  stage: "LIVE" | "SHADOW" | "CANARY";
  isEnabled: boolean;
  liveVersion: number;
  candidateVersion: number | null;
  liveImpactPct: number;
  candidateImpactPct: number;
  shadowPerformance: null | {
    tradesCount: number;
    accuracy: number;
    totalReturn: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
  evidence: {
    pendingShadowSignals: number;
    evaluatedShadowSignals: number;
    canaryRecords: number;
    liveRecords: number;
  };
  startedAt: string | null;
  lastPromotionAt: string | null;
  experiment: null | {
    version: number;
    recommendation: null | { id: string; status: string; title: string };
    events: Array<{ eventType: string; createdAt: string }>;
  };
}

export interface ReflectionInsight {
  id: string;
  summary: string;
  category: string;
  severity: string;
  createdAt: string;
}

export interface ReflectionProposal {
  id: string;
  description: string;
  proposedChange: string;
  status: string;
  createdAt: string;
}

export interface RiskDashboard {
  config: {
    riskPerTrade: number;
    maxPositions: number;
    maxLeverage: number;
    maxDrawdown: number;
    maxExposure: number;
    cooldownMs: number;
  };
  portfolio: {
    balance: number;
    equity: number;
    peakEquity: number;
    openPositions: number;
    exposure: number;
    exposurePct: number;
    drawdownPct: number;
  };
  assessments: Array<{
    id: string;
    symbol: string;
    decision: string;
    confidence: number;
    approved: boolean;
    reason?: string;
    positionSize?: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
    riskScore: number;
    createdAt: string;
  }>;
}

export interface PipelineRun {
  id: string;
  symbol: string;
  provider: string;
  status: string;
  decision?: string;
  confidence?: number;
  dataQuality?: string;
  marketRegime?: string;
  skippedReason?: string;
  errorCode?: string;
  safeErrorMessage?: string;
  trigger: string;
  durationMs?: number;
  createdAt: string;
  result?: {
    decision?: string;
    confidence?: number;
    reasoning?: string;
    signals?: { bullishFactors?: string[]; bearishFactors?: string[] };
    risks?: string[];
    regime?: { type?: string; confidence?: number };
    conflictLevel?: string;
    opportunityScore?: number;
    expectedWinProbability?: number;
    expectedValue?: number;
    profitFactorEstimate?: number;
    riskScore?: number;
    actionable?: boolean;
    skippedReason?: string;
    judge?: { verdict?: string; approved?: boolean; reasons?: string[] };
  };
  steps: Array<{
    id: string;
    stepId: string;
    type: string;
    status: string;
    durationMs?: number;
    errorCode?: string;
  }>;
  alerts: Array<{
    id: string;
    kind: string;
    reasoningSummary: string;
    createdAt: string;
  }>;
}

export interface PipelineSchedule {
  id: string;
  symbols: string[];
  provider: string;
  mode: string;
  cron?: string;
  intervalMs?: number;
  enabled: boolean;
  timezone: string;
}

export interface PipelineHealth {
  status: string;
  queueDepth: number;
  failureStreak: number;
  lastSuccessfulRun?: string;
  scheduler: { enabled: boolean; running: boolean };
}

export async function getAgentRunsList(
  page = 1,
  statusFilter = "",
  typeFilter = "",
) {
  const params = new URLSearchParams({ page: String(page), limit: "15" });
  if (statusFilter) params.append("status", statusFilter);
  if (typeFilter) params.append("agentType", typeFilter);
  return apiRequest<AgentRunListResponse>(
    `${API_ENDPOINTS.agentRuns.root}?${params.toString()}`,
  );
}

export async function getAgentRunDetail(runId: string) {
  return apiRequest<AgentRunDetail>(API_ENDPOINTS.agentRuns.byId(runId));
}

export async function getAgentRunTransitions(runId: string) {
  try {
    return await apiRequest<Transition[]>(
      API_ENDPOINTS.agentRuns.transitions(runId),
    );
  } catch {
    return [] as Transition[];
  }
}

export async function cancelAgentRun(runId: string) {
  return apiRequest(API_ENDPOINTS.agentRuns.cancel(runId), { method: "POST" });
}

export async function getAgents() {
  return apiRequest<AgentDefinition[]>(API_ENDPOINTS.ai.agents);
}

export async function getAgentHealth() {
  return apiRequest<AgentHealth[]>(API_ENDPOINTS.ai.agentsHealth);
}

export async function runSystemDiagnostic(symbol: string, provider: string) {
  return apiRequest<DiagnosticResult>(API_ENDPOINTS.ai.systemDiagnosticRun, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, provider }),
  });
}

export async function runDecision(input: FusionRunInput) {
  return apiRequest<DecisionOutput>(API_ENDPOINTS.ai.decision, {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

export async function runMarketAnalysis(input: MarketAgentInput) {
  return apiRequest<{ id: string; status: string; output?: MarketAgentOutput }>(
    API_ENDPOINTS.ai.analysisRun("MARKET_ANALYST"),
    {
      method: "POST",
      body: JSON.stringify({ input }),
    },
  );
}

export async function runNewsAnalysis(input: NewsSentimentInput) {
  return apiRequest<{ id: string; status: string; output?: NewsAgentOutput }>(
    API_ENDPOINTS.ai.analysisRun("NEWS_ANALYST"),
    {
      method: "POST",
      body: JSON.stringify({ input }),
    },
  );
}

export async function runSentimentAnalysis(input: NewsSentimentInput) {
  return apiRequest<{
    id: string;
    status: string;
    output?: SentimentAgentOutput;
  }>(API_ENDPOINTS.ai.analysisRun("SENTIMENT_ANALYST"), {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

export async function runTechnicalAnalysis(input: TechnicalAgentInput) {
  return apiRequest<{
    id: string;
    status: string;
    output?: TechnicalAgentOutput;
  }>(API_ENDPOINTS.ai.analysisRun("TECHNICAL_ANALYST"), {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

export async function getLiveTradingDashboard() {
  return apiRequest<LiveTradingDashboard>(API_ENDPOINTS.ai.liveTrading);
}

export async function syncLiveTradingConnection(connectionId: string) {
  return apiRequest(API_ENDPOINTS.ai.liveTradingSync, {
    method: "POST",
    body: JSON.stringify({ connectionId }),
  });
}

export async function killLiveTrading() {
  return apiRequest(API_ENDPOINTS.ai.liveTradingKillSwitch, { method: "POST" });
}

export async function enableLiveTrading() {
  return apiRequest(API_ENDPOINTS.ai.liveTradingEnable, { method: "POST" });
}

export async function getPerformanceMetrics(symbol?: string) {
  const target = symbol
    ? `${API_ENDPOINTS.ai.performanceMetrics}?symbol=${encodeURIComponent(symbol)}`
    : API_ENDPOINTS.ai.performanceMetrics;
  return apiRequest<PerformanceMetrics>(target);
}

export async function getPerformanceRecords(symbol?: string) {
  const target = symbol
    ? `${API_ENDPOINTS.ai.performanceRoot}?symbol=${encodeURIComponent(symbol)}`
    : API_ENDPOINTS.ai.performanceRoot;
  return apiRequest<PerformanceRecord[]>(target);
}

export async function getPerformanceAlerts(symbol?: string) {
  const target = symbol
    ? `${API_ENDPOINTS.ai.performanceAlerts}?symbol=${encodeURIComponent(symbol)}`
    : API_ENDPOINTS.ai.performanceAlerts;
  return apiRequest<PerformanceAlert[]>(target);
}

export async function getPortfolioDashboard() {
  return apiRequest<PortfolioDashboard>(API_ENDPOINTS.ai.portfolio);
}

export async function rebalancePortfolio() {
  return apiRequest(API_ENDPOINTS.ai.portfolioRebalance, { method: "POST" });
}

export async function updatePortfolioStrategyStatus(key: string, next: string) {
  return apiRequest(API_ENDPOINTS.ai.portfolioStrategyStatus(key), {
    method: "PATCH",
    body: JSON.stringify({ status: next }),
  });
}

export async function getReflectionData() {
  return apiRequest<ReflectionSummary>(API_ENDPOINTS.ai.reflection);
}

export async function getSelfLearningLifecycle() {
  return apiRequest<SelfLearningLifecycle>(API_ENDPOINTS.ai.selfLearningLifecycle);
}

export async function getReflectionInsights() {
  return apiRequest<ReflectionInsight[]>(API_ENDPOINTS.ai.reflectionInsights);
}

export async function getReflectionProposals() {
  return apiRequest<ReflectionProposal[]>(API_ENDPOINTS.ai.reflectionProposals);
}

export async function runReflection() {
  return apiRequest<ReflectionSummary>(API_ENDPOINTS.ai.reflectionRun, {
    method: "POST",
  });
}

export async function createReflectionProposal(suggestion: string) {
  return apiRequest<ReflectionProposal>(API_ENDPOINTS.ai.reflectionProposals, {
    method: "POST",
    body: JSON.stringify({
      description: suggestion,
      proposedChange: suggestion,
    }),
  });
}

export async function reviewReflectionProposal(
  id: string,
  status: "APPROVED" | "REJECTED",
) {
  return apiRequest<ReflectionProposal>(
    `${API_ENDPOINTS.ai.reflectionProposals}/${id}/review`,
    {
      method: "PATCH",
      body: JSON.stringify({ status, confirmed: true }),
    },
  );
}

export async function getRiskDashboard() {
  return apiRequest<RiskDashboard>(API_ENDPOINTS.ai.risk);
}

export async function getPipelineHealth() {
  return apiRequest<PipelineHealth>(API_ENDPOINTS.pipeline.health);
}

export async function getPipelineSchedules() {
  return apiRequest<PipelineSchedule[]>(API_ENDPOINTS.pipeline.schedules);
}

export async function runPipeline(payload: Record<string, unknown>) {
  return apiRequest<{ id: string; status: string }>(
    API_ENDPOINTS.pipeline.run,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function createPipelineSchedule(payload: Record<string, unknown>) {
  return apiRequest(API_ENDPOINTS.pipeline.schedules, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelPipelineSchedule(id: string) {
  return apiRequest(API_ENDPOINTS.pipeline.byId(id), { method: "DELETE" });
}

export async function getPipelineRuns() {
  return apiRequest<{ data: PipelineRun[]; total: number }>(
    `${API_ENDPOINTS.pipelineRuns.root}?limit=50`,
  );
}

export async function getPipelineRunDetail(id: string) {
  return apiRequest<PipelineRun>(API_ENDPOINTS.pipelineRuns.byId(id));
}

export async function replayPipelineRun(id: string) {
  return apiRequest(API_ENDPOINTS.pipelineRuns.replay(id), {
    method: "POST",
    body: JSON.stringify({ mode: "REPLAY_WITH_STORED_CONTEXT" }),
  });
}

export async function cancelPipelineRun(id: string) {
  return apiRequest(API_ENDPOINTS.pipelineRuns.cancel(id), { method: "POST" });
}
