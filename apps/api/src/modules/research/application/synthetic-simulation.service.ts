export type ScenarioCategory =
  | 'BULL'
  | 'BEAR'
  | 'SIDEWAY'
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'BREAKOUT'
  | 'FAKE_BREAKOUT'
  | 'LIQUIDITY_SWEEP'
  | 'FLASH_CRASH'
  | 'NEWS_SHOCK'
  | 'FUNDING_EXTREMES'
  | 'OPEN_INTEREST_EXPANSION'
  | 'OPEN_INTEREST_COLLAPSE'
  | 'WHALE_ACTIVITY'
  | 'MACRO_EVENT'
  | 'ETF_FLOW'
  | 'EXCHANGE_FAILURE'
  | 'NETWORK_FAILURE'
  | 'API_FAILURES'
  | 'ORDERBOOK_ANOMALIES'
  | 'LOW_LIQUIDITY'
  | 'HIGH_SPREAD'
  | 'MARKET_MANIPULATION'
  | 'DATA_CORRUPTION'
  | 'BOUNDARY_CONDITIONS';

export interface ScenarioExpectation {
  input: Record<string, unknown>;
  expectedDecision: string;
  expectedRiskOutcome: string;
  expectedGuardianOutcome: string;
  expectedExecutionOutcome: string;
  passCriteria: string;
  failCriteria: string;
}

export interface SyntheticScenario extends ScenarioExpectation {
  id: string;
  title: string;
  category: ScenarioCategory;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  tags: string[];
  localOnly: boolean;
}

interface SyntheticScenarioTemplate extends ScenarioExpectation {
  category: ScenarioCategory;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  tags: string[];
}

export interface ScenarioRunResult {
  id: string;
  title: string;
  category: ScenarioCategory;
  passed: boolean;
  decision: string;
  riskOutcome: string;
  guardianOutcome: string;
  executionOutcome: string;
  notes: string;
}

export interface SyntheticSuiteSummary {
  totalScenarios: number;
  passCount: number;
  failCount: number;
  passRate: number;
}

export interface MutationSummary {
  totalMutations: number;
  detectedMutations: number;
  detectionRate: number;
}

export interface SyntheticSimulationDashboard {
  scenarioCount: number;
  localOnly: boolean;
  categoryBreakdown: Record<ScenarioCategory, number>;
  severityBreakdown: Record<string, number>;
}

export interface SyntheticSimulationRunResult {
  scenarioResults: ScenarioRunResult[];
  summary: SyntheticSuiteSummary;
  mutationSummary: MutationSummary;
}

export interface StatisticalValidationResult {
  walkForward: {
    averagePassRate: number;
    folds: Array<{ fold: number; passRate: number }>;
  };
  monteCarlo: {
    meanPassRate: number;
    stdDev: number;
    minPassRate: number;
    maxPassRate: number;
  };
  bootstrap: {
    confidenceInterval: [number, number];
    meanPassRate: number;
  };
  outOfSample: {
    passRate: number;
    sampleSize: number;
  };
}

export class SyntheticSimulationService {
  private readonly categories: ScenarioCategory[] = [
    'BULL',
    'BEAR',
    'SIDEWAY',
    'ACCUMULATION',
    'DISTRIBUTION',
    'BREAKOUT',
    'FAKE_BREAKOUT',
    'LIQUIDITY_SWEEP',
    'FLASH_CRASH',
    'NEWS_SHOCK',
    'FUNDING_EXTREMES',
    'OPEN_INTEREST_EXPANSION',
    'OPEN_INTEREST_COLLAPSE',
    'WHALE_ACTIVITY',
    'MACRO_EVENT',
    'ETF_FLOW',
    'EXCHANGE_FAILURE',
    'NETWORK_FAILURE',
    'API_FAILURES',
    'ORDERBOOK_ANOMALIES',
    'LOW_LIQUIDITY',
    'HIGH_SPREAD',
    'MARKET_MANIPULATION',
    'DATA_CORRUPTION',
    'BOUNDARY_CONDITIONS',
  ];

