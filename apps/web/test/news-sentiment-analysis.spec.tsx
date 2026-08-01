import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewsAnalysisPage from "@/app/ai/news-analysis/page";
import SentimentAnalysisPage from "@/app/ai/sentiment-analysis/page";
import { apiRequest } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));

function renderPage(page: React.ReactNode): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      {page}
    </QueryClientProvider>,
  );
}

describe("News and sentiment analysis pages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs and displays structured news analysis", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      id: "news-run",
      status: "COMPLETED",
      output: {
        summary: "ETF expansion is the principal recent narrative.",
        impact: { level: "HIGH", direction: "POSITIVE" },
        keyEvents: [
          {
            title: "ETF options expansion",
            impact: "POSITIVE",
            importance: 85,
          },
        ],
        themes: ["ETF", "institutional"],
        riskSignals: [],
        dataQuality: "GOOD",
        usedTools: ["news.articles.list", "news.high_importance.list"],
        generatedAt: new Date().toISOString(),
      },
    });
    renderPage(<NewsAnalysisPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run news analysis" }));
    await waitFor(() =>
      expect(
        screen.getByText("ETF expansion is the principal recent narrative."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Key events" })).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith(
      "/agents/NEWS_ANALYST/runs",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("runs and displays crowd behavior", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      id: "sentiment-run",
      status: "COMPLETED",
      output: {
        summary: "Optimism is elevated without evidence of panic.",
        sentiment: { overall: "BULLISH", intensity: "MEDIUM" },
        crowdBehavior: { fomo: false, panic: false, euphoria: false },
        sources: { social: "Reddit", marketSentimentIndex: "68 - Greed" },
        anomalies: [],
        dataQuality: "GOOD",
        usedTools: ["sentiment.market.get", "social.posts.list"],
        generatedAt: new Date().toISOString(),
      },
    });
    renderPage(<SentimentAnalysisPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Run sentiment analysis" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Optimism is elevated without evidence of panic."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Crowd behavior" })).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith(
      "/agents/SENTIMENT_ANALYST/runs",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
