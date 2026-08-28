import { describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import {
  SelfLearningService,
} from "../../src/modules/reflection/application/self-learning.service";
import { computeConfigurationHash, LIVE_ELIGIBILITY_POLICY_VERSION } from "../../src/modules/reflection/domain/live-eligibility";

describe("live eligibility review application flow", () => {
  const userId = "test-user-uuid";
  const validWeights = { technical: 0.4, market: 0.3, news: 0.3 };
  const validThreshold = 65.0;
  const version = 2;
  const configurationHash = computeConfigurationHash({
    version,
    weights: validWeights,
    confidenceThreshold: validThreshold,
    policyVersion: LIVE_ELIGIBILITY_POLICY_VERSION,
    advisoryPolicyHash: "advisory-disabled",
  });

  it("approves eligible candidate and applies to live configuration", async () => {
    let storedConfig: {
      id: string;
      userId: string;
      isEnabled: boolean;
      liveVersion: number;
      weightsJson: Record<string, number>;
      confidenceThreshold: number;
      eligibleVersion: number | null;
      eligibleWeightsJson: Record<string, number> | null;
      eligibleThreshold: number | null;
      eligibleMetricsJson: Record<string, unknown> | null;
      eligibleConfigurationHash: string | null;
      eligibleAt: Date | null;
      approvedVersion: number | null;
      approvedConfigurationHash: string | null;
      approvedAt: Date | null;
      canaryEnabled: boolean;
      shadowEnabled: boolean;
    } = {
      id: "config-1",
      userId,
      isEnabled: true,
      liveVersion: 1,
      weightsJson: { technical: 0.3, market: 0.4, news: 0.3 },
      confidenceThreshold: 60.0,
      eligibleVersion: version,
      eligibleWeightsJson: validWeights,
      eligibleThreshold: validThreshold,
      eligibleMetricsJson: {
        outOfSampleAccuracy: 0.58,
        expectancy: 0.02,
        profitFactor: 1.45,
        sharpeRatio: 0.82,
        maxDrawdownPct: 6.5,
        shadowTrades: 120,
        canaryTrades: 105,
      },
      eligibleConfigurationHash: configurationHash,
      eligibleAt: new Date(),
      approvedVersion: null,
      approvedConfigurationHash: null,
      approvedAt: null,
      canaryEnabled: false,
      shadowEnabled: false,
    };

    const prisma = {
      $transaction: vi.fn().mockImplementation((callback: (txClient: unknown) => Promise<unknown>) => {
        return callback(tx);
      }),
      selfLearningConfiguration: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(storedConfig)),
      },
      paperSignal: { count: vi.fn().mockResolvedValue(0) },
      performanceRecord: { count: vi.fn().mockResolvedValue(0) },
      selfLearningExperiment: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ id: "exp-1", recommendationId: "rec-1" }),
      },
    };

    const tx = {
      selfLearningConfiguration: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(storedConfig)),
        updateMany: vi.fn().mockImplementation(({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (where.userId === userId && where.eligibleVersion === version && where.eligibleConfigurationHash === configurationHash) {
            storedConfig = { ...storedConfig, ...data, eligibleVersion: null, eligibleConfigurationHash: null, liveVersion: version, approvedVersion: version };
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }),
      },
      selfLearningExperiment: {
        findUnique: vi.fn().mockResolvedValue({ id: "exp-1", recommendationId: "rec-1" }),
      },
      selfLearningExperimentEvent: {
        create: vi.fn().mockResolvedValue({ id: "evt-1" }),
      },
      quantRecommendation: {
        update: vi.fn().mockResolvedValue({ id: "rec-1", status: "DEPLOYED" }),
      },
    };

    const configService = { get: vi.fn().mockReturnValue(10) };
    const service = new SelfLearningService(prisma as never, configService as never);

    await service.reviewLiveEligibility(userId, {
      action: "APPROVE",
      version,
      configurationHash,
      confirmed: true,
      reason: "Metrics passed all gates",
    });

    expect(tx.selfLearningConfiguration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId,
          eligibleVersion: version,
          eligibleConfigurationHash: configurationHash,
        },
        data: expect.objectContaining({
          liveVersion: version,
          approvedVersion: version,
          approvedConfigurationHash: configurationHash,
          eligibleVersion: null,
          eligibleConfigurationHash: null,
        }) as unknown,
      }),
    );
    expect(tx.quantRecommendation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: { status: "DEPLOYED" },
      }),
    );
  });

  it("rejects candidate with stale version or mismatched configuration hash", async () => {
    const storedConfig = {
      id: "config-1",
      userId,
      eligibleVersion: version,
      eligibleConfigurationHash: configurationHash,
      eligibleWeightsJson: validWeights,
      eligibleThreshold: validThreshold,
    };

    const tx = {
      selfLearningConfiguration: {
        findUnique: vi.fn().mockResolvedValue(storedConfig),
      },
    };

    const prisma = {
      $transaction: vi.fn().mockImplementation((callback: (txClient: unknown) => Promise<unknown>) => callback(tx)),
      selfLearningConfiguration: {
        findUnique: vi.fn().mockResolvedValue(storedConfig),
      },
    };

    const service = new SelfLearningService(prisma as never, {} as never);

    await expect(
      service.reviewLiveEligibility(userId, {
        action: "APPROVE",
        version: version + 1, // Wrong version
        configurationHash,
        confirmed: true,
      }),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.reviewLiveEligibility(userId, {
        action: "APPROVE",
        version,
        configurationHash: "f".repeat(64), // Wrong hash
        confirmed: true,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
