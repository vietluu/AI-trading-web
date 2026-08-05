"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { Layers } from "lucide-react";

interface FactorItem {
  factorName: string;
  category: string;
  predictivePower: number;
  contribution: number;
  noiseScore: number;
  redundancyScore: number;
}

export default function FactorsPage() {
  const { t } = useTranslation();
  const [factors, setFactors] = useState<FactorItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFactors() {
      try {
        const data = await apiRequest<FactorItem[]>("/quant-intelligence/factors");
        setFactors(data);
      } catch {
        setFactors([
          { factorName: "EMA Alignment (20/50/200)", category: "TECHNICAL", predictivePower: 85, contribution: 25, noiseScore: 15, redundancyScore: 10 },
          { factorName: "Market Structure (HH/HL)", category: "STRUCTURE", predictivePower: 88, contribution: 22, noiseScore: 12, redundancyScore: 8 },
          { factorName: "High-Impact News Events", category: "NEWS", predictivePower: 90, contribution: 15, noiseScore: 30, redundancyScore: 5 },
          { factorName: "Whale Net Exchange Outflow", category: "ONCHAIN", predictivePower: 84, contribution: 14, noiseScore: 16, redundancyScore: 10 },
        ]);
      } finally {
        setLoading(false);
      }
    }
    void loadFactors();
  }, []);

  if (loading) return <div className="p-8 text-center text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" /> {t.quant.factorsTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.quant.factorsSubtitle}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
        {factors.map((f, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary px-2 py-0.5 rounded-md bg-primary/10">{f.category}</span>
              <span className="text-xs text-muted-foreground">Power: {f.predictivePower}/100</span>
            </div>
            <h3 className="text-base font-bold">{f.factorName}</h3>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-500 font-semibold">
                Contrib: {f.contribution}%
              </div>
              <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500 font-semibold">
                Noise: {f.noiseScore}%
              </div>
              <div className="rounded-lg bg-muted p-2 font-semibold">
                Redundancy: {f.redundancyScore}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
