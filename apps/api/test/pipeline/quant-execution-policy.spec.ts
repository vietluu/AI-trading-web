import { describe, expect, it, vi } from "vitest";
import { QuantExecutionPolicyService } from "../../src/modules/pipeline/application/quant-execution-policy.service";

const decision = (side: "LONG" | "SHORT" = "LONG", regime = "TRENDING") => ({ decision: side, regime: { type: regime } });
const strongDecision = (overrides: Record<string, unknown> = {}) => ({
  decision: "LONG",
  regime: { type: "TRENDING" },
  confidence: 75,
  opportunityScore: 72,
  expectedValue: 0.8,
  riskScore: 55,
  volatilityAdjustment: 0,
  dataQuality: "GOOD",
  coreDataQuality: "GOOD",
  directionalAgreement: 100,
  evidenceCoverage: 100,
  conflictLevel: "LOW",
  ...overrides,
});

function service(validation: Record<string, unknown> | null, regime: Record<string, unknown> | null = null) {
  const findFirst = vi.fn().mockResolvedValue(validation);
  return { policy: new QuantExecutionPolicyService({
    researchValidationRun: { findFirst },
    marketRegimeState: { findFirst: vi.fn().mockResolvedValue(regime) },
  } as never, { getUserLimits: () => Promise.resolve({ maxLeverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 }) } as never), findFirst };
}

function serviceWithLimits(validation: Record<string, unknown>, limits: Record<string, number>) {
  return new QuantExecutionPolicyService({
    researchValidationRun: { findFirst: vi.fn().mockResolvedValue(validation) },
    marketRegimeState: { findFirst: vi.fn().mockResolvedValue(null) },
  } as never, { getUserLimits: vi.fn().mockResolvedValue(limits) } as never);
}

const valid = (overrides: Record<string, unknown> = {}) => {
  const baseMetrics = {
    direction: "BOTH",
    regime: "ANY",
    executionPolicy: "DEFAULT",
    configurationVersion: 1,
    sampleEvidence: { totalTrades: 50, outOfSampleTrades: 12, walkForwardWindows: 5 },
    outOfSample: { outOfSampleTrades: 12 },
    walkForward: { windows: Array.from({ length: 5 }, () => ({})) },
    executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
    calibration: { evidenceSufficient: false },
  };
  const overrideMetrics =
    overrides.metricsJson && typeof overrides.metricsJson === 'object'
      ? (overrides.metricsJson as Record<string, unknown>)
      : {};
  return {
    interval: "15m",
    probabilityOfProfit: 62,
    probabilityOfRuin: 1,
    outOfSampleSharpe: 1.2,
    walkForwardStable: true,
    confidenceBrierScore: 0.18,
    createdAt: new Date("2026-08-12T00:00:00Z"),
    ...overrides,
    metricsJson: {
      ...baseMetrics,
      ...overrideMetrics,
    },
  };
};

