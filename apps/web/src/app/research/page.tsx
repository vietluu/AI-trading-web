"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { FlaskConical, Sparkles } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface HypothesisData {
  symbol: string;
  status?: string;
  reason?: string;
  title?: string;
  category: string;
  description?: string;
  hypothesisText?: string;
  expectedValue?: number;
  profitFactor?: number | null;
  sharpeRatio?: number | null;
  statisticalProof?: {
    pValue?: number;
    sampleSize: number;
    tStatistic?: number;
    confidenceInterval?: [number, number];
  };
}

interface HypothesesResponse {
  status: "COMPLETED" | "NO_SYMBOLS_SELECTED";
  symbols: string[];
  sources: { settings: string[]; pipelineTriggers: string[] };
  hypotheses: HypothesisData[];
}

export default function ResearchPage() {
  const { t } = useTranslation();
  const [research, setResearch] = useState<HypothesesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHypothesis() {
      try {
        const data = await apiRequest<HypothesesResponse>("/quant-intelligence/hypotheses");
        setResearch(data);
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

      {research?.status === "NO_SYMBOLS_SELECTED" && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">{t.research.noSymbolsSelected}</p>
          <p className="mt-1 text-amber-100/80">{t.research.noSymbolsSelectedDesc}</p>
        </div>
      )}

      {research && research.symbols.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold">{t.research.selectedSymbols}:</span>
          {research.symbols.map((symbol) => <span key={symbol} className="rounded-full border border-border px-2 py-1 text-foreground">{symbol}</span>)}
        </div>
      )}

      {research?.hypotheses.map((hypothesis) => hypothesis.status === "DATA_UNAVAILABLE" ? (
        <div key={hypothesis.symbol} className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">{hypothesis.symbol}</p>
          <p className="mt-1">{t.research.insufficientSymbolData} ({hypothesis.statisticalProof?.sampleSize ?? 0} {t.research.evaluatedOutcomes})</p>
        </div>
      ) : <div key={hypothesis.symbol} className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
          <Sparkles className="h-4 w-4" /> {hypothesis.symbol} · {t.research.category}: {hypothesis.category}
        </div>
        <h2 className="text-xl font-bold">{hypothesis.title}</h2>
        <p className="text-sm text-muted-foreground">{hypothesis.description}</p>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm font-medium">
          &quot;{hypothesis.hypothesisText}&quot;
        </div>

        {/* Statistical Evidence */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-2">
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.pValue}</span>
            <p className="text-lg font-bold text-emerald-500">{formatNumber(hypothesis.statisticalProof?.pValue)} ({t.research.statSig})</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.sampleSize}</span>
            <p className="text-lg font-bold">{hypothesis.statisticalProof?.sampleSize} {t.research.evaluatedOutcomes}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.tStatistic}</span>
            <p className="text-lg font-bold">{formatNumber(hypothesis.statisticalProof?.tStatistic)}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <span className="text-xs text-muted-foreground">{t.research.confidenceInterval}</span>
            <p className="text-lg font-bold">[{formatNumber(hypothesis.statisticalProof?.confidenceInterval?.[0])}, {formatNumber(hypothesis.statisticalProof?.confidenceInterval?.[1])}]</p>
          </div>
        </div>
      </div>)}
    </div>
  );
}
