"use client";

import { useQuery } from "@tanstack/react-query";
import { AccountNav } from "@/components/account-nav";
import { apiRequest } from "@/lib/api-client";

interface SentimentObservation {
  id?: string;
  provider: string;
  indexType: string;
  value: number;
  classification: string;
  observedAt: string;
  isStale?: boolean;
}

export default function SentimentPage() {
  const { data: current, isLoading: isCurrentLoading } = useQuery({
    queryKey: ["sentiment-current"],
    queryFn: async () => {
      return apiRequest<SentimentObservation>("/external-data/sentiment");
    },
  });

  const { data: history, isLoading: isHistoryLoading } = useQuery({
    queryKey: ["sentiment-history"],
    queryFn: async () => {
      return apiRequest<SentimentObservation[]>("/external-data/sentiment/history?limit=30");
    },
  });

  const getGaugeColor = (val: number) => {
    if (val <= 25) return "text-red-500 border-red-500 bg-red-500/10";
    if (val <= 45) return "text-orange-400 border-orange-400 bg-orange-400/10";
    if (val <= 55) return "text-yellow-400 border-yellow-400 bg-yellow-400/10";
    if (val <= 75) return "text-emerald-400 border-emerald-400 bg-emerald-400/10";
    return "text-emerald-500 border-emerald-500 bg-emerald-500/20";
  };

  return (
    <div className="container mx-auto max-w-5xl">
      <AccountNav />

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Public Market Sentiment</h1>
        <p className="text-sm text-muted-foreground">
          Crypto Fear & Greed Index observations collected continuously from public market sources.
        </p>
      </div>

      {/* Current Sentiment Card */}
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-1 rounded-lg border border-border bg-card p-6 flex flex-col items-center justify-center text-center">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase mb-4">Current Index Value</h2>
          {isCurrentLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Loading...</div>
          ) : current ? (
            <>
              <div
                className={`flex h-28 w-28 items-center justify-center rounded-full border-4 text-4xl font-extrabold shadow-inner ${getGaugeColor(
                  current.value,
                )}`}
              >
                {current.value}
              </div>
              <h3 className="mt-3 text-lg font-bold">{current.classification}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Observed: {new Date(current.observedAt).toLocaleString()}
              </p>
              {current.isStale && (
                <span className="mt-2 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400 border border-amber-500/20">
                  Stale Observation Warning
                </span>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">No sentiment data available</div>
          )}
        </div>

        {/* Index Explanation */}
        <div className="md:col-span-2 rounded-lg border border-border bg-card p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight mb-2">About Fear & Greed Index</h2>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              The Crypto Fear and Greed Index analyzes volatility, market momentum, volume, social media sentiment, dominance, and Google search trends to measure market sentiment from 0 (Extreme Fear) to 100 (Extreme Greed).
            </p>
            <div className="grid grid-cols-5 gap-2 text-center text-[11px] font-medium">
              <div className="rounded bg-red-500/10 p-2 text-red-400 border border-red-500/20">
                0-25<br />Extreme Fear
              </div>
              <div className="rounded bg-orange-400/10 p-2 text-orange-400 border border-orange-400/20">
                26-45<br />Fear
              </div>
              <div className="rounded bg-yellow-400/10 p-2 text-yellow-400 border border-yellow-400/20">
                46-55<br />Neutral
              </div>
              <div className="rounded bg-emerald-400/10 p-2 text-emerald-400 border border-emerald-400/20">
                56-75<br />Greed
              </div>
              <div className="rounded bg-emerald-500/20 p-2 text-emerald-500 border border-emerald-500/30">
                76-100<br />Extreme Greed
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Historical Observations */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold tracking-tight mb-4">Historical Sentiment (Last 30 Days)</h2>
        {isHistoryLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading history...</div>
        ) : !history || history.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No historical observations found.</div>
        ) : (
          <div className="space-y-3">
            {history.map((obs) => (
              <div key={obs.id || obs.observedAt} className="flex items-center justify-between p-3 rounded-md bg-muted/30 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-muted-foreground">{new Date(obs.observedAt).toLocaleDateString()}</span>
                  <span className="font-semibold text-foreground">{obs.classification}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-32 bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full ${
                        obs.value <= 25 ? "bg-red-500" : obs.value <= 45 ? "bg-orange-400" : obs.value <= 55 ? "bg-yellow-400" : "bg-emerald-500"
                      }`}
                      style={{ width: `${obs.value}%` }}
                    />
                  </div>
                  <span className="font-mono font-bold text-sm w-6 text-right">{obs.value}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
