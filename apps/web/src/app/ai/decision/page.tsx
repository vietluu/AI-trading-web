"use client";

import { useState } from "react";
import type { FusionRunInput } from "@platform/shared";
import { useDecisionRunner } from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function DecisionPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [symbol, setSymbol] = useState<FusionRunInput["symbol"]>("BTC-USDT");
  const [symbols] = useState<string[]>(["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT", "DOGE-USDT", "ADA-USDT", "AVAX-USDT", "LINK-USDT", "NEAR-USDT", "SUI-USDT"]);
  const [provider, setProvider] =
    useState<FusionRunInput["provider"]>("BINANCE_FUTURES");
  const [interval, setInterval] = useState<FusionRunInput["interval"]>("15m");

  const decision = useDecisionRunner();
  const decisionInput: FusionRunInput = {
    symbol,
    provider,
    interval,
    lookbackCandles: 150,
    lookbackHours: 6,
    maxItems: 20,
  };

  const output = decision.data;
  const badge =
    output?.decision === "LONG"
      ? "bg-emerald-500/15 text-emerald-400"
      : output?.decision === "SHORT"
        ? "bg-red-500/15 text-red-400"
        : "bg-amber-500/15 text-amber-300";

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t.ai.decisionTitle}</h1>
        <p className="mt-1 text-muted-foreground">{t.ai.decisionSubtitle}</p>
      </div>

      <section className="grid gap-4 rounded-lg border bg-card p-6 md:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.symbol}
          <select className={fieldClassName} value={symbol} onChange={(event) => setSymbol(event.target.value)}>
            {symbols.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.exchange}
          <select className={fieldClassName} value={provider} onChange={(event) => setProvider(event.target.value as FusionRunInput["provider"])}>
            <option value="BINANCE_FUTURES">Binance Futures</option>
            <option value="OKX_FUTURES">OKX Futures</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.interval}
          <select className={fieldClassName} value={interval} onChange={(event) => setInterval(event.target.value as FusionRunInput["interval"])}>
            {(["1m", "5m", "15m", "1h"] as const).map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-3" disabled={decision.isPending} onClick={() => decision.mutate(decisionInput)} type="button">
          {decision.isPending ? t.ai.runningPipeline : t.ai.generateDecision}
        </button>
        {decision.isError ? <p className="text-sm text-red-500 md:col-span-3" role="alert">{decision.error.message}</p> : null}
      </section>

      {output ? (
        <section className="space-y-4" aria-label="Decision result">
          <div className="rounded-lg border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className={`rounded-full px-5 py-2 text-xl font-black ${badge}`}>{output.decision}</span>
              <div className="flex gap-6 text-sm">
                <Metric label={t.ai.confidence} value={`${output.confidence}%`} />
                <Metric label={t.ai.agreement} value={`${output.agreementScore}%`} />
                <Metric label={t.ai.data} value={output.dataQuality} />
                <Metric label={t.ai.regime} value={output.regime.type} />
                <Metric label={t.ai.conflict} value={output.conflictLevel} />
              </div>
            </div>
            <p className="mt-5 text-sm leading-6">{output.reasoning}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FactorCard title={t.ai.bullishFactors} items={output.signals.bullishFactors} empty={t.ai.noBullish} />
            <FactorCard title={t.ai.bearishFactors} items={output.signals.bearishFactors} empty={t.ai.noBearish} />
          </div>
          <div className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{t.ai.adaptiveWeighting}</h2>
              <span className="text-xs text-muted-foreground">{t.ai.volatilityAdjustment} {output.volatilityAdjustment}%</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
              {Object.entries(output.weighting).map(([name, weight]) => (
                <Metric key={name} label={name === "onchain" ? "On-chain" : name} value={`${weight}%`} />
              ))}
            </div>
          </div>
          <FactorCard title={t.ai.overrides} items={output.overrides} empty={t.ai.noOverrides} />
          <FactorCard title={t.ai.risks} items={output.risks} empty={t.ai.noRisks} />
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-mono font-semibold">{value}</p></div>;
}

function FactorCard({ title, items, empty }: { title: string; items: string[]; empty: string }): React.JSX.Element {
  return <div className="rounded-lg border bg-card p-5"><h2 className="mb-3 font-semibold">{title}</h2>{items.length ? <ul className="list-inside list-disc space-y-2 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}</div>;
}