describe("QuantExecutionPolicyService", () => {
  const input = {
    userId: "user-1", symbol: "ETH-USDT", provider: "OKX_FUTURES", timeframe: "15m",
    decision: decision() as never, now: new Date("2026-08-12T01:00:00Z"),
  };

  it("fails closed when exact validation is missing", async () => {
    await expect(service(null).policy.evaluate(input)).resolves.toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      evaluated: false,
      reason: "QUANT_VALIDATION_MISSING",
    });
  });

  it("allows a ZRO-like quarter-size canary when validation is missing but realtime evidence is strong", async () => {
    const result = await service(null).policy.evaluate({
      ...input,
      decision: strongDecision({
        confidence: 75,
        opportunityScore: 75,
        expectedValue: 0.935,
        riskScore: 55,
      }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 68.06,
    });

    expect(result).toMatchObject({
      allowed: true,
      evaluated: false,
      advisory: true,
      severity: 'REDUCE_SIZE',
      reason: "QUANT_VALIDATION_MISSING",
      sizeFactor: 0.25,
    });
  });

  it("does not allow the canary in high volatility or at an overbought primary RSI", async () => {
    const highVolatility = await service(null).policy.evaluate({
      ...input,
      decision: strongDecision({ regime: { type: "HIGH_VOLATILITY" } }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 75,
    });
    const overbought = await service(null).policy.evaluate({
      ...input,
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 82,
    });

    expect(highVolatility).toMatchObject({ allowed: false,
      severity: 'BLOCK', reason: "QUANT_VALIDATION_MISSING" });
    expect(overbought).toMatchObject({ allowed: false,
      severity: 'BLOCK', reason: "QUANT_VALIDATION_MISSING" });
  });

  it("allows a smaller event canary for a corroborated high-impact event at 72 confidence", async () => {
    const result = await service(null).policy.evaluate({
      ...input,
      decision: strongDecision({ confidence: 72 }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 70,
      marketEventImpact: "HIGH",
      marketEventDirection: "POSITIVE",
    });

    expect(result).toMatchObject({
      allowed: true,
      advisory: true,
      severity: 'REDUCE_SIZE',
      reason: "QUANT_VALIDATION_MISSING",
      sizeFactor: 0.15,
    });
  });

  it("does not use an event canary when news direction opposes the trade", async () => {
    const result = await service(null).policy.evaluate({
      ...input,
      decision: strongDecision({ confidence: 72 }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 70,
      marketEventImpact: "HIGH",
      marketEventDirection: "NEGATIVE",
    });

    expect(result).toMatchObject({ allowed: false,
      severity: 'BLOCK', reason: "QUANT_VALIDATION_MISSING" });
  });

  it("treats a slower bearish regime as advisory during a strong fresh core transition", async () => {
    const result = await service(null, {
      regime: "BEAR",
      confidence: 82,
      detectedAt: new Date("2026-08-12T00:55:00Z"),
    }).policy.evaluate({
      ...input,
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 75,
    });

    expect(result).toMatchObject({
      allowed: true,
      advisory: true,
      severity: 'REDUCE_SIZE',
      reason: "QUANT_VALIDATION_MISSING",
      sizeFactor: 0.25,
    });
  });

  it("keeps a fresh bearish quant regime as a hard block without strong core evidence", async () => {
    const result = await service(null, {
      regime: "BEAR",
      confidence: 82,
      detectedAt: new Date("2026-08-12T00:55:00Z"),
    }).policy.evaluate({
      ...input,
      decision: strongDecision({ coreDataQuality: "PARTIAL" }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 75,
    });

    expect(result).toMatchObject({ allowed: false,
      severity: 'BLOCK', reason: "QUANT_REGIME_CONFLICT" });
  });

  it("treats expired evidence as advisory while preserving fresh negative evidence as a hard block", async () => {
    const canaryInput = {
      ...input,
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 75,
      now: new Date("2026-08-14T00:00:01Z"),
    };
    const positive = await service(valid()).policy.evaluate(canaryInput);
    const expiredNegative = await service(valid({ walkForwardStable: false })).policy.evaluate(canaryInput);
    const freshNegative = await service(valid({ walkForwardStable: false })).policy.evaluate({
      ...canaryInput,
      now: new Date("2026-08-12T01:00:00Z"),
    });

    expect(positive).toMatchObject({
      allowed: true,
      advisory: true,
      severity: 'REDUCE_SIZE',
      reason: "QUANT_VALIDATION_STALE",
      sizeFactor: 0.25,
    });
    expect(expiredNegative).toMatchObject({
      allowed: true,
      advisory: true,
      severity: 'REDUCE_SIZE',
      reason: "QUANT_VALIDATION_STALE",
      sizeFactor: 0.25,
    });
    expect(freshNegative).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      reason: "QUANT_WALK_FORWARD_UNSTABLE",
    });
  });

  it("blocks the observed ETH-quality evidence when walk-forward is unstable", async () => {
    const result = await service(valid({ probabilityOfProfit: 30.94, probabilityOfRuin: 100, walkForwardStable: false })).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false,
      severity: 'BLOCK', reason: "QUANT_WALK_FORWARD_UNSTABLE" });
  });

  it("does not let a DEMO dislocation canary bypass unstable exact evidence", async () => {
    const result = await service(valid({
      probabilityOfProfit: 43,
      probabilityOfRuin: 9.77,
      outOfSampleSharpe: -0.8,
      walkForwardStable: false,
    })).policy.evaluate({
      ...input,
      mode: "DEMO",
      decision: strongDecision({
        decision: "SHORT",
        confidence: 75,
        opportunityScore: 79,
        expectedReward: 2.867,
        expectedLoss: 0.696,
        executionCost: 0.063,
      }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 37.95,
      marketDislocation: {
        direction: "BEARISH",
        confirmationCount: 2,
        indicatorCloseTime: "2026-08-12T00:59:59.999Z",
        reasons: [
          "NEGATIVE_MACD_HISTOGRAM",
          "ROLLING_LOW_BREAKDOWN",
          "BEARISH_ATR_IMPULSE",
        ],
      },
    } as never);

    expect(result).toMatchObject({
      allowed: false,
      evaluated: false,
      severity: 'BLOCK',
      reason: "QUANT_WALK_FORWARD_UNSTABLE",
    });
  });

  it("does not let a DEMO dislocation canary bypass low exact profit probability", async () => {
    const result = await service(valid({ probabilityOfProfit: 43 })).policy.evaluate({
      ...input,
      mode: "DEMO",
      decision: strongDecision({
        decision: "SHORT",
        confidence: 75,
        opportunityScore: 79,
        expectedReward: 2.867,
        expectedLoss: 0.696,
        executionCost: 0.063,
      }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 37.95,
      marketDislocation: {
        direction: "BEARISH",
        confirmationCount: 2,
        indicatorCloseTime: "2026-08-12T00:59:59.999Z",
        reasons: ["ROLLING_LOW_BREAKDOWN", "BEARISH_ATR_IMPULSE"],
      },
    } as never);

    expect(result).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      reason: "QUANT_PROBABILITY_TOO_LOW",
    });
  });

  it("keeps the dislocation bypass disabled in LIVE mode", async () => {
    const result = await service(valid({ walkForwardStable: false })).policy.evaluate({
      ...input,
      mode: "LIVE",
      decision: strongDecision({
        decision: "SHORT",
        confidence: 75,
        opportunityScore: 79,
        expectedReward: 2.867,
        expectedLoss: 0.696,
        executionCost: 0.063,
      }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 37.95,
      marketDislocation: {
        direction: "BEARISH",
        confirmationCount: 2,
        indicatorCloseTime: "2026-08-12T00:59:59.999Z",
        reasons: ["ROLLING_LOW_BREAKDOWN", "BEARISH_ATR_IMPULSE"],
      },
    } as never);

    expect(result).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      reason: "QUANT_WALK_FORWARD_UNSTABLE",
    });
  });

  it("does not use a dislocation canary when the event direction opposes the trade", async () => {
    const result = await service(valid({ walkForwardStable: false })).policy.evaluate({
      ...input,
      mode: "DEMO",
      decision: strongDecision({
        decision: "SHORT",
        confidence: 75,
        opportunityScore: 79,
        expectedReward: 2.867,
        expectedLoss: 0.696,
        executionCost: 0.063,
      }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 37.95,
      marketDislocation: {
        direction: "BULLISH",
        confirmationCount: 2,
        indicatorCloseTime: "2026-08-12T00:59:59.999Z",
        reasons: ["ROLLING_HIGH_BREAKOUT", "BULLISH_ATR_IMPULSE"],
      },
    } as never);

    expect(result).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      reason: "QUANT_WALK_FORWARD_UNSTABLE",
    });
  });

  it("does not classify an ATR impulse without a structural breakout as a dislocation canary", async () => {
    const result = await service(valid({ walkForwardStable: false })).policy.evaluate({
      ...input,
      mode: "DEMO",
      decision: strongDecision({
        decision: "SHORT",
        confidence: 75,
        opportunityScore: 79,
        expectedReward: 2.867,
        expectedLoss: 0.696,
        executionCost: 0.063,
      }) as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 37.95,
      marketDislocation: {
        direction: "BEARISH",
        confirmationCount: 2,
        indicatorCloseTime: "2026-08-12T00:59:59.999Z",
        reasons: ["BEARISH_EMA_ALIGNMENT", "BEARISH_ATR_IMPULSE"],
      },
    } as never);

    expect(result).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      reason: "QUANT_WALK_FORWARD_UNSTABLE",
    });
  });

  it("allows validated out-of-sample edge that agrees with fresh quant regime", async () => {
    const result = await service(valid(), { regime: "BULL", confidence: 82, detectedAt: new Date("2026-08-12T00:55:00Z") }).policy.evaluate(input);
    expect(result.allowed).toBe(true);
    expect(result.validation?.outOfSampleSharpe).toBe(1.2);
  });

  it("blocks a directional trade against a fresh high-confidence quant regime", async () => {
    const result = await service(valid(), { regime: "BEAR", confidence: 82, detectedAt: new Date("2026-08-12T00:55:00Z") }).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false,
      severity: 'BLOCK', reason: "QUANT_REGIME_CONFLICT" });
  });

  it("requires a meaningful out-of-sample Sharpe margin instead of merely above zero", async () => {
    const result = await service(valid({ outOfSampleSharpe: 0.2 })).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false,
      severity: 'BLOCK', reason: "QUANT_OUT_OF_SAMPLE_EDGE_MISSING" });
  });

  it("fails closed when Monte Carlo evidence is derived from too few trades", async () => {
    const result = await service(valid({
      metricsJson: {
        sampleEvidence: { totalTrades: 5, outOfSampleTrades: 1, walkForwardWindows: 1 },
        outOfSample: { outOfSampleTrades: 1 },
        walkForward: { windows: [{}] },
        executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    })).policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false,
      severity: 'BLOCK', evaluated: false, reason: "QUANT_SAMPLE_TOO_SMALL" });
  });

  it("fails closed when research assumptions do not match execution", async () => {
    const policy = serviceWithLimits(valid(), {
      maxLeverage: 50,
      riskPerTrade: 0.01,
      riskRewardRatio: 2,
    });
    const result = await policy.evaluate(input);
    expect(result).toMatchObject({ allowed: false,
      severity: 'BLOCK', evaluated: false, reason: "QUANT_ASSUMPTION_MISMATCH" });
  });

  it("does not grant statistically ineligible negative evidence hard-gate authority", async () => {
    const result = await service(valid({
      probabilityOfProfit: 3,
      probabilityOfRuin: 100,
      outOfSampleSharpe: -2,
      walkForwardStable: false,
      metricsJson: {
        sampleEvidence: { totalTrades: 5, outOfSampleTrades: 1, walkForwardWindows: 1 },
        outOfSample: { outOfSampleTrades: 1 },
        walkForward: { windows: [{}] },
        executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    })).policy.evaluate(input);

    expect(result).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      evaluated: false,
      reason: "QUANT_SAMPLE_TOO_SMALL",
    });
  });

  it("reports WAIT as not evaluated instead of a misleading Quant pass", async () => {
    const { policy, findFirst } = service(valid());
    const result = await policy.evaluate({
      ...input,
      decision: { decision: "WAIT", regime: { type: "RANGING" } } as never,
    });

    expect(result).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      evaluated: false,
      reason: "QUANT_NOT_APPLICABLE",
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("requires validation for the exact selected strategy", async () => {
    const { policy, findFirst } = service(valid());
    await policy.evaluate({ ...input, strategyKey: "trend" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ strategyKey: "trend" }) as unknown,
    }));
  });

  it("fails closed in LIVE mode without granting advisory canary", async () => {
    const { policy } = service(null);
    const result = await policy.evaluate({
      ...input,
      mode: "LIVE",
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 90,
    });
    expect(result).toMatchObject({
      allowed: false,
      severity: 'BLOCK',
      evaluated: false,
      reason: "QUANT_VALIDATION_MISSING",
    });
  });

  it("grants advisory canary in DEMO mode when strong realtime setup exists without validation", async () => {
    const { policy } = service(null);
    const result = await policy.evaluate({
      ...input,
      mode: "DEMO",
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 90,
    });
    expect(result).toMatchObject({
      allowed: true,
      evaluated: false,
      advisory: true,
      severity: 'REDUCE_SIZE',
      reason: "QUANT_VALIDATION_MISSING",
      sizeFactor: 0.25,
    });
  });

  it("rejects 1h validation for 15m decision as assumption mismatch with PARTIAL_MATCH status", async () => {
    const { policy } = service(valid({ interval: '1h' }));
    const result = await policy.evaluate({ ...input, timeframe: '15m' });
    expect(result.evidenceStatus).toBe('PARTIAL_MATCH');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('QUANT_ASSUMPTION_MISMATCH');
  });

  it("blocks negative exact evidence and exposes EXACT_MATURE_NEGATIVE status", async () => {
    const { policy } = service(valid({ probabilityOfProfit: 40 }));
    const result = await policy.evaluate(input);
    expect(result.evidenceStatus).toBe('EXACT_MATURE_NEGATIVE');
    expect(result.allowed).toBe(false);
    expect(result.severity).toBe('BLOCK');
  });

  it("assigns riskTier and matched cohort based on exact evidence maturity and quality", async () => {
    const exactNegativeFixture = (overrides: Record<string, unknown> = {}) => ({
      ...input,
      setup: "TREND_PULLBACK",
      regime: "TRENDING",
      direction: "LONG",
      executionPolicy: "STANDARD",
      configurationVersion: "v1",
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 68.06,
      ...overrides,
    });

    const negativeValidation = valid({
      probabilityOfProfit: 30,
      probabilityOfRuin: 100,
      outOfSampleSharpe: -1.36,
      walkForwardStable: false,
      metricsJson: {
        sampleEvidence: { totalTrades: 80, outOfSampleTrades: 20 },
        cohort: {
          symbol: "ETH-USDT",
          setup: "TREND_PULLBACK",
          regime: "TRENDING",
          direction: "LONG",
          executionPolicy: "STANDARD",
          configurationVersion: 1,
        },
        executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    });

    const { policy: negPolicy } = service(negativeValidation);
    const negResult = await negPolicy.evaluate(exactNegativeFixture());
    expect(negResult.riskTier).toBe("BLOCKED");

    const immatureValidation = valid({
      metricsJson: {
        sampleEvidence: { totalTrades: 12, outOfSampleTrades: 4 },
        cohort: {
          symbol: "ETH-USDT",
          setup: "TREND_PULLBACK",
          regime: "TRENDING",
          direction: "LONG",
          executionPolicy: "STANDARD",
          configurationVersion: 1,
        },
        executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    });
    const { policy: immPolicy } = service(immatureValidation);
    const immResult = await immPolicy.evaluate(exactNegativeFixture({ mode: "DEMO" }));
    expect(immResult.riskTier).toBe("PROBE");

    const { policy: posPolicy } = service(valid({
      metricsJson: {
        sampleEvidence: { totalTrades: 50, outOfSampleTrades: 15 },
        cohort: {
          symbol: "ETH-USDT",
          setup: "TREND_PULLBACK",
          regime: "TRENDING",
          direction: "LONG",
          executionPolicy: "STANDARD",
          configurationVersion: 1,
        },
        executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    }));
    const posResult = await posPolicy.evaluate(exactNegativeFixture());
    expect(posResult.riskTier).toBe("NORMAL");
  });

  it("permits only a reduced DEMO probe for a new cohort after readiness passes", async () => {
    const newCohortFixture = (overrides: Record<string, unknown> = {}) => ({
      ...input,
      setup: "TREND_PULLBACK",
      regime: "TRENDING",
      direction: "LONG",
      executionPolicy: "STANDARD",
      configurationVersion: "v1",
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 68.06,
      ...overrides,
    });
    const evaluate = (fixture: Parameters<QuantExecutionPolicyService["evaluate"]>[0]) =>
      service(null).policy.evaluate(fixture);

    const result = await evaluate(newCohortFixture({ mode: "DEMO", executionReady: true }));
    expect(result).toMatchObject({ allowed: true, severity: "REDUCE_SIZE", executionPolicy: "PROBE" });
  });

  it("keeps reliable exact negative expectancy as a hard block", async () => {
    const exactNegativeFixture = (overrides: Record<string, unknown> = {}) => ({
      ...input,
      setup: "TREND_PULLBACK",
      regime: "TRENDING",
      direction: "LONG",
      executionPolicy: "STANDARD",
      configurationVersion: "v1",
      decision: strongDecision() as never,
      multiTimeframeConfirmation: 100,
      primaryRsi: 68.06,
      ...overrides,
    });
    const negativeValidation = valid({
      probabilityOfProfit: 30,
      probabilityOfRuin: 100,
      outOfSampleSharpe: -1.36,
      walkForwardStable: false,
      metricsJson: {
        sampleEvidence: { totalTrades: 80, outOfSampleTrades: 20 },
        cohort: {
          symbol: "ETH-USDT",
          setup: "TREND_PULLBACK",
          regime: "TRENDING",
          direction: "LONG",
          executionPolicy: "STANDARD",
          configurationVersion: 1,
        },
        executionAssumptions: { leverage: 1, riskPerTrade: 0.02, riskRewardRatio: 1.5 },
      },
    });
    const evaluate = (fixture: Parameters<QuantExecutionPolicyService["evaluate"]>[0]) =>
      service(negativeValidation).policy.evaluate(fixture);

    const result = await evaluate(exactNegativeFixture());
    expect(result).toMatchObject({ allowed: false, severity: "BLOCK" });
  });
});


it('cannot use a dislocation to bypass a reliable negative exact cohort', async () => {
  const result = await service(valid({ probabilityOfProfit: 30 })).policy.evaluate({
    userId: 'user-1', symbol: 'ETH-USDT', provider: 'OKX_FUTURES', timeframe: '15m', mode: 'DEMO', now: new Date('2026-08-12T01:00:00Z'),
    decision: strongDecision({ expectedReward: 3, expectedLoss: 1, executionCost: 0.1 }) as never, multiTimeframeConfirmation: 100,
    marketDislocation: { direction: 'BULLISH', confirmationCount: 3, indicatorCloseTime: '2026-08-12T01:00:00Z', reasons: ['ROLLING_HIGH_BREAKOUT', 'BULLISH_ATR_IMPULSE'] },
  });
  expect(result).toMatchObject({ allowed: false, severity: 'BLOCK' });
});
