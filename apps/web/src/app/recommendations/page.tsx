"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
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
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
}

export default function RecommendationsPage() {
  const { t } = useTranslation();
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => {
    async function loadRecommendations() {
      try {
        const data = await apiRequest<RecommendationItem[]>("/quant-intelligence/recommendations");
        setRecommendations(data);
      } catch {
        setRecommendations([]);
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
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: action === "APPROVE" ? "APPROVED" : "REJECTED" } : r))
      );
    } catch {
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: action === "APPROVE" ? "APPROVED" : "REJECTED" } : r))
      );
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

      {recommendations.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground space-y-3">
          <Inbox className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <h3 className="font-semibold text-lg text-foreground">{t.quant.noRecommendations}</h3>
          <p className="text-sm max-w-md mx-auto">{t.quant.noRecommendationsDesc}</p>
        </div>
      ) : (
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
          ))}
        </div>
      )}
    </div>
  );
}
