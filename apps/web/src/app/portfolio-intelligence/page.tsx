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
  correlationWithPortfolio: number | null;
  diversificationBenefitScore: number | null;
  validationStatus: "VALIDATION_REQUIRED" | "CANARY" | "FULL";
  canApply: boolean;
  verifiedAttributedTrades: number;
  tradesRequiredForFullAllocation: number;
  validation: {
    coveragePct: number;
    passRatePct: number;
    passingPairs: number;
    requiredPairs: number;
  };
}

interface PortfolioData {
  overallSharpeRatio: number | null;
  overallProfitFactor: number | null;
  expectedValue: number | null;
  maxPortfolioDrawdownPct: number | null;
  allocations: AllocationItem[];
  recommendedActions: string[];
  actualTrading: {
    totalTrades: number;
    completeTrades: number;
    assignedTrades: number;
    unassignedTrades: number;
    netPnl: number;
    winRate: number;
    profitFactor: number | null;
  };
}

interface StrategyApplyResult {
  applied: boolean;
  strategyKey: string;
  mode: "VALIDATION_REQUIRED" | "CANARY" | "FULL";
  verifiedAttributedTrades: number;
  tradesRequiredForFullAllocation: number;
  validation?: {
    coveragePct: number;
    passRatePct: number;
    passingPairs: number;
    requiredPairs: number;
  };
}

function metric(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}

function signedMetric(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

export default function PortfolioIntelligencePage() {
  const { t } = useTranslation();
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyingStrategy, setApplyingStrategy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
      const blocked: StrategyApplyResult[] = [];
      const applicable = (portfolio?.allocations ?? []).filter(
        (allocation) => allocation.canApply &&
          Math.abs(allocation.recommendedCapitalAllocationPct - allocation.currentCapitalAllocationPct) >= 0.01,
      );
      for (const allocation of applicable) {
        const result = await apiRequest<StrategyApplyResult>(`/quant-intelligence/portfolio/strategies/${encodeURIComponent(allocation.strategyKey)}/apply`, {
          method: "POST",
          body: JSON.stringify({ targetWeight: allocation.recommendedCapitalAllocationPct / 100 }),
        });
        if (!result.applied) blocked.push(result);
      }
      const refreshed = await apiRequest<PortfolioData>("/quant-intelligence/portfolio");
      setPortfolio(refreshed);
      setErrorMessage(null);
      setStatusMessage(blocked.length
        ? `${blocked.length} strategies remain unchanged: Quant validation has not passed.`
        : applicable.length
          ? "Portfolio recommendations applied."
          : "No allocation was changed because no strategy currently has applicable Quant validation.");
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
      const result = await apiRequest<StrategyApplyResult>(`/quant-intelligence/portfolio/strategies/${encodeURIComponent(strategyKey)}/apply`, {
        method: "POST",
        body: JSON.stringify({ targetWeight: recommendedWeightPct / 100 }),
      });
      const refreshed = await apiRequest<PortfolioData>("/quant-intelligence/portfolio");
      setPortfolio(refreshed);
      setErrorMessage(null);
      setStatusMessage(result.applied
        ? `${strategyKey} allocation applied in ${result.mode} mode.`
        : `${strategyKey} remains unchanged: ${result.validation?.passingPairs ?? 0}/${result.validation?.requiredPairs ?? 0} validations pass; ${result.verifiedAttributedTrades}/5 verified attributed trades.`);
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

      {statusMessage && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          {statusMessage}
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Portfolio Sharpe</span>
          <p className="text-xl font-bold text-emerald-500">{metric(portfolio?.overallSharpeRatio)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">{t.quant.profitFactor}</span>
          <p className="text-xl font-bold">{portfolio?.overallProfitFactor === null && (portfolio?.actualTrading.totalTrades ?? 0) > 0 ? "∞" : metric(portfolio?.overallProfitFactor)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Portfolio EV</span>
          <p className="text-xl font-bold text-emerald-500">{signedMetric(portfolio?.expectedValue, "%")}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <span className="text-xs text-muted-foreground">Max Portfolio DD</span>
          <p className="text-xl font-bold text-emerald-500">{metric(portfolio?.maxPortfolioDrawdownPct, "%")}</p>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Verified exchange trade history</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-5 text-sm">
          <div>Trades: <strong>{portfolio?.actualTrading.totalTrades ?? 0}</strong></div>
          <div>Complete: <strong>{portfolio?.actualTrading.completeTrades ?? 0}</strong></div>
          <div>Win rate: <strong>{portfolio?.actualTrading.winRate ?? 0}%</strong></div>
          <div>Net PnL: <strong>{portfolio?.actualTrading.netPnl ?? 0}</strong></div>
          <div>Unassigned: <strong>{portfolio?.actualTrading.unassignedTrades ?? 0}</strong></div>
        </div>
      </div>

      {/* Allocation Recommendations */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t.quant.recommendedAllocation}</h2>
          <button
            type="button"
            onClick={() => void applyRecommendation()}
            disabled={applying || !(portfolio?.allocations.some((allocation) => allocation.canApply) ?? false)}
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
                <p className={`mb-1 text-xs ${a.canApply ? "text-emerald-300" : "text-amber-300"}`}>
                  {a.validationStatus === "FULL"
                    ? `FULL · ${a.verifiedAttributedTrades} verified trades`
                    : a.validationStatus === "CANARY"
                      ? `CANARY · ${a.verifiedAttributedTrades}/5 verified trades`
                      : `BLOCKED · ${a.validation.passingPairs}/${a.validation.requiredPairs} Quant validations pass`}
                </p>
                <span className="text-xs text-muted-foreground">
                  Correlation: {a.correlationWithPortfolio ?? "insufficient real trades"} · Diversification Score: {a.diversificationBenefitScore ?? "—"}/100
                </span>
              </div>
              <div className="text-right space-y-2">
                <div>
                  <span className="text-xs text-muted-foreground">Current: {a.currentCapitalAllocationPct}%</span>
                  <p className="text-base font-bold text-emerald-500">Recommended: {a.recommendedCapitalAllocationPct}%</p>
                </div>
                <button
                  type="button"
                  onClick={() => void applyStrategyRecommendation(a.strategyKey, a.recommendedCapitalAllocationPct)}
                  disabled={applying || applyingStrategy === a.strategyKey || !a.canApply}
                  className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50"
                >
                  {applyingStrategy === a.strategyKey
                    ? "Applying…"
                    : a.canApply
                      ? `Apply ${a.validationStatus}`
                      : "Validation required"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
