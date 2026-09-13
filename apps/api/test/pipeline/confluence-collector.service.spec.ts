import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConfluenceCollectorService } from "../../src/modules/pipeline/infrastructure/confluence-collector.service";
import type { RedisService } from "../../src/redis/redis.service";
import type { ConfluenceSignal } from "../../src/modules/pipeline/domain/confluence-engine.types";

describe("ConfluenceCollectorService", () => {
  let redis: { eval: ReturnType<typeof vi.fn> };
  let service: ConfluenceCollectorService;

  beforeEach(() => {
    redis = {
      eval: vi.fn(),
    };
    service = new ConfluenceCollectorService(redis as unknown as RedisService);
  });

  it("creates a batch in Redis with metadata and TTL", async () => {
    redis.eval.mockResolvedValue(1);

    await service.createBatch("batch-1", "user-123", 3, 60);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('hset'"),
      1,
      "confluence:batch:batch-1",
      "batch-1",
      "user-123",
      3,
      expect.any(Number),
      60,
    );
  });

  it("submits signal and returns ready=false when more signals are expected", async () => {
    // Lua returns [ready, reported, expected]
    redis.eval.mockResolvedValue([0, 1, 3]);

    const signal: ConfluenceSignal = {
      pipelineRunId: "run-1",
      symbol: "BTC-USDT",
      decision: "SHORT",
      confidence: 85,
      opportunityScore: 80,
      expectedValue: 0.3,
      riskScore: 2,
      strategyKey: "trend",
      compositeScore: 75,
      regime: "TRENDING",
      referencePrice: 65000,
      executionContext: {
        executionDecision: {},
        strategyKey: "trend",
        provider: "BINANCE",
      },
    };

    const res = await service.addSignal("batch-1", signal);
    expect(res).toEqual({ ready: false, reported: 1, expected: 3 });
  });

  it("submits signal and returns ready=true when all expected signals have reported", async () => {
    redis.eval.mockResolvedValue([1, 3, 3]);

    const signal: ConfluenceSignal = {
      pipelineRunId: "run-3",
      symbol: "SOL-USDT",
      decision: "SHORT",
      confidence: 78,
      opportunityScore: 70,
      expectedValue: 0.2,
      riskScore: 3,
      strategyKey: "trend",
      compositeScore: 68,
      regime: "TRENDING",
      referencePrice: 150,
      executionContext: {
        executionDecision: {},
        strategyKey: "trend",
        provider: "BINANCE",
      },
    };

    const res = await service.addSignal("batch-1", signal);
    expect(res).toEqual({ ready: true, reported: 3, expected: 3 });
  });

  it("reports non-actionable result and returns ready=true on final report", async () => {
    redis.eval.mockResolvedValue([1, 3, 3]);

    const res = await service.reportNonActionable("batch-1");
    expect(res).toEqual({ ready: true, reported: 3, expected: 3 });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('hincrby'"),
      1,
      "confluence:batch:batch-1",
      120,
    );
  });

  it("drains batch and parses signals and metadata", async () => {
    const rawMeta = [
      "batchId", "batch-1",
      "userId", "user-123",
      "expectedCount", "3",
      "reportedCount", "3",
      "createdAt", "1700000000000",
    ];
    const signal1: ConfluenceSignal = {
      pipelineRunId: "run-btc",
      symbol: "BTC-USDT",
      decision: "SHORT",
      confidence: 85,
      opportunityScore: 80,
      expectedValue: 0.3,
      riskScore: 2,
      strategyKey: "trend",
      compositeScore: 78,
      regime: "TRENDING",
      referencePrice: 65000,
      executionContext: {
        executionDecision: { decision: "SHORT" },
        strategyKey: "trend",
        provider: "BINANCE",
      },
    };
    const rawSignals = [JSON.stringify(signal1)];

    redis.eval.mockResolvedValue([rawMeta, rawSignals]);

    const drained = await service.drainBatch("batch-1");
    expect(drained).not.toBeNull();
    expect(drained?.meta).toEqual({
      batchId: "batch-1",
      userId: "user-123",
      expectedCount: 3,
      reportedCount: 3,
      createdAt: 1700000000000,
    });
    expect(drained?.signals).toHaveLength(1);
    expect(drained?.signals[0]?.symbol).toBe("BTC-USDT");
  });

  it("returns null when draining an expired or non-existent batch", async () => {
    redis.eval.mockResolvedValue(null);

    const drained = await service.drainBatch("batch-expired");
    expect(drained).toBeNull();
  });
});

import { buildMarketContext } from "../../src/modules/pipeline/domain/market-context";

describe("Market Anchors and Opportunity Deduplication", () => {
  let collector: ConfluenceCollectorService;

  beforeEach(() => {
    collector = new ConfluenceCollectorService({ eval: vi.fn() } as unknown as RedisService);
  });

  const anchorCandles = [
    { symbol: "BTC-USDT", open: 60000, high: 60500, low: 59800, close: 60400, volume: 100, timestamp: new Date(), closed: true },
    { symbol: "ETH-USDT", open: 2500, high: 2550, low: 2480, close: 2540, volume: 500, timestamp: new Date(), closed: true },
  ];

  const candidate = (overrides: Record<string, unknown> = {}) => ({
    pipelineRunId: "run-test",
    symbol: "ZRO-USDT",
    decision: "LONG" as const,
    confidence: 80,
    opportunityScore: 75,
    expectedValue: 0.5,
    riskScore: 3,
    strategyKey: "trend",
    compositeScore: 75,
    regime: "TRENDING",
    referencePrice: 1.05,
    executionContext: {
      executionDecision: { decision: "LONG" },
      strategyKey: "trend",
      provider: "BINANCE_FUTURES",
    },
    setup: "RANGE_REVERSION",
    triggerId: "range-low-1",
    ...overrides,
  });

  it('adds BTC and ETH context to an altcoin candidate', () => {
    expect(buildMarketContext(anchorCandles)).toMatchObject({
      anchors: { BTC: { available: true }, ETH: { available: true } },
    });
  });

  it('updates one opportunity for repeated observations of the same trigger', async () => {
    await collector.add(candidate({ symbol: 'ZRO-USDT', setup: 'RANGE_REVERSION', triggerId: 'range-low-1' }));
    await collector.add(candidate({ symbol: 'ZRO-USDT', setup: 'RANGE_REVERSION', triggerId: 'range-low-1' }));
    expect(await collector.pending()).toHaveLength(1);
  });
});
