"use client";

import { useState } from "react";
import type { MarketAgentInput } from "@platform/shared";

import { useAnalysisRunner, type MarketAnalysisResult } from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function MarketAnalysisPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [symbol, setSymbol] = useState<MarketAgentInput["symbol"]>("BTC-USDT");
  const [provider, setProvider] =
    useState<MarketAgentInput["provider"]>("BINANCE_FUTURES");
  const [interval, setInterval] = useState<MarketAgentInput["interval"]>("1h");
  const [lookbackCandles, setLookbackCandles] = useState(100);

  const analysis = useAnalysisRunner("MARKET");
  const analysisInput: MarketAgentInput = {
    symbol,
    provider,
    interval,
    lookbackCandles,
  };

  const output = analysis.data?.output as MarketAnalysisResult | undefined;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t.ai.marketAnalysisTitle}</h1>
        <p className="mt-1 text-muted-foreground">{t.ai.marketAnalysisSubtitle}</p>
      </div>

      <section className="grid gap-4 rounded-lg border bg-card p-6 md:grid-cols-4">
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.symbol}
          <select className={fieldClassName} value={symbol} onChange={(event) => setSymbol(event.target.value as MarketAgentInput["symbol"])}>
            <option value="BTC-USDT">BTC-USDT</option>
            <option value="ETH-USDT">ETH-USDT</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.exchange}
          <select className={fieldClassName} value={provider} onChange={(event) => setProvider(event.target.value as MarketAgentInput["provider"])}>
            <option value="BINANCE_FUTURES">Binance Futures</option>
            <option value="OKX_FUTURES">OKX Futures</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.interval}
          <select className={fieldClassName} value={interval} onChange={(event) => setInterval(event.target.value as MarketAgentInput["interval"])}>
            {(["1m", "5m", "15m", "1h"] as const).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.lookbackCandles}
          <input className={fieldClassName} type="number" min={1} max={500} value={lookbackCandles} onChange={(event) => setLookbackCandles(Number(event.target.value))} />
        </label>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-4"
          disabled={analysis.isPending || lookbackCandles < 1 || lookbackCandles > 500}
          onClick={() => analysis.mutate(analysisInput)}
          type="button"
        >
          {analysis.isPending ? t.ai.analyzingMarket : t.ai.runMarketAnalysis}
        </button>
        {analysis.isError ? (
          <p className="text-sm text-red-500 md:col-span-4" role="alert">{analysis.error.message}</p>
        ) : null}
      </section>

      {output ? (
        <section className="space-y-4" aria-label="Market analysis result">
          <div className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">{t.ai.summary}</h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">Data quality: {output.dataQuality}</span>
            </div>
            <p className="text-sm leading-6">{output.summary}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ResultCard title={t.ai.trend}>
              <Metric label="Direction" value={output.trend.direction} />
              <Metric label="Strength" value={output.trend.strength} />
            </ResultCard>
            <ResultCard title={t.ai.volatility}>
              <Metric label="Level" value={output.volatility.level} />
              <Metric label="ATR" value={output.volatility.atr} />
            </ResultCard>
            <ResultCard title={t.ai.liquidity}>
              <Metric label="Bid/ask spread" value={output.liquidity.bidAskSpread} />
              <Metric label="Depth imbalance" value={output.liquidity.depthImbalance} />
            </ResultCard>
            <ResultCard title={t.ai.derivatives}>
              <Metric label="Funding rate" value={output.derivatives.fundingRate} />
              <Metric label="Funding trend" value={output.derivatives.fundingTrend} />
              <Metric label="Open interest" value={output.derivatives.openInterest} />
              <Metric label="OI trend" value={output.derivatives.oiTrend} />
            </ResultCard>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-lg font-semibold">{t.ai.anomalies}</h2>
            {output.anomalies.length ? (
              <ul className="list-inside list-disc space-y-1 text-sm">{output.anomalies.map((item: string) => <li key={item}>{item}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">{t.ai.noAnomalies}</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="space-y-3 rounded-lg border bg-card p-5"><h2 className="font-semibold">{title}</h2>{children}</div>;
}

function Metric({ label, value }: { label: string; value?: string }): React.JSX.Element {
  return <div className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-mono font-medium">{value ?? "Unavailable"}</span></div>;
}
