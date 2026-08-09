export const QUERY_KEYS = {
  auth: {
    me: ["me"],
    homeSession: ["auth", "home-session"],
    sessions: ["sessions"],
  },
  dashboard: {
    recommendations: ["home", "recommendations"],
    researchRuns: ["home", "research-runs"],
    symbolOpportunities: ["home", "symbol-opportunities"],
  },
  credentials: {
    list: ["credentials"],
  },
  macro: {
    events: (importanceFilter: string, categoryFilter: string) => [
      "macro-events",
      importanceFilter,
      categoryFilter,
    ],
  },
  ai: {
    base: ["ai"],
    providers: ["ai-providers"],
    models: ["ai-models"],
    config: ["ai-config"],
    usage: ["ai-usage"],
    history: ["ai-history"],
    agents: () => ["agents"],
    agentHealth: () => ["agents-health"],
    agentRuns: (page = 1, statusFilter = "", typeFilter = "") => [
      "agent-runs",
      page,
      statusFilter,
      typeFilter,
    ],
    agentRunDetail: (id: string) => ["agent-run-detail", id],
    agentRunTransitions: (id: string) => ["agent-run-transitions", id],
    liveTrading: () => ["live-trading"],
    portfolio: () => ["portfolio-dashboard"],
    risk: () => ["risk-dashboard"],
    reflection: () => ["reflection"],
    reflectionInsights: () => ["reflection-insights"],
    reflectionProposals: () => ["reflection-proposals"],
    performance: (symbol?: string) => ["performance-metrics", symbol ?? ""],
    performanceRecords: (symbol?: string) => [
      "performance-records",
      symbol ?? "",
    ],
    performanceAlerts: (symbol?: string) => [
      "performance-alerts",
      symbol ?? "",
    ],
    pipelineRuns: () => ["pipeline-runs"],
    pipelineRunDetail: (id: string) => ["pipeline-run", id],
    pipelineHealth: () => ["pipeline-health"],
    pipelineSchedules: () => ["pipeline-schedules"],
    settings: ["settings"],
    exchangeConnections: ["exchange-connections"],
    exchangeConnectionDetail: (id: string) => ["exchange-connection", id],
    exchangeAccount: (id: string) => ["exchange-account", id],
    exchangeBalances: (id: string) => ["exchange-balances", id],
    exchangePositions: (id: string) => ["exchange-positions", id],
    exchangeOrders: (id: string) => ["exchange-orders", id],
  },
  news: {
    list: (filters: {
      symbolFilter: string;
      minImportance: number;
      savedOnly: boolean;
      unreadOnly: boolean;
    }) => [
      "news",
      filters.symbolFilter,
      filters.minImportance,
      filters.savedOnly,
      filters.unreadOnly,
    ],
    detail: (id: string) => ["news-detail", id],
  },
  sentiment: {
    current: ["sentiment-current"],
    history: ["sentiment-history"],
  },
  settings: {
    list: () => ["settings"],
    sources: () => ["sources"],
    socialProviders: () => ["social-providers"],
    exchangeConnections: () => ["exchange-connections"],
    exchangeConnection: (id: string) => ["exchange-connection", id],
    exchangeAccount: (id: string) => ["exchange-account", id],
    exchangeBalances: (id: string) => ["exchange-balances", id],
    exchangePositions: (id: string) => ["exchange-positions", id],
    exchangeOrders: (id: string) => ["exchange-open-orders", id],
  },
  system: {
    providerHealth: () => ["provider-health"],
  },
  health: {
    status: () => ["platform-health"],
  },
} as const;

export const queryKeys = QUERY_KEYS;
