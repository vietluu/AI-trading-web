import { describe, expect, it } from "vitest";
import { evaluateRisk } from "../../src/modules/risk/domain/risk-engine";
import { RiskManagementService } from "../../src/modules/risk/application/risk-management.service";
import type { DecisionOutput } from "@platform/shared";
import type { PrismaService } from "../../src/database/prisma.service";
import type { RiskConfigService } from "../../src/modules/risk/application/risk-config.service";
import { Prisma } from "@prisma/client";
import type { RiskInput, RiskLimits, RiskPosition } from "../../src/modules/risk/domain/risk-engine.types";

const defaultLimits: RiskLimits = {
  riskPerTrade: 0.005, // 0.50%
  maxPositions: 3,
  maxLeverage: 10,
  maxDrawdown: 0.1,
  maxExposure: 0.5,
  cooldownMs: 0,
  minimumConfidence: 60,
  stopLossPct: 0.02,
  riskRewardRatio: 2,
  highVolatility: 5,
  abnormalVolatility: 10,
  highVolatilitySizeFactor: 0.5,
  estimatedRoundTripCostPct: 0.001,
  maxStopLossRoe: 0.5,
  rangeScalpRoeMultiplier: 1.5,
  minLiquidationBufferPct: 0.01,
};

const getBaseInput = (decision: 'LONG' | 'SHORT', currentPositions: RiskPosition[] = []): RiskInput => ({
  symbol: 'BTC-USDT',
  account: { balance: 10000, equity: 10000, peakEquity: 10000 },
  currentPositions,
  decision: {
    decision,
    confidence: 80,
    regime: { type: 'TRENDING_BULL' },
    expectedValue: 1,
    expectedLoss: 1,
    expectedReward: 2,
    riskScore: 20,
    opportunityScore: 80,
  } as unknown as DecisionOutput,
  marketData: {
    price: 100000,
    volatility: 0.01,
    tradePlanContext: {
      gateSeverity: 'APPROVE', 
      support: 98000,
      resistance: 104000,
      marketStructure: 'HH_HL',
      timeframeMs: 3600000,
      candleClose: 100000,
    },
  },
  now: new Date(),
});

describe("Staged Entry Risk Evaluation", () => {
  it("calculates probe order size at 25% if APPROVE gate severity", () => {
    const input = getBaseInput('LONG');
    const risk = evaluateRisk(input, defaultLimits);
    if (!risk.approved) console.log(risk);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry).toBeDefined();
    expect(risk.tradePlan?.stagedEntry?.probeSizePct).toBe(0.25);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('PROBE');
    // Position size check: 0.25 scaling
    expect(risk.positionSize).toBeGreaterThan(0.005);
    expect(risk.positionSize).toBeLessThan(0.007); // ~0.00625
  });

  it("calculates probe order size at 20% if REDUCE_SIZE gate severity", () => {
    const input = getBaseInput('LONG');
    input.marketData.tradePlanContext!.gateSeverity = 'REDUCE_SIZE';
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.probeSizePct).toBe(0.20);
    expect(risk.positionSize).toBeLessThan(0.0052); // ~0.005
  });

  it("rejects unplanned averaging down (missing stagedEntry)", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.01, markPrice: 100000, entryPrice: 100000 }]);
    // Remove gateSeverity so it's not a staged entry
    delete input.marketData.tradePlanContext!.gateSeverity;
    
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(false);
    expect(risk.reason).toBe('PYRAMIDING_NOT_ALLOWED');
  });

  it("allows CONFIRMED add and scales properly when existing position exists", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.005, markPrice: 100000, entryPrice: 100000 }]);
    // Default base input has APPROVE which gives stagedEntry
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('CONFIRMED');
    
    // confirmation size is 75% for APPROVE (probe 25%)
    expect(risk.tradePlan?.stagedEntry?.confirmationSizePct).toBe(0.75);
    expect(risk.positionSize).toBeGreaterThan(0.015); // ~0.01875
  });

  it("caps combined risk to 0.50% implicitly", () => {
    const input = getBaseInput('LONG', [{ symbol: 'BTC-USDT', side: 'LONG', size: 0.005, markPrice: 100000, entryPrice: 100000 }]);
    const risk = evaluateRisk(input, defaultLimits);
    expect(risk.tradePlan?.stagedEntry?.combinedRiskLimitPct).toBe(0.005);
  });
  it.each([undefined, 0, -1, NaN, Infinity])("rejects a staged add with unknown or invalid entry price %s", (entryPrice) => {
    const risk = evaluateRisk(getBaseInput('LONG', [{
      symbol: 'BTC-USDT', side: 'LONG', size: 0.005, markPrice: 100000, entryPrice,
    }]), defaultLimits);
    expect(risk).toMatchObject({ approved: false, reason: 'POSITION_ENTRY_PRICE_REQUIRED' });
  });

  it("uses actual entry price instead of mark price for combined probe risk", () => {
    const risk = evaluateRisk(getBaseInput('LONG', [{
      symbol: 'BTC-USDT', side: 'LONG', size: 0.01, markPrice: 100000, entryPrice: 99000,
    }]), defaultLimits);
    // Existing risk: 0.01 * (99000 - 98000) = $10; add risk is below $36.
    // Using the $100000 mark instead would inflate total risk above the $50 cap.
    expect(risk.approved).toBe(true);
    expect(risk.tradePlan?.stagedEntry?.stage).toBe('CONFIRMED');
  });

  it("rejects an underwater add after converting exchange positions for Risk", async () => {
    const input = getBaseInput('LONG');
    const service = new RiskManagementService({} as PrismaService, {
      getUserLimits: () => Promise.resolve(defaultLimits),
    } as unknown as RiskConfigService);
    const result = await service.assess({
      riskAssessment: {
        findUnique: () => Promise.resolve(null),
        upsert: ({ create }: Prisma.RiskAssessmentUpsertArgs) => Promise.resolve(create),
      },
    } as unknown as Prisma.TransactionClient, {
      userId: 'user-1', pipelineRunId: 'run-1', symbol: input.symbol,
      decision: input.decision,
      account: { balance: new Prisma.Decimal(10000), equity: new Prisma.Decimal(10000), peakEquity: new Prisma.Decimal(10000) },
      positions: [{ symbol: 'BTC-USDT', side: 'LONG', size: new Prisma.Decimal(0.005), markPrice: new Prisma.Decimal(100000), entryPrice: new Prisma.Decimal(101000) }],
      price: input.marketData.price, volatility: input.marketData.volatility,
      tradePlanContext: input.marketData.tradePlanContext,
    });
    expect(result).toMatchObject({ approved: false, reason: 'UNPLANNED_AVERAGE_DOWN' });
  });

});
