import { describe, expect, it } from "vitest";
import {
  LiveEligibilityCandidateSchema,
  LiveEligibilityReviewInputSchema,
  SelfLearningLifecycleDtoSchema,
} from "@platform/shared";

describe("reflection and self-learning lifecycle schemas", () => {
  const validCandidate = {
    version: 2,
    weights: { technical: 0.4, market: 0.3, news: 0.3 },
    threshold: 65,
    metrics: {
      outOfSampleAccuracy: 0.58,
      expectancy: 0.02,
      profitFactor: 1.45,
      sharpeRatio: 0.82,
      maxDrawdownPct: 6.5,
      shadowTrades: 120,
      canaryTrades: 105,
    },
    configurationHash: "a".repeat(64),
    eligibleAt: "2026-08-28T12:00:00.000Z",
  };

  it("parses valid LIVE_ELIGIBLE lifecycle response", () => {
    const lifecycle = {
      stage: "LIVE_ELIGIBLE",
      isEnabled: true,
      liveVersion: 1,
      candidateVersion: 2,
      liveImpactPct: 100,
      candidateImpactPct: 0,
      shadowPerformance: null,
      evidence: { pendingShadowSignals: 0, evaluatedShadowSignals: 120, canaryRecords: 105, liveRecords: 300 },
      startedAt: "2026-08-28T10:00:00.000Z",
      lastPromotionAt: null,
      eligibleCandidate: validCandidate,
      approvedCandidate: null,
    };

    const parsed = SelfLearningLifecycleDtoSchema.parse(lifecycle);
    expect(parsed.stage).toBe("LIVE_ELIGIBLE");
    expect(parsed.eligibleCandidate?.configurationHash).toBe("a".repeat(64));
    expect(parsed.eligibleCandidate?.metrics.outOfSampleAccuracy).toBe(0.58);
  });

  it("rejects malformed configuration hash", () => {
    expect(() =>
      LiveEligibilityCandidateSchema.parse({
        ...validCandidate,
        configurationHash: "invalid-hash",
      }),
    ).toThrow();
  });

  it("rejects missing candidate metrics", () => {
    const candidateWithoutMetrics = {
      version: validCandidate.version,
      weights: validCandidate.weights,
      threshold: validCandidate.threshold,
      configurationHash: validCandidate.configurationHash,
      eligibleAt: validCandidate.eligibleAt,
    };
    expect(() =>
      LiveEligibilityCandidateSchema.parse(candidateWithoutMetrics),
    ).toThrow();
  });

  it("validates strict review inputs for APPROVE and REJECT", () => {
    const approveInput = {
      action: "APPROVE",
      version: 2,
      configurationHash: "b".repeat(64),
      confirmed: true,
    };
    expect(LiveEligibilityReviewInputSchema.parse(approveInput)).toEqual(approveInput);

    const rejectInput = {
      action: "REJECT",
      version: 2,
      configurationHash: "b".repeat(64),
      confirmed: true,
      reason: "Performance dropped in recent canary period",
    };
    expect(LiveEligibilityReviewInputSchema.parse(rejectInput)).toEqual(rejectInput);
  });

  it("rejects review input without confirmed: true or invalid version", () => {
    expect(() =>
      LiveEligibilityReviewInputSchema.parse({
        action: "APPROVE",
        version: 0,
        configurationHash: "b".repeat(64),
        confirmed: true,
      }),
    ).toThrow();

    expect(() =>
      LiveEligibilityReviewInputSchema.parse({
        action: "APPROVE",
        version: 2,
        configurationHash: "b".repeat(64),
        confirmed: false,
      }),
    ).toThrow();
  });
});
