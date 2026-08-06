"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { CheckCircle2, PieChart } from "lucide-react";

interface AllocationItem {
  strategyKey: string;
  strategyName: string;
  currentCapitalAllocationPct: number;
  recommendedCapitalAllocationPct: number;
  correlationWithPortfolio: number;
  diversificationBenefitScore: number;
}

interface PortfolioData {
  overallSharpeRatio: number;
  overallProfitFactor: number;
  expectedValue: number;
  maxPortfolioDrawdownPct: number;
  allocations: AllocationItem[];
  recommendedActions: string[];
}

export default function PortfolioIntelligencePage() {
  const { t } = useTranslation();
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyingStrategy, setApplyingStrategy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadPortfolio() {
      try {
        const data = await apiRequest<PortfolioData>("/quant-intelligence/portfolio");
        setPortfolio(data);
        setErrorMessage(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load portfolio intelligence.";
        setPortfolio(null);
        setErrorMessage(message);
      } finally {
        setLoading(false);
      }
    }
    void loadPortfolio();
  }, []);

  async function applyRecommendation() {
    try {
      setApplying(true);
      for (const allocation of portfolio?.allocations ?? []) {
        await apiRequest(`/quant-intelligence/portfolio/strategies/${encodeURIComponent(allocation.strategyKey)}/apply`, {
          method: "POST",
          body: JSON.stringify({ targetWeight: allocation.recommendedCapitalAllocationPct / 100 }),
        });
      }
      const refreshed = await apiRequest<PortfolioData>("/quant-intelligence/portfolio");
      setPortfolio(refreshed);
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply recommendations.";
      setErrorMessage(message);
    } finally {
      setApplying(false);
    }
  }

  async function applyStrategyRecommendation(strategyKey: string, recommendedWeightPct: number) {
    try {
      setApplyingStrategy(strategyKey);
      await apiRequest(`/quant-intelligence/portfolio/strategies/${encodeURIComponent(strategyKey)}/apply`, {
        method: "POST",
        body: JSON.stringify({ targetWeight: recommendedWeightPct / 100 }),
      });
      const refreshed = await apiRequest<PortfolioData>("/quant-intelligence/portfolio");
      setPortfolio(refreshed);
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply strategy recommendation.";
      setErrorMessage(message);
    } finally {
      setApplyingStrategy(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PieChart className="h-6 w-6 text-primary" /> {t.quant.portfolioTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.quant.portfolioSubtitle}
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Portfolio Sharpe</span>
          <p className="text-xl font-bold text-emerald-500">{portfolio?.overallSharpeRatio}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">{t.quant.profitFactor}</span>
          <p className="text-xl font-bold">{portfolio?.overallProfitFactor}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Portfolio EV</span>
          <p className="text-xl font-bold text-emerald-500">+{portfolio?.expectedValue}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Max Portfolio DD</span>
          <p className="text-xl font-bold text-emerald-500">{portfolio?.maxPortfolioDrawdownPct}%</p>
        </div>
      </div>

      {/* Allocation Recommendations */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t.quant.recommendedAllocation}</h2>
          <button
            type="button"
            onClick={() => void applyRecommendation()}
            disabled={applying}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {applying ? "Applying…" : "Apply recommendations"}
          </button>
        </div>
        <div className="space-y-3">
          {portfolio?.allocations?.map((a, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border">
              <div>
                <p className="font-bold text-sm">{a.strategyName}</p>
                <span className="text-xs text-muted-foreground">Correlation: {a.correlationWithPortfolio} · Diversification Score: {a.diversificationBenefitScore}/100</span>
              </div>
              <div className="text-right space-y-2">
                <div>
                  <span className="text-xs text-muted-foreground">Current: {a.currentCapitalAllocationPct}%</span>
                  <p className="text-base font-bold text-emerald-500">Recommended: {a.recommendedCapitalAllocationPct}%</p>
                </div>
                <button
                  type="button"
                  onClick={() => void applyStrategyRecommendation(a.strategyKey, a.recommendedCapitalAllocationPct)}
                  disabled={applying || applyingStrategy === a.strategyKey}
                  className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50"
                >
                  {applyingStrategy === a.strategyKey ? "Applying…" : "Apply this strategy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
