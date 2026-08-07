"use client";

import { useState } from "react";
import type { TechnicalAgentInput } from "@platform/shared";
import {
  useAnalysisRunner,
  type AnalysisRunResult,
  type TechnicalAnalysisResult,
} from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function TechnicalAnalysisPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [symbol, setSymbol] =
    useState<TechnicalAgentInput["symbol"]>("BTC-USDT");
  const [provider, setProvider] =
    useState<TechnicalAgentInput["provider"]>("OKX_FUTURES");
  const [interval, setInterval] =
    useState<TechnicalAgentInput["interval"]>("1h");
  const [lookbackCandles, setLookbackCandles] = useState(150);
  const analysis = useAnalysisRunner("TECHNICAL");
  const analysisInput: TechnicalAgentInput = {
    symbol,
    provider,
    interval,
    lookbackCandles,
  };
  const output = analysis.data?.output;
  const technicalOutput = isTechnicalAnalysisResult(output) ? output : undefined;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t.ai.technicalAnalysisTitle}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {t.ai.technicalAnalysisSubtitle}
        </p>
      </div>

      <section className="grid gap-4 rounded-lg border bg-card p-6 md:grid-cols-4">
        <Select
          label={t.ai.symbol}
          value={symbol}
          onChange={(value) => setSymbol(value)}
          options={["BTC-USDT", "ETH-USDT"]}
        />
        <Select
          label={t.ai.exchange}
          value={provider}
          onChange={(value) => setProvider(value as TechnicalAgentInput["provider"])}
          options={["OKX_FUTURES", "BINANCE_FUTURES"]}
        />
        <Select
          label={t.ai.interval}
          value={interval}
          onChange={(value) => setInterval(value as TechnicalAgentInput["interval"])}
          options={["1m", "5m", "15m", "1h"]}
        />
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.lookbackCandles}
          <input
            className={fieldClassName}
            type="number"
            min={1}
            max={500}
            value={lookbackCandles}
            onChange={(event) => setLookbackCandles(Number(event.target.value))}
          />
        </label>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-4"
          disabled={
            analysis.isPending || lookbackCandles < 1 || lookbackCandles > 500
          }
          onClick={() => analysis.mutate(analysisInput)}
          type="button"
        >
          {analysis.isPending
            ? t.ai.analyzingTechnical
            : t.ai.runTechnicalAnalysis}
        </button>
        {analysis.isError ? (
          <p className="text-sm text-red-500 md:col-span-4" role="alert">
            {analysis.error.message}
          </p>
        ) : null}
      </section>

      {technicalOutput ? (
        <section className="space-y-4" aria-label="Technical analysis result">
          <div className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">{t.ai.summary}</h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                Data quality: {technicalOutput.dataQuality}
              </span>
            </div>
            <p className="text-sm leading-6">{technicalOutput.summary}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card title="RSI">
              <Metric label="Value" value={technicalOutput.momentum.rsi} />
              <Metric label="State" value={technicalOutput.momentum.rsiState} />
            </Card>
            <Card title="MACD">
              <Metric label="Trend" value={technicalOutput.momentum.macd.trend} />
              <Metric
                label="Crossover"
                value={technicalOutput.momentum.macd.crossover}
              />
            </Card>
            <Card title="Moving averages">
              <Metric
                label="Alignment"
                value={technicalOutput.movingAverages.alignment}
              />
              <Metric
                label="Price position"
                value={technicalOutput.movingAverages.pricePosition}
              />
            </Card>
            <Card title="Divergence">
              <Metric label="RSI" value={technicalOutput.divergence.rsiDivergence} />
              <Metric label="MACD" value={technicalOutput.divergence.macdDivergence} />
            </Card>
            <Card title="Structure">
              <Metric
                label="Market structure"
                value={technicalOutput.structure.marketStructure}
              />
              <Metric
                label="Breakout"
                value={
                  technicalOutput.structure.breakout === undefined
                    ? undefined
                    : String(technicalOutput.structure.breakout)
                }
              />
            </Card>
            <Card title="Volatility">
              <Metric label="ATR" value={technicalOutput.volatility.atr} />
              <Metric
                label="Bollinger position"
                value={technicalOutput.volatility.bollinger.position}
              />
              <Metric
                label="Squeeze"
                value={String(technicalOutput.volatility.bollinger.squeeze)}
              />
            </Card>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-lg font-semibold">
              {t.ai.technicalObservations}
            </h2>
            {technicalOutput.signals.length ? (
              <ul className="list-inside list-disc space-y-1 text-sm">
                {technicalOutput.signals.map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t.ai.noObservations}
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function isTechnicalAnalysisResult(
  value: AnalysisRunResult["output"],
): value is TechnicalAnalysisResult {
  return Boolean(value) && typeof value === "object" && "momentum" in value && "movingAverages" in value && "divergence" in value && "structure" in value && "volatility" in value && "signals" in value;
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="space-y-1 text-xs font-semibold text-muted-foreground">
      {label}
      <select
        className={fieldClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value?: string;
}): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value ?? "Unavailable"}</span>
    </div>
  );
}
