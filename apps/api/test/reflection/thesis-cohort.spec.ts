import { describe, expect, it, vi } from 'vitest';
import {
  buildThesisCohortKey,
  parseThesisCohortKey,
  deduplicateLifecycleOutcomes,
  calibrateCohortFromLifecycle,
  evaluateThesisCohort,
  evaluateProfitAuthority,
  selectExactCohortOutcomes,
  calculateCriticLift,
  type ThesisCohortKeyParams,
} from '../../src/modules/reflection/domain/thesis-cohort';
import type { TradeLifecycleOutcome } from '../../src/modules/research/domain/trade-lifecycle';

describe('Thesis Cohort Calibration & AI Lift Domain', () => {
  const defaultCohortParams: ThesisCohortKeyParams = {
    symbol: 'BTC-USDT',
    timeframe: '15m',
    regime: 'TRENDING_UP',
    direction: 'LONG',
    setup: 'BREAKOUT',
    executionPolicyVersion: 'v1',
  };

  const profitOutcome = (
    thesisId: string,
    netR: number,
    sequence: number,
  ): TradeLifecycleOutcome => ({
    thesisId,
    symbol: 'BTC-USDT',
    provider: 'BINANCE',
    timeframe: '15m',
    direction: 'LONG',
    setup: 'BREAKOUT',
    regime: 'TRENDING_UP',
    status: 'FINALIZED',
    sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
    openedAt: new Date(`2026-09-${String(1 + sequence).padStart(2, '0')}T00:00:00.000Z`),
    closedAt: new Date(`2026-09-${String(1 + sequence).padStart(2, '0')}T01:00:00.000Z`),
    totalEnteredQuantity: 1,
    totalExitedQuantity: 1,
    averageEntryPrice: 100,
    averageExitPrice: 100 + netR * 10,
    realizedGrossPnl: netR * 10,
    signedFees: 0,
    signedFunding: 0,
    realizedNetPnl: netR * 10,
    initialRisk: 10,
    netR,
    schemaVersion: 1,
    calculationVersion: 1,
    configurationHash: 'v1',
  });

  it('governs exact lifecycle sizing with mature, stable, distributed profitability', () => {
    const immature = Array.from({ length: 29 }, (_, index) =>
      profitOutcome(`immature-${index}`, index % 3 === 0 ? -1 : 1, index),
    );
    const stablePositive = Array.from({ length: 30 }, (_, index) =>
      profitOutcome(`stable-${index}`, index % 3 === 0 ? -1 : 1, index),
    );
    const matureNegative = Array.from({ length: 20 }, (_, index) =>
      profitOutcome(`negative-${index}`, index % 4 === 0 ? 0.5 : -1, index),
    );
    const concentrated = [
      profitOutcome('concentrated-winner', 20, 0),
      ...Array.from({ length: 29 }, (_, index) =>
        profitOutcome(`concentrated-${index}`, index % 2 === 0 ? 1 : -1, index + 1),
      ),
    ];

    expect(evaluateProfitAuthority(immature)).toMatchObject({
      action: 'PROBE_ONLY',
      sampleSize: 29,
      sizeFactor: 0.15,
    });
    expect(evaluateProfitAuthority(stablePositive)).toMatchObject({
      action: 'FULL_SIZE',
      sampleSize: 30,
      profitFactor: 2,
      sequentialWindows: { allPositive: true },
    });
    expect(evaluateProfitAuthority(matureNegative)).toMatchObject({
      action: 'SUPPRESSED',
      sampleSize: 20,
    });
    expect(evaluateProfitAuthority(concentrated)).toMatchObject({
      action: 'PROBE_ONLY',
      sampleSize: 30,
    });
    expect(evaluateProfitAuthority(concentrated).largestWinnerConcentration).toBeGreaterThan(0.35);
  });

  it('deduplicates a thesis before calculating profitability authority', () => {
    const outcomes = Array.from({ length: 29 }, (_, index) =>
      profitOutcome(`unique-${index}`, index % 3 === 0 ? -1 : 1, index),
    );
    outcomes.push(profitOutcome('revised-thesis', -5, 29));
    outcomes.push(profitOutcome('revised-thesis', 1, 30));

    const authority = evaluateProfitAuthority(outcomes);

    expect(authority).toMatchObject({ action: 'FULL_SIZE', sampleSize: 30 });
    expect(authority.netExpectancy).toBeCloseTo(0.3333, 4);
  });

  it('excludes lifecycle outcomes with missing exact cohort dimensions from full-size authority', () => {
    const exactOutcomes = Array.from({ length: 29 }, (_, index) =>
      profitOutcome(`exact-${index}`, index % 3 === 0 ? -1 : 1, index),
    );
    const missingRegime = profitOutcome('missing-regime', 1, 29);
    delete missingRegime.regime;

    const authority = evaluateProfitAuthority(
      selectExactCohortOutcomes(defaultCohortParams, [...exactOutcomes, missingRegime]),
    );

    expect(authority).toMatchObject({ action: 'PROBE_ONLY', sampleSize: 29 });
  });

  it('1. Formats and parses cohort key as symbol|timeframe|regime|direction|setup|executionPolicyVersion', () => {
    const key = buildThesisCohortKey(defaultCohortParams);
    expect(key).toBe('BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1');

    const parsed = parseThesisCohortKey(key);
    expect(parsed).toEqual(defaultCohortParams);
  });

  it('1b. Formats and parses cohort key with configurationHash as 7-segment key', () => {
    const withHash = { ...defaultCohortParams, configurationHash: 'cfg-hash-123' };
    const key = buildThesisCohortKey(withHash);
    expect(key).toBe('BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1|cfg-hash-123');

    const parsed = parseThesisCohortKey(key);
    expect(parsed).toEqual(withHash);
  });

  it('2. Overlapping updates from one thesis count exactly once (unique by thesisId)', () => {
    const thesisId = 'thesis-duplicate-test-1';
    const baseCutoff = new Date('2026-09-10T10:00:00.000Z');

    // Simulate 3 intermediate / overlapping outcome updates for the same thesis
    const updates: TradeLifecycleOutcome[] = [
      {
        thesisId,
        symbol: 'BTC-USDT',
        provider: 'BINANCE',
        timeframe: '15m',
        direction: 'LONG',
        setup: 'BREAKOUT',
        regime: 'TRENDING_UP',
        status: 'OPEN',
        sourceDataCutoff: baseCutoff,
        openedAt: new Date('2026-09-10T10:05:00.000Z'),
        closedAt: null,
        totalEnteredQuantity: 1.0,
        totalExitedQuantity: 0.5,
        averageEntryPrice: 50000,
        averageExitPrice: 51000,
        realizedGrossPnl: 500,
        signedFees: -10,
        signedFunding: 0,
        realizedNetPnl: 490,
        initialRisk: 500,
        netR: 0.98,
        schemaVersion: 1,
        calculationVersion: 1,
        configurationHash: 'hash-v1',
        updatedAt: new Date('2026-09-10T10:15:00.000Z'),
      },
      {
        thesisId,
        symbol: 'BTC-USDT',
        provider: 'BINANCE',
        timeframe: '15m',
        direction: 'LONG',
        setup: 'BREAKOUT',
        regime: 'TRENDING_UP',
        status: 'FINALIZED',
        sourceDataCutoff: baseCutoff,
        openedAt: new Date('2026-09-10T10:05:00.000Z'),
        closedAt: new Date('2026-09-10T10:30:00.000Z'),
        totalEnteredQuantity: 1.0,
        totalExitedQuantity: 1.0,
        averageEntryPrice: 50000,
        averageExitPrice: 52000,
        realizedGrossPnl: 2000,
        signedFees: -20,
        signedFunding: -5,
        realizedNetPnl: 1975,
        initialRisk: 500,
        netR: 3.95,
        schemaVersion: 1,
        calculationVersion: 1,
        configurationHash: 'hash-v1',
        updatedAt: new Date('2026-09-10T10:30:00.000Z'),
      },
      {
        thesisId,
        symbol: 'BTC-USDT',
        provider: 'BINANCE',
        timeframe: '15m',
        direction: 'LONG',
        setup: 'BREAKOUT',
        regime: 'TRENDING_UP',
        status: 'FINALIZED',
        sourceDataCutoff: baseCutoff,
        openedAt: new Date('2026-09-10T10:05:00.000Z'),
        closedAt: new Date('2026-09-10T10:30:00.000Z'),
        totalEnteredQuantity: 1.0,
        totalExitedQuantity: 1.0,
        averageEntryPrice: 50000,
        averageExitPrice: 52000,
        realizedGrossPnl: 2000,
        signedFees: -20,
        signedFunding: -5,
        realizedNetPnl: 1975,
        initialRisk: 500,
        netR: 3.95,
        schemaVersion: 1,
        calculationVersion: 1,
        configurationHash: 'hash-v1',
        updatedAt: new Date('2026-09-10T10:30:00.000Z'),
      },
    ];

    const deduplicated = deduplicateLifecycleOutcomes(updates);
    expect(deduplicated).toHaveLength(1);
    const item = deduplicated[0]!;
    expect(item.thesisId).toBe(thesisId);
    expect(item.status).toBe('FINALIZED');
    expect(item.netR).toBe(3.95);

    // Calibration on the raw list with duplicates should yield sampleSize = 1
    const calibration = calibrateCohortFromLifecycle(updates);
    expect(calibration.sampleSize).toBe(1);
    expect(calibration.meanNetR).toBeCloseTo(3.95, 2);
  });

  it('3. Calibrates cohort metrics from finalized lifecycle outcomes in net R', () => {
    // Generate 25 finalized outcomes: 15 winners (+1.5R each) and 10 losers (-1.0R each)
    const outcomes: TradeLifecycleOutcome[] = Array.from({ length: 25 }, (_, i) => ({
      thesisId: `thesis-calib-${i}`,
      symbol: 'BTC-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'LONG' as const,
      setup: 'BREAKOUT',
      regime: 'TRENDING_UP',
      status: 'FINALIZED' as const,
      sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
      openedAt: new Date('2026-09-10T01:00:00.000Z'),
      closedAt: new Date('2026-09-10T02:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 100,
      averageExitPrice: i < 15 ? 115 : 90,
      realizedGrossPnl: i < 15 ? 15 : -10,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: i < 15 ? 15 : -10,
      initialRisk: 10,
      netR: i < 15 ? 1.5 : -1.0,
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    }));

    // Add 1 OPEN outcome that must be ignored
    outcomes.push({
      thesisId: 'thesis-open-ignored',
      symbol: 'BTC-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'LONG',
      setup: 'BREAKOUT',
      regime: 'TRENDING_UP',
      status: 'OPEN',
      sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
      openedAt: new Date('2026-09-10T01:00:00.000Z'),
      closedAt: null,
      totalEnteredQuantity: 1,
      totalExitedQuantity: 0,
      averageEntryPrice: 100,
      averageExitPrice: null,
      realizedGrossPnl: 0,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: 0,
      initialRisk: 10,
      netR: null,
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    });

    const metrics = calibrateCohortFromLifecycle(outcomes, { minSampleSize: 20 });
    expect(metrics.sampleSize).toBe(25);
    expect(metrics.status).toBe('CALIBRATED');
    expect(metrics.winRate).toBeCloseTo(15 / 25, 2); // 60%
    // Total R: 15 * 1.5 - 10 * 1.0 = 22.5 - 10 = 12.5. Mean = 12.5 / 25 = 0.5R
    expect(metrics.meanNetR).toBeCloseTo(0.5, 2);
    // Profit factor in R: 22.5 / 10 = 2.25
    expect(metrics.profitFactor).toBeCloseTo(2.25, 2);
    expect(metrics.grossRProfit).toBe(22.5);
    expect(metrics.grossRLoss).toBe(10);
  });

  it('4. Hierarchical fallback: when exact cohort evidence is insufficient, returns REDUCE_SIZE (bounded size factor), never full approval', () => {
    // Exact cohort has only 1 sample (insufficient for 20 sample minimum)
    const exactOutcomes: TradeLifecycleOutcome[] = [
      {
        thesisId: 'exact-1',
        symbol: 'ETH-USDT',
        provider: 'BINANCE',
        timeframe: '15m',
        direction: 'LONG',
        setup: 'BREAKOUT',
        regime: 'TRENDING_UP',
        status: 'FINALIZED',
        sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
        openedAt: new Date('2026-09-10T01:00:00.000Z'),
        closedAt: new Date('2026-09-10T02:00:00.000Z'),
        totalEnteredQuantity: 1,
        totalExitedQuantity: 1,
        averageEntryPrice: 2000,
        averageExitPrice: 2100,
        realizedGrossPnl: 100,
        signedFees: 0,
        signedFunding: 0,
        realizedNetPnl: 100,
        initialRisk: 50,
        netR: 2.0,
        schemaVersion: 1,
        calculationVersion: 1,
        configurationHash: 'v1',
      },
    ];

    // Broader bucket has 30 samples and very high performance (+2.0R average)
    const broaderOutcomes: TradeLifecycleOutcome[] = Array.from({ length: 30 }, (_, i) => ({
      thesisId: `broader-${i}`,
      symbol: 'BTC-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'LONG' as const,
      setup: 'BREAKOUT',
      regime: 'TRENDING_UP',
      status: 'FINALIZED' as const,
      sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
      openedAt: new Date('2026-09-10T01:00:00.000Z'),
      closedAt: new Date('2026-09-10T02:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 50000,
      averageExitPrice: 52000,
      realizedGrossPnl: 2000,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: 2000,
      initialRisk: 1000,
      netR: 2.0,
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    }));

    const allHistory = [...exactOutcomes, ...broaderOutcomes];
    const targetKey = 'ETH-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1';

    const decision = evaluateThesisCohort(targetKey, allHistory, {
      minExactSamples: 20,
      minBroaderSamples: 20,
    });

    // CRITICAL: Hierarchical fallback must return REDUCE_SIZE, NEVER APPROVE
    expect(decision.action).toBe('REDUCE_SIZE');
    expect(decision.action).not.toBe('APPROVE');
    // Size factor must be bounded (e.g. <= 0.5, > 0)
    expect(decision.sizeFactor).toBeGreaterThan(0);
    expect(decision.sizeFactor).toBeLessThanOrEqual(0.5);
    expect(decision.scope).toBe('BROADER');
  });

  it('5. Cross-symbol isolation: BNB and SOL negative history cannot hard-block ZEC', () => {
    // Create 40 losing trades for BNB in SHORT BREAKOUT
    const bnbOutcomes: TradeLifecycleOutcome[] = Array.from({ length: 40 }, (_, i) => ({
      thesisId: `bnb-loss-${i}`,
      symbol: 'BNB-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'SHORT' as const,
      setup: 'BREAKOUT',
      regime: 'TRENDING_DOWN',
      status: 'FINALIZED' as const,
      sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
      openedAt: new Date('2026-09-10T01:00:00.000Z'),
      closedAt: new Date('2026-09-10T02:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 500,
      averageExitPrice: 520,
      realizedGrossPnl: -20,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: -20,
      initialRisk: 20,
      netR: -1.0,
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    }));

    // Create 35 losing trades for SOL in SHORT BREAKOUT
    const solOutcomes: TradeLifecycleOutcome[] = Array.from({ length: 35 }, (_, i) => ({
      thesisId: `sol-loss-${i}`,
      symbol: 'SOL-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'SHORT' as const,
      setup: 'BREAKOUT',
      regime: 'TRENDING_DOWN',
      status: 'FINALIZED' as const,
      sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
      openedAt: new Date('2026-09-10T01:00:00.000Z'),
      closedAt: new Date('2026-09-10T02:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 150,
      averageExitPrice: 160,
      realizedGrossPnl: -10,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: -10,
      initialRisk: 10,
      netR: -1.0,
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    }));

    const allHistory = [...bnbOutcomes, ...solOutcomes];

    // Evaluating BNB directly should return BLOCK because of reliable exact negative history
    const bnbDecision = evaluateThesisCohort(
      'BNB-USDT|15m|TRENDING_DOWN|SHORT|BREAKOUT|v1',
      allHistory,
      { minExactSamples: 20 },
    );
    expect(bnbDecision.action).toBe('BLOCK');
    expect(bnbDecision.sizeFactor).toBe(0);
    expect(bnbDecision.scope).toBe('EXACT');

    // Evaluating ZEC (which has 0 exact history) in the same timeframe, regime, direction, and setup
    const zecDecision = evaluateThesisCohort(
      'ZEC-USDT|15m|TRENDING_DOWN|SHORT|BREAKOUT|v1',
      allHistory,
      { minExactSamples: 20 },
    );

    // CRITICAL REQUIREMENT: BNB/SOL negative history CANNOT hard-block ZEC
    expect(zecDecision.action).not.toBe('BLOCK');
    expect(zecDecision.action).toBe('REDUCE_SIZE');
    expect(zecDecision.sizeFactor).toBeGreaterThan(0);
    expect(zecDecision.sizeFactor).toBeLessThanOrEqual(0.5);
  });

  it('6. Critic lift calculation: computes avoided-loss, missed-win, and net lift across paired candidates (Rules vs AI Researcher vs AI+Critic)', () => {
    const pairedCandidates = [
      // Candidate 1: AI Researcher loss (-1.2R). Critic BLOCKED. Avoided loss = 1.2R, missed win = 0.
      {
        candidateId: 'cand-1',
        symbol: 'BTC-USDT',
        rulesNetR: 0, // Rules passed
        aiResearcherNetR: -1.2,
        criticAction: 'BLOCK' as const,
        criticSizeFactor: 0,
      },
      // Candidate 2: AI Researcher loss (-1.0R). Critic REDUCED size to 0.5. Avoided loss = 0.5R, missed win = 0.
      {
        candidateId: 'cand-2',
        symbol: 'ETH-USDT',
        rulesNetR: -1.0,
        aiResearcherNetR: -1.0,
        criticAction: 'REDUCE_SIZE' as const,
        criticSizeFactor: 0.5,
      },
      // Candidate 3: AI Researcher win (+2.0R). Critic erroneously BLOCKED. Avoided loss = 0, missed win = 2.0R.
      {
        candidateId: 'cand-3',
        symbol: 'SOL-USDT',
        rulesNetR: 0,
        aiResearcherNetR: 2.0,
        criticAction: 'BLOCK' as const,
        criticSizeFactor: 0,
      },
      // Candidate 4: AI Researcher win (+2.0R). Critic REDUCED size to 0.5. Avoided loss = 0, missed win = 1.0R.
      {
        candidateId: 'cand-4',
        symbol: 'AVAX-USDT',
        rulesNetR: 1.5,
        aiResearcherNetR: 2.0,
        criticAction: 'REDUCE_SIZE' as const,
        criticSizeFactor: 0.5,
      },
      // Candidate 5: AI Researcher win (+3.0R). Critic APPROVED full size. Avoided loss = 0, missed win = 0.
      {
        candidateId: 'cand-5',
        symbol: 'NEAR-USDT',
        rulesNetR: 1.0,
        aiResearcherNetR: 3.0,
        criticAction: 'APPROVE' as const,
        criticSizeFactor: 1.0,
      },
    ];

    const report = calculateCriticLift(pairedCandidates);

    // Assertions for Candidate 1 (Avoided loss: 1.2R)
    const c1 = report.candidates.find((c) => c.candidateId === 'cand-1')!;
    expect(c1.avoidedLossR).toBeCloseTo(1.2, 2);
    expect(c1.missedWinR).toBe(0);
    expect(c1.aiWithCriticNetR).toBe(0);
    expect(c1.netCriticLiftR).toBeCloseTo(1.2, 2);

    // Assertions for Candidate 2 (Avoided loss: 0.5R)
    const c2 = report.candidates.find((c) => c.candidateId === 'cand-2')!;
    expect(c2.avoidedLossR).toBeCloseTo(0.5, 2);
    expect(c2.missedWinR).toBe(0);
    expect(c2.aiWithCriticNetR).toBeCloseTo(-0.5, 2);
    expect(c2.netCriticLiftR).toBeCloseTo(0.5, 2);

    // Assertions for Candidate 3 (Missed win: 2.0R)
    const c3 = report.candidates.find((c) => c.candidateId === 'cand-3')!;
    expect(c3.avoidedLossR).toBe(0);
    expect(c3.missedWinR).toBeCloseTo(2.0, 2);
    expect(c3.aiWithCriticNetR).toBe(0);
    expect(c3.netCriticLiftR).toBeCloseTo(-2.0, 2);

    // Assertions for Candidate 4 (Missed win: 1.0R)
    const c4 = report.candidates.find((c) => c.candidateId === 'cand-4')!;
    expect(c4.avoidedLossR).toBe(0);
    expect(c4.missedWinR).toBeCloseTo(1.0, 2);
    expect(c4.aiWithCriticNetR).toBeCloseTo(1.0, 2);
    expect(c4.netCriticLiftR).toBeCloseTo(-1.0, 2);

    // Assertions for Candidate 5 (Approved win: +3.0R)
    const c5 = report.candidates.find((c) => c.candidateId === 'cand-5')!;
    expect(c5.avoidedLossR).toBe(0);
    expect(c5.missedWinR).toBe(0);
    expect(c5.aiWithCriticNetR).toBeCloseTo(3.0, 2);
    expect(c5.netCriticLiftR).toBe(0);

    // Aggregate Critic Lift
    // Total avoided loss = 1.2 + 0.5 = 1.7R
    expect(report.totalAvoidedLossR).toBeCloseTo(1.7, 2);
    // Total missed win = 2.0 + 1.0 = 3.0R
    expect(report.totalMissedWinR).toBeCloseTo(3.0, 2);
    // Net Critic lift = 1.7 - 3.0 = -1.3R
    expect(report.netLiftR).toBeCloseTo(-1.3, 2);

    // Comparison across all 3 modes:
    // Rules total Net R: 0 + (-1.0) + 0 + 1.5 + 1.0 = 1.5R
    expect(report.rules.totalNetR).toBeCloseTo(1.5, 2);

    // AI Researcher total Net R: -1.2 + (-1.0) + 2.0 + 2.0 + 3.0 = 4.8R
    expect(report.aiResearcher.totalNetR).toBeCloseTo(4.8, 2);

    // AI With Critic total Net R: 0 + (-0.5) + 0 + 1.0 + 3.0 = 3.5R
    expect(report.aiWithCritic.totalNetR).toBeCloseTo(3.5, 2);

    // Verification: aiWithCritic.totalNetR - aiResearcher.totalNetR = 3.5 - 4.8 = -1.3 = netLiftR
    expect(report.aiWithCritic.totalNetR - report.aiResearcher.totalNetR).toBeCloseTo(report.netLiftR, 2);

    // Lift vs Rules:
    // AI Researcher lift vs rules: 4.8 - 1.5 = 3.3R
    expect(report.liftVsRules.aiResearcherLiftR).toBeCloseTo(3.3, 2);
    // AI with Critic lift vs rules: 3.5 - 1.5 = 2.0R
    expect(report.liftVsRules.aiWithCriticLiftR).toBeCloseTo(2.0, 2);
  });

  it('7. Confidence calibration hierarchical fallback returns REDUCE_SIZE (never APPROVE) when exact history is insufficient', async () => {
    const { calibrateLifecycleWithHierarchicalFallback } = await import(
      '../../src/modules/reflection/domain/confidence-calibration'
    );

    // Exact scope has only 2 outcomes
    const exactOutcomes = [
      { thesisId: 'e-1', confidence: 75, netR: 1.5, status: 'FINALIZED' },
      { thesisId: 'e-2', confidence: 75, netR: -1.0, status: 'FINALIZED' },
    ];

    // Broader scope has 60 outcomes with high win rate
    const broaderOutcomes = Array.from({ length: 60 }, (_, i) => ({
      thesisId: `b-${i}`,
      confidence: 75,
      netR: i < 45 ? 1.5 : -1.0,
      status: 'FINALIZED',
    }));

    const result = calibrateLifecycleWithHierarchicalFallback(75, [
      { scope: 'EXACT', outcomes: exactOutcomes },
      { scope: 'STRATEGY_CONTEXT', outcomes: broaderOutcomes },
    ]);

    // Fallback must return REDUCE_SIZE, NEVER APPROVE
    expect(result.action).toBe('REDUCE_SIZE');
    expect(result.action).not.toBe('APPROVE');
    expect(result.sizeFactor).toBeLessThanOrEqual(0.5);
    expect(result.fallbackUsed).toBe(true);
    expect(result.hardGateEligible).toBe(false);
  });

  it('8. SelfLearningService evaluates thesis cohort and calculates critic lift via Prisma records', async () => {
    const { SelfLearningService } = await import(
      '../../src/modules/reflection/application/self-learning.service'
    );

    const mockFindManyLifecycle = vi.fn().mockResolvedValue([
      {
        id: 'out-1',
        thesisId: 'th-1',
        symbol: 'BTC-USDT',
        provider: 'BINANCE',
        timeframe: '15m',
        direction: 'LONG',
        setup: 'BREAKOUT',
        regime: 'TRENDING_UP',
        status: 'FINALIZED',
        sourceDataCutoff: new Date(),
        openedAt: new Date(),
        closedAt: new Date(),
        totalEnteredQuantity: 1,
        totalExitedQuantity: 1,
        averageEntryPrice: 50000,
        averageExitPrice: 52000,
        realizedGrossPnl: 2000,
        signedFees: -10,
        signedFunding: 0,
        realizedNetPnl: 1990,
        initialRisk: 500,
        netR: 3.98,
        configurationHash: 'v1',
        schemaVersion: 1,
        calculationVersion: 1,
      },
    ]);

    const mockFindManyTheses = vi.fn().mockResolvedValue([
      {
        id: 'th-1',
        symbol: 'BTC-USDT',
        decisionSource: 'AI',
        lifecycleOutcome: { netR: -1.5, status: 'FINALIZED' },
        reviews: [{ action: 'BLOCK', sizeFactor: 0 }],
      },
      {
        id: 'th-2',
        symbol: 'ETH-USDT',
        decisionSource: 'RULES',
        lifecycleOutcome: { netR: 2.0, status: 'FINALIZED' },
        reviews: [{ action: 'APPROVE', sizeFactor: 1.0 }],
      },
    ]);

    const prismaMock = {
      tradeLifecycleOutcome: { findMany: mockFindManyLifecycle },
      tradeThesis: { findMany: mockFindManyTheses },
      selfLearningConfiguration: { findUnique: vi.fn() },
    };

    const service = new SelfLearningService(prismaMock as never, {} as never);

    const cohortEval = await service.evaluateCohortForThesis('BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1');
    expect(cohortEval.action).toBe('REDUCE_SIZE'); // Insufficient exact samples (1 < 20)
    expect(cohortEval.sizeFactor).toBeLessThanOrEqual(0.5);

    const liftReport = await service.calculateCriticLift('test-user');
    expect(liftReport.totalCandidates).toBe(2);
    // For th-1: raw netR = -1.5, Critic blocked -> avoided loss = 1.5R
    expect(liftReport.totalAvoidedLossR).toBeCloseTo(1.5, 2);
    expect(liftReport.totalMissedWinR).toBe(0);
    expect(liftReport.netLiftR).toBeCloseTo(1.5, 2);
  });

  it('9. Preserves break-even scratch trades (netR === 0) without dropping them as falsy', async () => {
    const { SelfLearningService } = await import(
      '../../src/modules/reflection/application/self-learning.service'
    );

    // Create 20 scratch trades with netR = 0
    const scratchOutcomes: TradeLifecycleOutcome[] = Array.from({ length: 20 }, (_, i) => ({
      thesisId: `scratch-${i}`,
      symbol: 'BTC-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'LONG' as const,
      setup: 'BREAKOUT',
      regime: 'TRENDING_UP',
      status: 'FINALIZED' as const,
      sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
      openedAt: new Date('2026-09-10T01:00:00.000Z'),
      closedAt: new Date('2026-09-10T02:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 100,
      averageExitPrice: 100,
      realizedGrossPnl: 0,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: 0,
      initialRisk: 10,
      netR: 0, // Exactly zero
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    }));

    const calibration = calibrateCohortFromLifecycle(scratchOutcomes, { minSampleSize: 20 });
    expect(calibration.sampleSize).toBe(20);
    expect(calibration.scratchCount).toBe(20);
    expect(calibration.winCount).toBe(0);
    expect(calibration.lossCount).toBe(0);
    expect(calibration.meanNetR).toBe(0);
    expect(calibration.status).toBe('CALIBRATED');

    // Also test SelfLearningService preserves netR = 0
    const prismaMock = {
      tradeLifecycleOutcome: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'scratch-1',
            thesisId: 'scratch-1',
            symbol: 'BTC-USDT',
            provider: 'BINANCE',
            timeframe: '15m',
            direction: 'LONG',
            setup: 'BREAKOUT',
            regime: 'TRENDING_UP',
            status: 'FINALIZED',
            sourceDataCutoff: new Date(),
            openedAt: new Date(),
            closedAt: new Date(),
            totalEnteredQuantity: 1,
            totalExitedQuantity: 1,
            averageEntryPrice: 100,
            averageExitPrice: 100,
            realizedGrossPnl: 0,
            signedFees: 0,
            signedFunding: 0,
            realizedNetPnl: 0,
            initialRisk: 10,
            netR: 0, // Zero net R
            configurationHash: 'v1',
            schemaVersion: 1,
            calculationVersion: 1,
          },
        ]),
      },
    };
    const service = new SelfLearningService(prismaMock as never, {} as never);
    const evalResult = await service.evaluateCohortForThesis('BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1');
    expect(evalResult.metrics?.meanNetR).toBe(0);
    expect(evalResult.metrics?.scratchCount).toBe(1);
  });

  it('10. Enforces strict execution policy matching and prevents version short-circuiting', () => {
    // 25 mature trades under execution policy v2
    const v2Outcomes: TradeLifecycleOutcome[] = Array.from({ length: 25 }, (_, i) => ({
      thesisId: `v2-${i}`,
      symbol: 'BTC-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'LONG' as const,
      setup: 'BREAKOUT',
      regime: 'TRENDING_UP',
      status: 'FINALIZED' as const,
      sourceDataCutoff: new Date('2026-09-10T00:00:00.000Z'),
      openedAt: new Date('2026-09-10T01:00:00.000Z'),
      closedAt: new Date('2026-09-10T02:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 100,
      averageExitPrice: 110,
      realizedGrossPnl: 10,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: 10,
      initialRisk: 5,
      netR: 2.0,
      schemaVersion: 2,
      calculationVersion: 2,
      configurationHash: 'policy-hash-v2',
    }));

    // Target is policy v1: v2 history must NOT match policy v1
    const v1Decision = evaluateThesisCohort(
      'BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1',
      v2Outcomes,
      { minExactSamples: 20 },
    );
    // With 0 matching v1 exact samples, it must fall back to REDUCE_SIZE (never APPROVE based on v2)
    expect(v1Decision.action).toBe('REDUCE_SIZE');
    expect(v1Decision.scope).not.toBe('EXACT');

    // Target is policy v2: exact policy matching is not by itself enough for full size.
    // The new lifecycle authority requires 30 exact outcomes, so 25 remains a probe.
    const v2Decision = evaluateThesisCohort(
      'BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v2',
      v2Outcomes,
      { minExactSamples: 20 },
    );
    expect(v2Decision.action).toBe('REDUCE_SIZE');
    expect(v2Decision.sizeFactor).toBeLessThanOrEqual(0.15);
    expect(v2Decision.sampleSize).toBe(25);
  });

  it('11. Point-in-time cutoff (asOf): excludes future lifecycle outcomes from cohort calibration', () => {
    const cutoffDate = new Date('2026-09-10T12:00:00.000Z');

    const pastOutcome: TradeLifecycleOutcome = {
      thesisId: 'past-1',
      symbol: 'BTC-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'LONG',
      setup: 'BREAKOUT',
      regime: 'TRENDING_UP',
      status: 'FINALIZED',
      sourceDataCutoff: new Date('2026-09-10T10:00:00.000Z'),
      openedAt: new Date('2026-09-10T10:15:00.000Z'),
      closedAt: new Date('2026-09-10T11:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 100,
      averageExitPrice: 110,
      realizedGrossPnl: 10,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: 10,
      initialRisk: 5,
      netR: 2.0,
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    };

    const futureOutcome: TradeLifecycleOutcome = {
      thesisId: 'future-1',
      symbol: 'BTC-USDT',
      provider: 'BINANCE',
      timeframe: '15m',
      direction: 'LONG',
      setup: 'BREAKOUT',
      regime: 'TRENDING_UP',
      status: 'FINALIZED',
      sourceDataCutoff: new Date('2026-09-10T13:00:00.000Z'),
      openedAt: new Date('2026-09-10T13:15:00.000Z'),
      closedAt: new Date('2026-09-10T14:00:00.000Z'),
      totalEnteredQuantity: 1,
      totalExitedQuantity: 1,
      averageEntryPrice: 100,
      averageExitPrice: 90,
      realizedGrossPnl: -10,
      signedFees: 0,
      signedFunding: 0,
      realizedNetPnl: -10,
      initialRisk: 5,
      netR: -2.0,
      schemaVersion: 1,
      calculationVersion: 1,
      configurationHash: 'v1',
    };

    const decision = evaluateThesisCohort(
      'BTC-USDT|15m|TRENDING_UP|LONG|BREAKOUT|v1',
      [pastOutcome, futureOutcome],
      { asOf: cutoffDate },
    );

    // Future outcome must be excluded, only pastOutcome should be evaluated
    expect(decision.metrics?.sampleSize).toBe(1);
    expect(decision.metrics?.meanNetR).toBe(2.0);
  });

  it('12. Explicitly maps REQUIRE_TRIGGER in Critic Lift as bounded/reduced confirmation', () => {
    const candidates = [
      {
        candidateId: 'cand-req-trigger',
        symbol: 'BTC-USDT',
        rulesNetR: 0,
        aiResearcherNetR: 2.0,
        criticAction: 'REQUIRE_TRIGGER' as const,
        criticSizeFactor: 0.5,
      },
      {
        candidateId: 'cand-req-trigger-loss',
        symbol: 'ETH-USDT',
        rulesNetR: 0,
        aiResearcherNetR: -1.0,
        criticAction: 'REQUIRE_TRIGGER' as const, // default 0.5 factor
      },
    ];

    const report = calculateCriticLift(candidates);
    expect(report.aiWithCritic.reducedCount).toBe(2);
    expect(report.aiWithCritic.approvedCount).toBe(0);

    const c1 = report.candidates[0]!;
    expect(c1.criticAction).toBe('REQUIRE_TRIGGER');
    expect(c1.criticSizeFactor).toBe(0.5);
    expect(c1.aiWithCriticNetR).toBeCloseTo(1.0, 2);
    expect(c1.missedWinR).toBeCloseTo(1.0, 2);

    const c2 = report.candidates[1]!;
    expect(c2.criticAction).toBe('REQUIRE_TRIGGER');
    expect(c2.criticSizeFactor).toBe(0.5);
    expect(c2.aiWithCriticNetR).toBeCloseTo(-0.5, 2);
    expect(c2.avoidedLossR).toBeCloseTo(0.5, 2);
  });
});
