import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/page";
import {
  useLiveTradingDashboard,
  usePerformanceDashboard,
  usePipelineDashboard,
  usePipelineRuns,
  usePortfolioDashboard,
  useRiskDashboard,
} from "@/hooks/ai/useAiFeature";
import {
  useHomeRecommendations,
  useHomeResearchRuns,
  useHomeSession,
  useHomeSymbolOpportunities,
} from "@/hooks/dashboard/useHomeDashboard";
import { ApiRequestError } from "@/lib/api-client";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/hooks/ai/useAiFeature", () => ({
  useLiveTradingDashboard: vi.fn(),
  usePerformanceDashboard: vi.fn(),
  usePipelineDashboard: vi.fn(),
  usePipelineRuns: vi.fn(),
  usePortfolioDashboard: vi.fn(),
  useRiskDashboard: vi.fn(),
}));

vi.mock("@/hooks/dashboard/useHomeDashboard", () => ({
  useHomeRecommendations: vi.fn(),
  useHomeResearchRuns: vi.fn(),
  useHomeSession: vi.fn(),
  useHomeSymbolOpportunities: vi.fn(),
}));

vi.mock("@/components/health-status", () => ({
  HealthStatus: () => <div>System healthy</div>,
}));

function queryResult() {
  return {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useHomeRecommendations).mockReturnValue(queryResult() as never);
  vi.mocked(useHomeResearchRuns).mockReturnValue(queryResult() as never);
  vi.mocked(useHomeSymbolOpportunities).mockReturnValue(queryResult() as never);
  vi.mocked(usePortfolioDashboard).mockReturnValue(queryResult() as never);
  vi.mocked(useRiskDashboard).mockReturnValue(queryResult() as never);
  vi.mocked(useLiveTradingDashboard).mockReturnValue(queryResult() as never);
  vi.mocked(usePipelineDashboard).mockReturnValue(queryResult() as never);
  vi.mocked(usePipelineRuns).mockReturnValue(queryResult() as never);
  vi.mocked(usePerformanceDashboard).mockReturnValue({
    metrics: queryResult(),
    records: queryResult(),
    alerts: queryResult(),
  } as never);
});

describe("authenticated home dashboard", () => {
  it("redirects a logged-out visitor before loading protected dashboard data", async () => {
    vi.mocked(useHomeSession).mockReturnValue({
      ...queryResult(),
      error: new ApiRequestError("Authentication required", 401),
      isError: true,
    } as never);

    renderPage();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/login?next=%2F"),
    );
    expect(useHomeSession).toHaveBeenCalledTimes(1);
    expect(usePortfolioDashboard).not.toHaveBeenCalled();
    expect(useLiveTradingDashboard).not.toHaveBeenCalled();
  });

  it("loads dashboard sources only after the session is valid", async () => {
    vi.mocked(useHomeSession).mockReturnValue({
      ...queryResult(),
      data: { expiresAt: "2026-08-10T00:00:00.000Z" },
    } as never);

    renderPage();

    await waitFor(() => expect(usePortfolioDashboard).toHaveBeenCalledTimes(1));
    expect(useRiskDashboard).toHaveBeenCalledTimes(1);
    expect(useLiveTradingDashboard).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});
