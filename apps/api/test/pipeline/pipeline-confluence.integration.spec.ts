import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConfluenceTimeoutProcessor } from "../../src/modules/pipeline/infrastructure/confluence-timeout.processor";
import { ConfluenceCollectorService } from "../../src/modules/pipeline/infrastructure/confluence-collector.service";
import type { PipelineRunnerService } from "../../src/modules/pipeline/application/pipeline-runner.service";
import type { RedisService } from "../../src/redis/redis.service";
import {
  evaluateConfluence,
} from "../../src/modules/pipeline/domain/confluence-engine";
import type { ConfluenceSignal } from "../../src/modules/pipeline/domain/confluence-engine.types";
import { buildMarketContext } from "../../src/modules/pipeline/domain/market-context";

describe("Pipeline Confluence Integration & Lifecycle", () => {
  describe("Confluence batch aggregation and resolution", () => {
    it("aggregates concurrent SHORT signals on BTC, BNB, and SOL, selecting BTC with a 1.30x size boost", () => {
      const btcSignal: ConfluenceSignal = {
        pipelineRunId: "run-btc-1",
        symbol: "BTC-USDT",
        decision: "SHORT",
        confidence: 85,
        opportunityScore: 80,
        expectedValue: 0.35,
        riskScore: 2.1,
        strategyKey: "trend",
        compositeScore: 78.5,
        regime: "TRENDING",
        referencePrice: 60500,
        executionContext: {
          executionDecision: { decision: "SHORT", confidence: 85 },
          strategyKey: "trend",
          provider: "BINANCE_FUTURES",
        },
      };

      const bnbSignal: ConfluenceSignal = {
        pipelineRunId: "run-bnb-1",
        symbol: "BNB-USDT",
        decision: "SHORT",
        confidence: 72,
        opportunityScore: 68,
        expectedValue: 0.2,
        riskScore: 3.0,
        strategyKey: "trend",
        compositeScore: 66.0,
        regime: "TRENDING",
        referencePrice: 540,
        executionContext: {
          executionDecision: { decision: "SHORT", confidence: 72 },
          strategyKey: "trend",
          provider: "BINANCE_FUTURES",
        },
      };

      const solSignal: ConfluenceSignal = {
        pipelineRunId: "run-sol-1",
        symbol: "SOL-USDT",
        decision: "SHORT",
        confidence: 76,
        opportunityScore: 75,
        expectedValue: 0.28,
        riskScore: 2.8,
        strategyKey: "trend",
        compositeScore: 71.2,
        regime: "TRENDING",
        referencePrice: 135,
        executionContext: {
          executionDecision: { decision: "SHORT", confidence: 76 },
          strategyKey: "trend",
          provider: "BINANCE_FUTURES",
        },
      };

      const signals = [bnbSignal, btcSignal, solSignal];
      const evaluation = evaluateConfluence(signals, 3, {
        boostPerSignal: 0.15,
        maxSizeFactor: 1.5,
        minSignalsForBoost: 2,
      });

      expect(evaluation).not.toBeNull();
      expect(evaluation?.direction).toBe("SHORT");
      // Highest composite score selected
      expect(evaluation?.selected.symbol).toBe("BTC-USDT");
      expect(evaluation?.selected.pipelineRunId).toBe("run-btc-1");
      // Concordance is 3/3 -> 1.0 + (3 - 1) * 0.15 = 1.30
      expect(evaluation?.concordanceCount).toBe(3);
      expect(evaluation?.concordanceRatio).toBe(1.0);
      expect(evaluation?.sizeFactor).toBe(1.3);

      // Remaining signals marked for shadow logging
      expect(evaluation?.rejected).toHaveLength(2);
      expect(evaluation?.rejected.map((s) => s.symbol)).toEqual([
        "SOL-USDT",
        "BNB-USDT",
      ]);
    });
  });

  describe("ConfluenceTimeoutProcessor", () => {
    let redis: { eval: ReturnType<typeof vi.fn> };
    let collector: ConfluenceCollectorService;
    let runner: { executeConfluenceBatch: ReturnType<typeof vi.fn> };
    let processor: ConfluenceTimeoutProcessor;

    beforeEach(() => {
      redis = { eval: vi.fn() };
      collector = new ConfluenceCollectorService(redis as unknown as RedisService);
      runner = { executeConfluenceBatch: vi.fn().mockResolvedValue(undefined) };
      processor = new ConfluenceTimeoutProcessor(
        collector,
        runner as unknown as PipelineRunnerService,
      );
    });

    it("triggers executeConfluenceBatch when timeout expires for an active batch", async () => {
      // Mock batchStatus returning active metadata
      const rawMeta = [
        "batchId", "batch-timeout-1",
        "userId", "user-456",
        "expectedCount", "3",
        "reportedCount", "2",
        "createdAt", "1700000000000",
      ];
      redis.eval.mockResolvedValue(rawMeta);

      await processor.process({
        data: { batchId: "batch-timeout-1", userId: "user-456" },
      } as never);

      expect(runner.executeConfluenceBatch).toHaveBeenCalledWith(
        "batch-timeout-1",
        "user-456",
      );
    });

    it("does nothing when the batch was already completed/drained", async () => {
      // Mock batchStatus returning null (already drained)
      redis.eval.mockResolvedValue(null);

      await processor.process({
        data: { batchId: "batch-already-done", userId: "user-456" },
      } as never);

      expect(runner.executeConfluenceBatch).not.toHaveBeenCalled();
    });
  });

  describe("Market Anchors & Portfolio Opportunity Ranking", () => {
    it("deduplicates repeated observations and ranks portfolio opportunities by expected R, location, and anchor alignment", async () => {
      const collector = new ConfluenceCollectorService({ eval: vi.fn() } as unknown as RedisService);

      const anchorCandles = [
        { symbol: "BTC-USDT", open: 60000, high: 61000, low: 59900, close: 60800, volume: 1000, timestamp: new Date(), closed: true },
        { symbol: "ETH-USDT", open: 2500, high: 2550, low: 2480, close: 2540, volume: 5000, timestamp: new Date(), closed: true },
      ];
      const market = buildMarketContext(anchorCandles);
      expect(market.marketRegime).toBe("RISK_ON");

      await collector.add({
        pipelineRunId: "run-zro-1",
        symbol: "ZRO-USDT",
        decision: "LONG",
        confidence: 80,
        opportunityScore: 70,
        expectedValue: 0.4,
        expectedNetR: 1.5,
        locationScore: 85,
        riskScore: 2,
        strategyKey: "trend",
        compositeScore: 75,
        regime: "TRENDING",
        referencePrice: 1.05,
        setup: "RANGE_REVERSION",
        triggerId: "trigger-1",
        sourceDataCutoff: new Date("2026-09-13T06:00:00Z"),
        executionContext: { executionDecision: { decision: "LONG" }, strategyKey: "trend", provider: "BINANCE_FUTURES" },
      });

      await collector.add({
        pipelineRunId: "run-zro-2",
        symbol: "ZRO-USDT",
        decision: "LONG",
        confidence: 82,
        opportunityScore: 72,
        expectedValue: 0.42,
        expectedNetR: 1.6,
        locationScore: 90,
        riskScore: 2,
        strategyKey: "trend",
        compositeScore: 78,
        regime: "TRENDING",
        referencePrice: 1.06,
        setup: "RANGE_REVERSION",
        triggerId: "trigger-1",
        sourceDataCutoff: new Date("2026-09-13T06:15:00Z"),
        executionContext: { executionDecision: { decision: "LONG" }, strategyKey: "trend", provider: "BINANCE_FUTURES" },
      });

      await collector.add({
        pipelineRunId: "run-sol-1",
        symbol: "SOL-USDT",
        decision: "LONG",
        confidence: 75,
        opportunityScore: 68,
        expectedValue: 0.25,
        expectedNetR: 0.8,
        locationScore: 60,
        riskScore: 3,
        strategyKey: "trend",
        compositeScore: 65,
        regime: "TRENDING",
        referencePrice: 135,
        setup: "TREND_PULLBACK",
        triggerId: "trigger-sol-1",
        sourceDataCutoff: new Date("2026-09-13T06:15:00Z"),
        executionContext: { executionDecision: { decision: "LONG" }, strategyKey: "trend", provider: "BINANCE_FUTURES" },
      });

      const pending = await collector.pending();
      expect(pending).toHaveLength(2);
      expect(pending[0]!.symbol).toBe("ZRO-USDT");
      expect(pending[0]!.expectedNetR).toBe(1.6);
      expect(pending[1]!.symbol).toBe("SOL-USDT");
    });
  });
});
