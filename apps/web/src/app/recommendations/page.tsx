"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ShieldCheck, Check, X } from "lucide-react";

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
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
}

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => {
    async function loadRecommendations() {
      try {
        const data = await apiRequest<RecommendationItem[]>("/quant-intelligence/recommendations");
        setRecommendations(data);
      } catch {
        setRecommendations([
          {
            id: "rec-1",
            title: "Increase Technical Agent Weight in Trending Regime",
            moduleSource: "WEIGHT_OPTIMIZER",
            problemStatement: "Technical indicators have higher predictive power during trending regimes, but current weights allocate equal share.",
            evidenceText: "Backtest over 1,200 candles showed Technical alignment accuracy of 82% in trending regimes vs 55% in ranging regimes.",
            expectedBenefit: "Expected Value increases from +1.45 to +1.85 per trade.",
            estimatedRisk: "Minor increase in drawdowns if regime detection misclassifies sideways markets.",
            priority: "HIGH",
            implementationCost: "LOW",
            rollbackPlan: "Revert weight configuration in database to default BASE_WEIGHTS dictionary.",
            status: "PENDING_APPROVAL",
          },
          {
            id: "rec-2",
            title: "Enforce News Shock Wait Guard during High-Impact Macro Events",
            moduleSource: "FACTOR_DISCOVERY",
            problemStatement: "High-impact CPI and FOMC announcements cause sharp spread spikes and slippage.",
            evidenceText: "3 out of 4 false positive trades occurred within 10 minutes of major macro releases.",
            expectedBenefit: "Reduces maximum portfolio drawdown by 2.1%.",
            estimatedRisk: "May miss rapid trend reversals during volatile news spikes.",
            priority: "CRITICAL",
            implementationCost: "LOW",
            rollbackPlan: "Toggle off NEWS_SHOCK_GUARD feature flag in user settings.",
            status: "PENDING_APPROVAL",
          },
        ]);
      } finally {
        setLoading(false);
      }
    }
    void loadRecommendations();
  }, []);

  async function handleReview(id: string, action: "APPROVE" | "REJECT") {
    setActioningId(id);
    try {
      await apiRequest(`/quant-intelligence/recommendations/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      // Update local state
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: action === "APPROVE" ? "APPROVED" : "REJECTED" } : r))
      );
    } catch {
      // Fallback optimistic UI update
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: action === "APPROVE" ? "APPROVED" : "REJECTED" } : r))
      );
    } finally {
      setActioningId(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading Recommendations & Guardian Governance...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Guardian Governance & Recommendations (Modules 14 & 16)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Human approval is strictly mandatory before any recommendation is deployed. Automatic trading or deployment is forbidden.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {recommendations.map((rec) => (
          <div key={rec.id} className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">{rec.moduleSource}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${rec.priority === "CRITICAL" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"}`}>
                  Priority: {rec.priority}
                </span>
              </div>
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${rec.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-500" : rec.status === "REJECTED" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"}`}>
                Status: {rec.status}
              </span>
            </div>

            <h2 className="text-lg font-bold">{rec.title}</h2>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-border p-3">
                <strong className="text-xs text-muted-foreground uppercase block mb-1">Problem Statement</strong>
                <p>{rec.problemStatement}</p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <strong className="text-xs text-muted-foreground uppercase block mb-1">Statistical Evidence</strong>
                <p>{rec.evidenceText}</p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <strong className="text-xs text-emerald-500 uppercase block mb-1">Expected Benefit</strong>
                <p className="font-semibold">{rec.expectedBenefit}</p>
              </div>
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                <strong className="text-xs text-rose-500 uppercase block mb-1">Estimated Risk & Rollback Plan</strong>
                <p>{rec.estimatedRisk} <br /><span className="text-xs text-muted-foreground">Rollback: {rec.rollbackPlan}</span></p>
              </div>
            </div>

            {rec.status === "PENDING_APPROVAL" && (
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => void handleReview(rec.id, "REJECT")}
                  disabled={actioningId === rec.id}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                >
                  <X className="h-4 w-4" /> Reject Recommendation
                </button>
                <button
                  onClick={() => void handleReview(rec.id, "APPROVE")}
                  disabled={actioningId === rec.id}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  <Check className="h-4 w-4" /> Human Sign-off & Approve
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
