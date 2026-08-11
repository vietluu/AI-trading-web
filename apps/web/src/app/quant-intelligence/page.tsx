"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { Brain, ShieldCheck, TrendingUp, Award, Activity, BarChart2 } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface ScorecardData {
  overallScore: number;
  grade: string;
  dimensions: Record<string, number>;
  expectedValue: number | null;
  profitFactor: number | null;
  sharpeRatio: number | null;
  calmarRatio: number | null;
  maxDrawdownPct: number | null;
  walkForwardStability: number | null;
  monteCarloSurvivalRate: number | null;
}

export default function QuantIntelligencePage() {
  const { t } = useTranslation();
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gradeLabel = scorecard?.grade === "INSUFFICIENT_EVIDENCE"
    ? t.quant.insufficientEvidenceGrade
    : scorecard?.grade;

  useEffect(() => {
    async function loadScorecard() {
      try {
        const data = await apiRequest<ScorecardData>("/quant-intelligence/scorecard");
        setScorecard(data);
      } catch (cause) {
        setScorecard(null);
        setError(cause instanceof Error ? cause.message : "Verified quantitative evidence is unavailable.");
      } finally {
        setLoading(false);
      }
    }
    void loadScorecard();
  }, []);

  if (loading) return <div className="p-8 text-center text-muted-foreground">{t.common.loading}</div>;
  if (error || !scorecard) return <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error ?? "DATA_UNAVAILABLE"}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" /> {t.quant.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.quant.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2 text-primary font-bold">
          <Award className="h-5 w-5" /> {t.quant.scorecardGrade}: {gradeLabel} ({formatNumber(scorecard.overallScore)}/100)
        </div>
      </div>

      {/* Primary Statistical Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">{t.quant.expectedValue}</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-500">{scorecard.expectedValue == null ? "—" : `${scorecard.expectedValue > 0 ? "+" : ""}${formatNumber(scorecard.expectedValue)}%`}</p>
          <span className="text-xs text-muted-foreground">{t.quant.expectedValueDesc}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">{t.quant.profitFactor}</span>
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatNumber(scorecard.profitFactor)}</p>
          <span className="text-xs text-muted-foreground">{t.quant.profitFactorDesc}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">{t.quant.sharpeCalmar}</span>
            <BarChart2 className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatNumber(scorecard.sharpeRatio)} / {formatNumber(scorecard.calmarRatio)}</p>
          <span className="text-xs text-muted-foreground">{t.quant.sharpeCalmarDesc}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">{t.quant.survivalRate}</span>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-500">{scorecard.monteCarloSurvivalRate == null ? "—" : `${formatNumber(scorecard.monteCarloSurvivalRate)}%`}</p>
          <span className="text-xs text-muted-foreground">{t.quant.maxDrawdown}: {scorecard.maxDrawdownPct == null ? "—" : `${formatNumber(scorecard.maxDrawdownPct)}%`}</span>
        </div>
      </div>

      {/* 10-Dimension Decision Scorecard */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">{t.quant.scorecardHeader}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(scorecard?.dimensions ?? {}).map(([dim, score]: [string, number]) => (
            <div key={dim} className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
              <p className="text-xs font-medium text-muted-foreground capitalize">{dim.replace(/([A-Z])/g, " $1")}</p>
              <p className="mt-1 text-xl font-bold text-primary">{formatNumber(score)}/100</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
