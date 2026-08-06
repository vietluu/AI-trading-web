"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { FlaskConical, Sparkles } from "lucide-react";

interface HypothesisData {
  title: string;
  category: string;
  description: string;
  hypothesisText: string;
  expectedValue: number;
  profitFactor: number;
  sharpeRatio: number;
  statisticalProof?: {
    pValue: number;
    sampleSize: number;
    tStatistic: number;
    confidenceInterval: [number, number];
  };
}

export default function ResearchPage() {
  const { t } = useTranslation();
  const [hypothesis, setHypothesis] = useState<HypothesisData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHypothesis() {
      try {
        const data = await apiRequest<HypothesisData>("/quant-intelligence/hypotheses");
        setHypothesis(data);
      } catch {
        //
      } finally {
        setLoading(false);
      }
    }
    void loadHypothesis();
  }, []);

  if (loading) return <div className="p-8 text-center text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary" /> {t.quant.researchTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.quant.researchSubtitle}
          </p>
        </div>
      </div>

      {/* Hypothesis Card */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
          <Sparkles className="h-4 w-4" /> {t.research.category}: {hypothesis?.category}
        </div>
        <h2 className="text-xl font-bold">{hypothesis?.title}</h2>
        <p className="text-sm text-muted-foreground">{hypothesis?.description}</p>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm font-medium">
          "{hypothesis?.hypothesisText}"
        </div>

        {/* Statistical Evidence */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-2">
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.pValue}</span>
            <p className="text-lg font-bold text-emerald-500">{hypothesis?.statisticalProof?.pValue} ({t.research.statSig})</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.sampleSize}</span>
            <p className="text-lg font-bold">{hypothesis?.statisticalProof?.sampleSize} {t.research.candles}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.tStatistic}</span>
            <p className="text-lg font-bold">{hypothesis?.statisticalProof?.tStatistic}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.confidenceInterval}</span>
            <p className="text-lg font-bold">[{hypothesis?.statisticalProof?.confidenceInterval?.[0]}, {hypothesis?.statisticalProof?.confidenceInterval?.[1]}]</p>
          </div>
        </div>
      </div>
    </div>
  );
}