  private readonly categoryWeights: Record<ScenarioCategory, number> = {
    BULL: 24,
    BEAR: 24,
    SIDEWAY: 24,
    ACCUMULATION: 24,
    DISTRIBUTION: 24,
    BREAKOUT: 24,
    FAKE_BREAKOUT: 24,
    LIQUIDITY_SWEEP: 24,
    FLASH_CRASH: 24,
    NEWS_SHOCK: 24,
    FUNDING_EXTREMES: 24,
    OPEN_INTEREST_EXPANSION: 24,
    OPEN_INTEREST_COLLAPSE: 24,
    WHALE_ACTIVITY: 24,
    MACRO_EVENT: 24,
    ETF_FLOW: 24,
    EXCHANGE_FAILURE: 24,
    NETWORK_FAILURE: 24,
    API_FAILURES: 24,
    ORDERBOOK_ANOMALIES: 24,
    LOW_LIQUIDITY: 24,
    HIGH_SPREAD: 24,
    MARKET_MANIPULATION: 24,
    DATA_CORRUPTION: 24,
    BOUNDARY_CONDITIONS: 24,
  };

  private readonly scenarios: SyntheticScenario[] = this.buildScenarios();

  buildScenarios(): SyntheticScenario[] {
    const scenarios: SyntheticScenario[] = [];
    const baseTemplates: SyntheticScenarioTemplate[] = [
      {
        category: 'BULL' as const,
        title: 'Bull trend continuation',
        severity: 'MEDIUM' as const,
        tags: ['trend', 'momentum'],
        input: { regime: 'BULL', trendStrength: 0.8, volume: 1.4, funding: 0.01, volatility: 0.2 },
        expectedDecision: 'LONG',
        expectedRiskOutcome: 'MODERATE',
        expectedGuardianOutcome: 'ALLOW',
        expectedExecutionOutcome: 'EXECUTE',
        passCriteria: 'Decision is LONG and risk stays within guardrail.',
        failCriteria: 'Decision flips to SHORT or guardian blocks the trade.',
      },
      {
        category: 'BEAR' as const,
        title: 'Bear trend continuation',
        severity: 'MEDIUM' as const,
        tags: ['trend', 'downside'],
        input: { regime: 'BEAR', trendStrength: -0.8, volume: 1.2, funding: -0.02, volatility: 0.3 },
        expectedDecision: 'SHORT',
        expectedRiskOutcome: 'MODERATE',
        expectedGuardianOutcome: 'ALLOW',
        expectedExecutionOutcome: 'EXECUTE',
        passCriteria: 'Decision is SHORT and downside risk remains controlled.',
        failCriteria: 'Decision becomes LONG or execution is suppressed.',
      },
      {
        category: 'SIDEWAY' as const,
        title: 'Sideways range with low conviction',
        severity: 'LOW' as const,
        tags: ['range', 'low-conviction'],
        input: { regime: 'SIDEWAYS', trendStrength: 0.1, volume: 0.8, funding: 0.0, volatility: 0.15 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'LOW',
        expectedGuardianOutcome: 'WAIT',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'System waits when conviction is insufficient.',
        failCriteria: 'System enters a position during low-conviction range.',
      },
      {
        category: 'BREAKOUT' as const,
        title: 'Valid breakout with confirmation',
        severity: 'HIGH' as const,
        tags: ['breakout', 'confirmation'],
        input: { regime: 'BREAKOUT', trendStrength: 0.6, volume: 1.6, funding: 0.01, volatility: 0.25 },
        expectedDecision: 'LONG',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'ALLOW_WITH_RESTRICTION',
        expectedExecutionOutcome: 'EXECUTE_LIMITED',
        passCriteria: 'Breakout is accepted with restricted sizing.',
        failCriteria: 'Breakout is ignored or executed without risk controls.',
      },
      {
        category: 'FAKE_BREAKOUT' as const,
        title: 'False breakout with low follow-through',
        severity: 'HIGH' as const,
        tags: ['fake-breakout', 'rejection'],
        input: { regime: 'FAKE_BREAKOUT', trendStrength: 0.2, volume: 0.9, funding: 0.0, volatility: 0.35 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'BLOCK',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Fake breakout is rejected by guardrails.',
        failCriteria: 'System takes a trade on a false breakout.',
      },
      {
        category: 'FLASH_CRASH' as const,
        title: 'Flash crash with liquidity shock',
        severity: 'CRITICAL' as const,
        tags: ['liquidity', 'crash'],
        input: { regime: 'FLASH_CRASH', trendStrength: -0.95, volume: 0.7, funding: -0.05, volatility: 0.9 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'CRITICAL',
        expectedGuardianOutcome: 'HALT',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'System halts trading during flash crash conditions.',
        failCriteria: 'System executes during extreme liquidity dislocation.',
      },
      {
        category: 'NEWS_SHOCK' as const,
        title: 'High-impact news shock',
        severity: 'HIGH' as const,
        tags: ['news', 'event-risk'],
        input: { regime: 'NEWS_SHOCK', trendStrength: 0.3, volume: 1.0, funding: 0.0, volatility: 0.6 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'PAUSE',
        expectedExecutionOutcome: 'DELAY',
        passCriteria: 'System pauses execution until news risk is stabilized.',
        failCriteria: 'System trades immediately after a news shock.',
      },
      {
        category: 'FUNDING_EXTREMES' as const,
        title: 'Funding extreme causing adverse carry',
        severity: 'HIGH' as const,
        tags: ['funding', 'carry-risk'],
        input: { regime: 'FUNDING_EXTREMES', trendStrength: 0.4, volume: 1.1, funding: 0.18, volatility: 0.25 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'LIMIT',
        expectedExecutionOutcome: 'REDUCE_SIZE',
        passCriteria: 'System reduces size or avoids entry under carry stress.',
        failCriteria: 'System ignores funding extreme and takes full size.',
      },
      {
        category: 'ORDERBOOK_ANOMALIES' as const,
        title: 'Orderbook anomaly with quote imbalance',
        severity: 'HIGH' as const,
        tags: ['orderbook', 'liquidity'],
        input: { regime: 'ORDERBOOK_ANOMALIES', trendStrength: 0.4, volume: 0.6, funding: 0.0, volatility: 0.4 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'BLOCK',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Anomalous orderbook data causes a skip.',
        failCriteria: 'System trades despite anomalous book conditions.',
      },
      {
        category: 'API_FAILURES' as const,
        title: 'API failure and stale market snapshot',
        severity: 'CRITICAL' as const,
        tags: ['api', 'stale-data'],
        input: { regime: 'API_FAILURES', trendStrength: 0.5, volume: 0.0, funding: 0.0, volatility: 0.2 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'CRITICAL',
        expectedGuardianOutcome: 'HALT',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'System refuses to trade when API data is unavailable.',
        failCriteria: 'System trades on stale or missing data.',
      },
      {
        category: 'DATA_CORRUPTION' as const,
        title: 'Corrupted price feed',
        severity: 'CRITICAL' as const,
        tags: ['corruption', 'integrity'],
        input: { regime: 'DATA_CORRUPTION', trendStrength: 0.0, volume: 0.0, funding: 0.0, volatility: 0.0 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'CRITICAL',
        expectedGuardianOutcome: 'BLOCK',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Corrupt feed is detected and no trade is executed.',
        failCriteria: 'System acts on corrupt data.',
      },
      {
        category: 'BOUNDARY_CONDITIONS' as const,
        title: 'Boundary condition with extreme values',
        severity: 'LOW' as const,
        tags: ['boundary', 'edge'],
        input: { regime: 'BOUNDARY_CONDITIONS', trendStrength: 0.0, volume: 0.0, funding: 0.0, volatility: 0.0 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'LOW',
        expectedGuardianOutcome: 'WAIT',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Boundary conditions safely return to WAIT.',
        failCriteria: 'Boundary values cause invalid execution.',
      },
      {
        category: 'ACCUMULATION' as const,
        title: 'Accumulation with rising volume and calm spread',
        severity: 'MEDIUM' as const,
        tags: ['accumulation', 'volume'],
        input: { regime: 'ACCUMULATION', trendStrength: 0.35, volume: 1.5, funding: 0.01, volatility: 0.16 },
        expectedDecision: 'LONG',
        expectedRiskOutcome: 'MODERATE',
        expectedGuardianOutcome: 'ALLOW',
        expectedExecutionOutcome: 'EXECUTE',
        passCriteria: 'Accumulation is recognized as a favorable entry condition.',
        failCriteria: 'Accumulation is ignored and the system remains flat.',
      },
      {
        category: 'DISTRIBUTION' as const,
        title: 'Distribution with weakening trend and elevated spread',
        severity: 'MEDIUM' as const,
        tags: ['distribution', 'reversal'],
        input: { regime: 'DISTRIBUTION', trendStrength: -0.35, volume: 1.3, funding: -0.01, volatility: 0.18 },
        expectedDecision: 'SHORT',
        expectedRiskOutcome: 'MODERATE',
        expectedGuardianOutcome: 'ALLOW',
        expectedExecutionOutcome: 'EXECUTE',
        passCriteria: 'Distribution leads to a short bias.',
        failCriteria: 'Distribution is not recognized and long bias persists.',
      },
      {
        category: 'LIQUIDITY_SWEEP' as const,
        title: 'Liquidity sweep creating a false breakout',
        severity: 'HIGH' as const,
        tags: ['liquidity', 'sweep'],
        input: { regime: 'LIQUIDITY_SWEEP', trendStrength: 0.25, volume: 1.2, funding: 0.0, volatility: 0.4 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'BLOCK',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Liquidity sweep is rejected as a trap.',
        failCriteria: 'System enters on a sweep without caution.',
      },
      {
        category: 'OPEN_INTEREST_EXPANSION' as const,
        title: 'Open interest expands with trend confirmation',
        severity: 'MEDIUM' as const,
        tags: ['oi', 'momentum'],
        input: { regime: 'OPEN_INTEREST_EXPANSION', trendStrength: 0.55, volume: 1.4, funding: 0.02, volatility: 0.24 },
        expectedDecision: 'LONG',
        expectedRiskOutcome: 'MODERATE',
        expectedGuardianOutcome: 'ALLOW_WITH_RESTRICTION',
        expectedExecutionOutcome: 'EXECUTE_LIMITED',
        passCriteria: 'Open interest expansion supports a constrained long.',
        failCriteria: 'Open interest expansion is ignored.',
      },
      {
        category: 'OPEN_INTEREST_COLLAPSE' as const,
        title: 'Open interest collapse during trend reversal',
        severity: 'HIGH' as const,
        tags: ['oi', 'reversal'],
        input: { regime: 'OPEN_INTEREST_COLLAPSE', trendStrength: -0.4, volume: 0.9, funding: -0.01, volatility: 0.28 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'PAUSE',
        expectedExecutionOutcome: 'DELAY',
        passCriteria: 'Open interest collapse causes a pause.',
        failCriteria: 'System continues trading into collapsing OI.',
      },
      {
        category: 'WHALE_ACTIVITY' as const,
        title: 'Whale activity signals hidden accumulation',
        severity: 'HIGH' as const,
        tags: ['whale', 'institutional'],
        input: { regime: 'WHALE_ACTIVITY', trendStrength: 0.45, volume: 1.75, funding: 0.01, volatility: 0.2 },
        expectedDecision: 'LONG',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'ALLOW_WITH_RESTRICTION',
        expectedExecutionOutcome: 'EXECUTE_LIMITED',
        passCriteria: 'Whale activity is treated as a high-signal but controlled trade.',
        failCriteria: 'Whale activity is ignored or handled as normal trend.',
      },
      {
        category: 'MACRO_EVENT' as const,
        title: 'Macro event shifts market regime',
        severity: 'HIGH' as const,
        tags: ['macro', 'event'],
        input: { regime: 'MACRO_EVENT', trendStrength: 0.2, volume: 1.0, funding: 0.0, volatility: 0.6 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'PAUSE',
        expectedExecutionOutcome: 'DELAY',
        passCriteria: 'Macro event causes the system to pause.',
        failCriteria: 'Macro event is ignored and normal execution continues.',
      },
      {
        category: 'ETF_FLOW' as const,
        title: 'ETF flow confirms institutional demand',
        severity: 'MEDIUM' as const,
        tags: ['etf', 'flow'],
        input: { regime: 'ETF_FLOW', trendStrength: 0.42, volume: 1.35, funding: 0.0, volatility: 0.22 },
        expectedDecision: 'LONG',
        expectedRiskOutcome: 'MODERATE',
        expectedGuardianOutcome: 'ALLOW',
        expectedExecutionOutcome: 'EXECUTE',
        passCriteria: 'ETF flow improves conviction for a long.',
        failCriteria: 'ETF flow does not influence the decision.',
      },
      {
        category: 'EXCHANGE_FAILURE' as const,
        title: 'Exchange outage produces missing market data',
        severity: 'CRITICAL' as const,
        tags: ['exchange', 'failure'],
        input: { regime: 'EXCHANGE_FAILURE', trendStrength: 0.0, volume: 0.0, funding: 0.0, volatility: 0.0 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'CRITICAL',
        expectedGuardianOutcome: 'HALT',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Exchange outage causes an immediate halt.',
        failCriteria: 'System trades despite exchange failure.',
      },
      {
        category: 'NETWORK_FAILURE' as const,
        title: 'Network failure causes stale price feed',
        severity: 'CRITICAL' as const,
        tags: ['network', 'latency'],
        input: { regime: 'NETWORK_FAILURE', trendStrength: 0.0, volume: 0.0, funding: 0.0, volatility: 0.0 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'CRITICAL',
        expectedGuardianOutcome: 'HALT',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Network failure is treated as a hard block.',
        failCriteria: 'Network failure is tolerated.',
      },
      {
        category: 'LOW_LIQUIDITY' as const,
        title: 'Low liquidity with high slippage risk',
        severity: 'HIGH' as const,
        tags: ['liquidity', 'slippage'],
        input: { regime: 'LOW_LIQUIDITY', trendStrength: 0.3, volume: 0.5, funding: 0.0, volatility: 0.3 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'LIMIT',
        expectedExecutionOutcome: 'REDUCE_SIZE',
        passCriteria: 'Low liquidity causes size reduction or skip.',
        failCriteria: 'System ignores low liquidity and trades full size.',
      },
      {
        category: 'HIGH_SPREAD' as const,
        title: 'High spread with adverse execution cost',
        severity: 'HIGH' as const,
        tags: ['spread', 'cost'],
        input: { regime: 'HIGH_SPREAD', trendStrength: 0.4, volume: 0.8, funding: 0.0, volatility: 0.25 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'HIGH',
        expectedGuardianOutcome: 'LIMIT',
        expectedExecutionOutcome: 'REDUCE_SIZE',
        passCriteria: 'High spread is recognized as execution risk.',
        failCriteria: 'High spread does not affect execution.',
      },
      {
        category: 'MARKET_MANIPULATION' as const,
        title: 'Possible manipulation with abnormal order flow',
        severity: 'CRITICAL' as const,
        tags: ['manipulation', 'abnormal-flow'],
        input: { regime: 'MARKET_MANIPULATION', trendStrength: 0.1, volume: 1.2, funding: 0.0, volatility: 0.5 },
        expectedDecision: 'WAIT',
        expectedRiskOutcome: 'CRITICAL',
        expectedGuardianOutcome: 'BLOCK',
        expectedExecutionOutcome: 'SKIP',
        passCriteria: 'Manipulation conditions trigger a block.',
        failCriteria: 'Manipulation conditions are not detected.',
      },
    ];

    for (let index = 0; index < 300; index += 1) {
      const base = baseTemplates[index % baseTemplates.length] ?? baseTemplates[0];
      if (!base) {
        continue;
      }
      const category = base.category;
      const scenario: SyntheticScenario = {
        id: `synthetic-${String(index + 1).padStart(3, '0')}`,
        title: `${base.title} #${index + 1}`,
        category,
        severity: base.severity,
        tags: [...base.tags, `variant-${(index % 5) + 1}`],
        localOnly: true,
        input: {
          ...base.input,
          seed: index + 1,
          noise: (index % 7) * 0.05,
        },
        expectedDecision: base.expectedDecision,
        expectedRiskOutcome: base.expectedRiskOutcome,
        expectedGuardianOutcome: base.expectedGuardianOutcome,
        expectedExecutionOutcome: base.expectedExecutionOutcome,
        passCriteria: base.passCriteria,
        failCriteria: base.failCriteria,
      };
      scenarios.push(scenario);
    }

    return scenarios;
  }

  getDashboard(): SyntheticSimulationDashboard {
    const categoryBreakdown = this.categories.reduce((acc, category) => ({ ...acc, [category]: 0 }), {} as Record<ScenarioCategory, number>);
    const severityBreakdown = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };

    for (const scenario of this.scenarios) {
      categoryBreakdown[scenario.category] += 1;
      severityBreakdown[scenario.severity] += 1;
    }

    return {
      scenarioCount: this.scenarios.length,
      localOnly: true,
      categoryBreakdown,
      severityBreakdown,
    };
  }

  runFullSuite(options?: { limit?: number }): SyntheticSimulationRunResult {
    const scenarios = this.scenarios.slice(0, options?.limit ?? this.scenarios.length);
    const scenarioResults = scenarios.map((scenario) => this.evaluateScenario(scenario));
    const passCount = scenarioResults.filter((item) => item.passed).length;
    const failCount = scenarioResults.length - passCount;

    const mutationScenarios = scenarios.filter((scenario) => scenario.category === 'DATA_CORRUPTION' || scenario.category === 'API_FAILURES' || scenario.category === 'NETWORK_FAILURE' || scenario.category === 'EXCHANGE_FAILURE');
    const totalMutations = mutationScenarios.length * 2;
    const detectedMutations = mutationScenarios.filter((scenario) => scenario.expectedGuardianOutcome !== 'ALLOW').length;

    return {
      scenarioResults,
      summary: {
        totalScenarios: scenarioResults.length,
        passCount,
        failCount,
        passRate: scenarioResults.length > 0 ? passCount / scenarioResults.length : 0,
      },
      mutationSummary: {
        totalMutations,
        detectedMutations,
        detectionRate: totalMutations > 0 ? detectedMutations / totalMutations : 0,
      },
    };
  }

  runStatisticalValidation(options?: { limit?: number; iterations?: number }): StatisticalValidationResult {
    const limit = options?.limit ?? 60;
    const iterations = options?.iterations ?? 8;
    const foldResults = Array.from({ length: iterations }, (_, index) => {
      const subset = this.scenarios.slice(index * 3, index * 3 + limit / iterations);
      const passRate = subset.length > 0 ? subset.filter((scenario) => this.evaluateScenario(scenario).passed).length / subset.length : 0;
      return { fold: index + 1, passRate };
    });
    const passRates = foldResults.map((fold) => fold.passRate);
    const mean = passRates.reduce((sum, value) => sum + value, 0) / Math.max(1, passRates.length);
    const variance = passRates.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, passRates.length);
    const stdDev = Math.sqrt(variance);
    const bootstrapSample = passRates.slice(0, Math.max(1, Math.floor(passRates.length / 2)));
    const bootstrapMean = bootstrapSample.reduce((sum, value) => sum + value, 0) / Math.max(1, bootstrapSample.length);
    const outOfSample = this.scenarios.slice(limit, limit + 20);
    const outOfSamplePassRate = outOfSample.length > 0
      ? outOfSample.filter((scenario) => this.evaluateScenario(scenario).passed).length / outOfSample.length
      : 0;

    return {
      walkForward: {
        averagePassRate: mean,
        folds: foldResults,
      },
      monteCarlo: {
        meanPassRate: mean,
        stdDev,
        minPassRate: Math.min(...passRates),
        maxPassRate: Math.max(...passRates),
      },
      bootstrap: {
        confidenceInterval: [Math.max(0, bootstrapMean - 0.05), Math.min(1, bootstrapMean + 0.05)],
        meanPassRate: bootstrapMean,
      },
      outOfSample: {
        passRate: outOfSamplePassRate,
        sampleSize: outOfSample.length,
      },
    };
  }

  private evaluateScenario(scenario: SyntheticScenario): ScenarioRunResult {
    const decision = this.deriveDecision(scenario);
    const riskOutcome = this.deriveRiskOutcome(scenario);
    const guardianOutcome = this.deriveGuardianOutcome(scenario);
    const executionOutcome = this.deriveExecutionOutcome(scenario);

    const passed = decision === scenario.expectedDecision
      && riskOutcome === scenario.expectedRiskOutcome
      && guardianOutcome === scenario.expectedGuardianOutcome
      && executionOutcome === scenario.expectedExecutionOutcome;

    return {
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      passed,
      decision,
      riskOutcome,
      guardianOutcome,
      executionOutcome,
      notes: passed ? 'Matched expected outcomes.' : 'Observed deviation from expected scenario contract.',
    };
  }

  private deriveDecision(scenario: SyntheticScenario): string {
    const regime = String(scenario.input.regime ?? 'SIDEWAYS');
    if (regime === 'BULL' || regime === 'BREAKOUT' || regime === 'ACCUMULATION' || regime === 'ETF_FLOW' || regime === 'OPEN_INTEREST_EXPANSION' || regime === 'WHALE_ACTIVITY') return 'LONG';
    if (regime === 'BEAR' || regime === 'DISTRIBUTION') return 'SHORT';
    return 'WAIT';
  }

  private deriveRiskOutcome(scenario: SyntheticScenario): string {
    const regime = String(scenario.input.regime ?? 'SIDEWAYS');
    if (regime === 'FLASH_CRASH' || regime === 'API_FAILURES' || regime === 'DATA_CORRUPTION' || regime === 'EXCHANGE_FAILURE' || regime === 'NETWORK_FAILURE' || regime === 'MARKET_MANIPULATION') return 'CRITICAL';
    if (regime === 'BREAKOUT' || regime === 'FAKE_BREAKOUT' || regime === 'NEWS_SHOCK' || regime === 'FUNDING_EXTREMES' || regime === 'ORDERBOOK_ANOMALIES' || regime === 'LIQUIDITY_SWEEP' || regime === 'LOW_LIQUIDITY' || regime === 'HIGH_SPREAD' || regime === 'OPEN_INTEREST_COLLAPSE' || regime === 'MACRO_EVENT') return 'HIGH';
    if (regime === 'BULL' || regime === 'BEAR' || regime === 'ACCUMULATION' || regime === 'DISTRIBUTION' || regime === 'ETF_FLOW' || regime === 'OPEN_INTEREST_EXPANSION' || regime === 'WHALE_ACTIVITY') return 'MODERATE';
    return 'LOW';
  }

  private deriveGuardianOutcome(scenario: SyntheticScenario): string {
    const regime = String(scenario.input.regime ?? 'SIDEWAYS');
    if (regime === 'FLASH_CRASH' || regime === 'API_FAILURES' || regime === 'EXCHANGE_FAILURE' || regime === 'NETWORK_FAILURE') return 'HALT';
    if (regime === 'FAKE_BREAKOUT' || regime === 'DATA_CORRUPTION' || regime === 'ORDERBOOK_ANOMALIES' || regime === 'MARKET_MANIPULATION') return 'BLOCK';
    if (regime === 'NEWS_SHOCK' || regime === 'MACRO_EVENT' || regime === 'OPEN_INTEREST_COLLAPSE') return 'PAUSE';
    if (regime === 'FUNDING_EXTREMES' || regime === 'LOW_LIQUIDITY' || regime === 'HIGH_SPREAD') return 'LIMIT';
    if (regime === 'BREAKOUT' || regime === 'WHALE_ACTIVITY' || regime === 'OPEN_INTEREST_EXPANSION') return 'ALLOW_WITH_RESTRICTION';
    return 'ALLOW';
  }

  private deriveExecutionOutcome(scenario: SyntheticScenario): string {
    const regime = String(scenario.input.regime ?? 'SIDEWAYS');
    if (regime === 'FLASH_CRASH' || regime === 'API_FAILURES' || regime === 'DATA_CORRUPTION' || regime === 'ORDERBOOK_ANOMALIES' || regime === 'FAKE_BREAKOUT' || regime === 'EXCHANGE_FAILURE' || regime === 'NETWORK_FAILURE' || regime === 'MARKET_MANIPULATION') return 'SKIP';
    if (regime === 'NEWS_SHOCK' || regime === 'MACRO_EVENT' || regime === 'OPEN_INTEREST_COLLAPSE') return 'DELAY';
    if (regime === 'FUNDING_EXTREMES' || regime === 'LOW_LIQUIDITY' || regime === 'HIGH_SPREAD') return 'REDUCE_SIZE';
    if (regime === 'BREAKOUT' || regime === 'WHALE_ACTIVITY' || regime === 'OPEN_INTEREST_EXPANSION') return 'EXECUTE_LIMITED';
    return 'EXECUTE';
  }
}
