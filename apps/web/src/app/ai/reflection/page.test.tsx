import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReflectionPage from "./page";

const mutateAsync = vi.fn();

vi.mock("@/hooks/ai/useAiFeature", () => ({
  useReflectionData: () => ({
    data: {
      summary: "Good progress",
      accuracy: 62,
      recordCount: 150,
      ready: true,
      strengths: ["Strong market analysis"],
      weaknesses: ["High volatility slippage"],
      patterns: ["Consistent in ranging markets"],
      suggestions: ["Tighten stop loss"],
      generatedAt: "2026-08-28T12:00:00.000Z",
      actualTrading: {
        totalTrades: 10,
        completeTrades: 8,
        winRate: 62.5,
        grossPnl: 100,
        fees: 5,
        netPnl: 95,
      },
    },
  }),
  useSelfLearningLifecycle: () => ({
    data: {
      stage: "LIVE_ELIGIBLE",
      isEnabled: true,
      liveVersion: 1,
      candidateVersion: 2,
      liveImpactPct: 100,
      candidateImpactPct: 0,
      shadowPerformance: null,
      evidence: {
        pendingShadowSignals: 0,
        evaluatedShadowSignals: 120,
        canaryRecords: 105,
        liveRecords: 300,
      },
      startedAt: "2026-08-28T10:00:00.000Z",
      lastPromotionAt: null,
      eligibleCandidate: {
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
        configurationHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        eligibleAt: "2026-08-28T12:00:00.000Z",
      },
    },
  }),
  useLiveEligibilityReview: () => ({
    mutateAsync,
    isPending: false,
  }),
  useReflectionActions: () => ({
    insights: { data: [] },
    proposals: { data: [] },
    runMutation: { mutate: vi.fn(), isPending: false },
    createProposalMutation: { mutate: vi.fn(), isPending: false },
    reviewProposalMutation: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock("@/lib/i18n/i18n-context", () => ({
  useTranslation: () => ({
    t: {
      ai: {
        reflectionTitle: "Reflection",
        reflectionSubtitle: "Analyze past performance",
        reflectionLink: "View performance",
        generateReflection: "Generate reflection",
        loadingReflection: "Loading...",
        moreRecordsRequired: "More records required",
        strengths: "Strengths",
        weaknesses: "Weaknesses",
        patterns: "Patterns",
        suggestions: "Suggestions",
        createProposal: "Create proposal",
        improvementProposals: "Improvement proposals",
        approvalNotice: "Proposals require approval",
        approve: "Approve",
        reject: "Reject",
        storedInsights: "Stored insights",
        noInsights: "No insights yet",
        noneYet: "None yet",
      },
    },
  }),
}));

describe("ReflectionPage LIVE eligibility candidate review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all seven eligibility gate metrics and candidate hash", () => {
    render(<ReflectionPage />);

    expect(screen.getByText("LIVE Promotion Candidate Review")).toBeInTheDocument();
    expect(screen.getByText("Out-of-Sample Accuracy")).toBeInTheDocument();
    expect(screen.getByText("58.0%")).toBeInTheDocument();
    expect(screen.getByText("Expectancy")).toBeInTheDocument();
    expect(screen.getByText("0.0200")).toBeInTheDocument();
    expect(screen.getByText("Profit Factor")).toBeInTheDocument();
    expect(screen.getByText("1.45")).toBeInTheDocument();
    expect(screen.getByText("Sharpe Ratio")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
    expect(screen.getByText("Maximum Drawdown")).toBeInTheDocument();
    expect(screen.getByText("6.5%")).toBeInTheDocument();
    expect(screen.getByText("Completed Shadow Trades")).toBeInTheDocument();
    expect(screen.getAllByText("120").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Completed Canary Trades")).toBeInTheDocument();
    expect(screen.getAllByText("105").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps approval button disabled until confirmation checkbox is clicked", async () => {
    render(<ReflectionPage />);

    const approveButton = screen.getByRole("button", {
      name: /Approve Version 2 for LIVE/i,
    });
    expect(approveButton).toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(approveButton).not.toBeDisabled();

    fireEvent.click(approveButton);
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "APPROVE",
      version: 2,
      configurationHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      confirmed: true,
    });
  });

  it("submits candidate rejection when reject button is clicked", async () => {
    render(<ReflectionPage />);

    const rejectButton = screen.getByRole("button", {
      name: /Reject Candidate/i,
    });
    fireEvent.click(rejectButton);

    expect(mutateAsync).toHaveBeenCalledWith({
      action: "REJECT",
      version: 2,
      configurationHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      confirmed: true,
      reason: undefined,
    });
  });
});
