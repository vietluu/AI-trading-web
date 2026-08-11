"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { getRecommendations, reviewRecommendation } from "@/services/quant.service";
import { apiRequest } from "@/lib/api-client";
import { ShieldCheck, Check, X, Inbox } from "lucide-react";

interface RecommendationItem {
  id: string;
  title: string;
  moduleSource: string;
  problemStatement: string;
  evidenceText: string;
  expectedBenefit: string;
  estimatedRisk: string;
  priority: string;
  implementationCost: string;
  rollbackPlan: string;
  historicalResult?: Record<string, unknown>;
  status: "VALIDATION_REQUIRED" | "PENDING_APPROVAL" | "APPROVED" | "SHADOW" | "CANARY" | "REJECTED" | "DEPLOYED" | "ROLLED_BACK";
}

interface SymbolRecommendation {
  symbol: string;
  provider: string;
  opportunityScore: number;
  price: number;
  volume24h: number;
  change24hPct: number;
  reasons: string[];
  isCommon: boolean;
}

export default function RecommendationsPage() {
  const { t } = useTranslation();
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [exchangeRecs, setExchangeRecs] = useState<SymbolRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const priorityLabels: Record<string, string> = {
    LOW: t.quant.recommendationPriorities.low,
    MEDIUM: t.quant.recommendationPriorities.medium,
    HIGH: t.quant.recommendationPriorities.high,
    CRITICAL: t.quant.recommendationPriorities.critical,
  };
  const statusLabels: Record<string, string> = {
    VALIDATION_REQUIRED: t.quant.recommendationStatuses.validationRequired,
    PENDING_APPROVAL: t.quant.recommendationStatuses.pendingApproval,
    APPROVED: t.quant.recommendationStatuses.approved,
    SHADOW: t.quant.recommendationStatuses.shadow,
    CANARY: t.quant.recommendationStatuses.canary,
    REJECTED: t.quant.recommendationStatuses.rejected,
    DEPLOYED: t.quant.recommendationStatuses.deployed,
    ROLLED_BACK: t.quant.recommendationStatuses.rolledBack,
  };
  const moduleLabels: Record<string, string> = {
    THRESHOLD_OPTIMIZER: t.quant.recommendationModules.thresholdOptimizer,
    WEIGHT_OPTIMIZER: t.quant.recommendationModules.weightOptimizer,
    SELF_LEARNING_AUTO: t.quant.recommendationModules.selfLearningAuto,
    PORTFOLIO_INTELLIGENCE: t.quant.recommendationModules.portfolioOptimizer,
  };
  const interpolate = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template);
  const localizeReason = (reason: string) => {
    if (reason === "Ultra-high liquidity ($500M+ 24h vol)") return t.quant.ultraHighLiquidity;
    if (reason === "Strong liquidity ($100M+ 24h vol)") return t.quant.strongLiquidity;
    if (reason === "Supported on both Binance & OKX") return t.quant.supportedOnBothExchanges;
    if (reason === "Major market benchmark") return t.quant.majorMarketBenchmark;
    if (reason.startsWith("High trading momentum")) {
      const detail = reason.match(/\((.+)\)/)?.[1];
      return detail ? `${t.quant.highTradingMomentum} (${detail})` : t.quant.highTradingMomentum;
    }
    return reason;
  };
  const localizedRecommendation = (rec: RecommendationItem) => {
    if (rec.moduleSource !== "THRESHOLD_OPTIMIZER") return rec;
    const value = Number(rec.historicalResult?.optimizedValue ?? rec.title.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
    const sample = Number(rec.historicalResult?.sampleSize ?? 0);
    const accuracy = Number(rec.historicalResult?.observedAccuracy ?? 0).toFixed(2);
    return {
      ...rec,
      title: interpolate(t.quant.thresholdRecommendationTitle, { value }),
      problemStatement: t.quant.thresholdRecommendationProblem,
      evidenceText: interpolate(t.quant.thresholdRecommendationEvidence, { sample, accuracy }),
      expectedBenefit: t.quant.thresholdRecommendationBenefit,
      estimatedRisk: t.quant.thresholdRecommendationRisk,
      rollbackPlan: t.quant.thresholdRecommendationRollback,
    };
  };

  useEffect(() => {
    async function loadData() {
      try {
        const [quantData, exchangeRes] = await Promise.allSettled([
          getRecommendations(),
          apiRequest<SymbolRecommendation[]>("/quant-intelligence/opportunities?limit=6"),
        ]);
        if (quantData.status === "fulfilled") setRecommendations(quantData.value);
        if (exchangeRes.status === "fulfilled" && Array.isArray(exchangeRes.value)) {
          setExchangeRecs(exchangeRes.value);
        }
      } catch {
        setRecommendations([]);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  async function handleReview(id: string, action: "APPROVE" | "REJECT") {
    setActioningId(id);
    setActionError(null);
    try {
      await reviewRecommendation(id, action);
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: action === "APPROVE" ? "APPROVED" : "REJECTED" } : r))
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Recommendation review failed");
    } finally {
      setActioningId(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> {t.quant.recommendationsTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.quant.recommendationsSubtitle}
          </p>
        </div>
      </div>
      {actionError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{actionError}</div>}

      {/* Top AI Exchange Symbol Recommendations */}
      {exchangeRecs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {t.quant.opportunityRecommendationsTitle}
            </h2>
            <span className="text-xs text-muted-foreground">{t.quant.scannedFromExchanges}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {exchangeRecs.map((item) => (
              <div
                key={item.symbol}
                className="rounded-2xl border border-emerald-500/20 bg-card/60 p-4 shadow-sm backdrop-blur-md hover:border-emerald-500/40 transition-all space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-foreground">{item.symbol}</span>
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-300">
                    {t.quant.evScore}: {item.opportunityScore}/100
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-mono text-muted-foreground">
                    ${item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <span
                    className={`font-semibold ${
                      item.change24hPct >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {item.change24hPct >= 0 ? "+" : ""}
                    {item.change24hPct.toFixed(2)}%
                  </span>
                </div>
                <div className="space-y-1 pt-1 border-t border-border/50">
                  {item.reasons.map((r, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <span className="text-emerald-400">•</span> {localizeReason(r)}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendations.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground space-y-3">
          <Inbox className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <h3 className="font-semibold text-lg text-foreground">{t.quant.noRecommendations}</h3>
          <p className="text-sm max-w-md mx-auto">{t.quant.noRecommendationsDesc}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recommendations.map((item) => {
            const rec = localizedRecommendation(item);
            return (
            <div key={rec.id} className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">{moduleLabels[rec.moduleSource] ?? rec.moduleSource.replaceAll("_", " ")}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${rec.priority === "CRITICAL" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"}`}>
                    {t.quant.priorityLabel}: {priorityLabels[rec.priority] ?? rec.priority}
                  </span>
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${rec.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-500" : rec.status === "REJECTED" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"}`}>
                  {t.quant.statusLabel}: {statusLabels[rec.status] ?? rec.status}
                </span>
              </div>

              <h2 className="text-lg font-bold">{rec.title}</h2>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-border p-3">
                  <strong className="text-xs text-muted-foreground uppercase block mb-1">{t.quant.problemStatement}</strong>
                  <p>{rec.problemStatement}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <strong className="text-xs text-muted-foreground uppercase block mb-1">{t.quant.evidenceText}</strong>
                  <p>{rec.evidenceText}</p>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <strong className="text-xs text-emerald-500 uppercase block mb-1">{t.quant.expectedBenefit}</strong>
                  <p className="font-semibold">{rec.expectedBenefit}</p>
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                  <strong className="text-xs text-rose-500 uppercase block mb-1">{t.quant.estimatedRisk}</strong>
                  <p>{rec.estimatedRisk} <br /><span className="text-xs text-muted-foreground">{t.quant.rollbackLabel}: {rec.rollbackPlan}</span></p>
                </div>
              </div>

              {rec.status === "PENDING_APPROVAL" && (
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => void handleReview(rec.id, "REJECT")}
                    disabled={actioningId === rec.id}
                    className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                  >
                    <X className="h-4 w-4" /> {t.quant.rejectRecommendation}
                  </button>
                  <button
                    onClick={() => void handleReview(rec.id, "APPROVE")}
                    disabled={actioningId === rec.id}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" /> {t.quant.approveRecommendation}
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
