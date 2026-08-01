"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  TechnicalAgentInput,
  TechnicalAgentOutput,
} from "@platform/shared";
import { apiRequest } from "@/lib/api-client";

interface TechnicalAnalysisRun {
  id: string;
  status: string;
  output?: TechnicalAgentOutput;
}

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function TechnicalAnalysisPage(): React.JSX.Element {
  const [symbol, setSymbol] =
    useState<TechnicalAgentInput["symbol"]>("BTC-USDT");
  const [provider, setProvider] =
    useState<TechnicalAgentInput["provider"]>("BINANCE_FUTURES");
  const [interval, setInterval] =
    useState<TechnicalAgentInput["interval"]>("1h");
  const [lookbackCandles, setLookbackCandles] = useState(150);
  const analysis = useMutation<TechnicalAnalysisRun, Error>({
    mutationFn: () =>
      apiRequest<TechnicalAnalysisRun>("/agents/TECHNICAL_ANALYST/runs", {
        method: "POST",
        body: JSON.stringify({
          input: { symbol, provider, interval, lookbackCandles },
        }),
      }),
  });
  const output = analysis.data?.output;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Technical Analysis
        </h1>
        <p className="mt-1 text-muted-foreground">
          Indicator, momentum, divergence, and structure research only. No trade
          recommendations or execution.
        </p>
      </div>

      <section className="grid gap-4 rounded-lg border bg-card p-6 md:grid-cols-4">
        <Select
          label="Symbol"
          value={symbol}
          onChange={(value) =>
            setSymbol(value as TechnicalAgentInput["symbol"])
          }
          options={["BTC-USDT", "ETH-USDT"]}
        />
        <Select
          label="Exchange"
          value={provider}
          onChange={(value) =>
            setProvider(value as TechnicalAgentInput["provider"])
          }
          options={["BINANCE_FUTURES", "OKX_FUTURES"]}
        />
        <Select
          label="Interval"
          value={interval}
          onChange={(value) =>
            setInterval(value as TechnicalAgentInput["interval"])
          }
          options={["1m", "5m", "15m", "1h"]}
        />
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          Lookback candles
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
          onClick={() => analysis.mutate()}
          type="button"
        >
          {analysis.isPending
            ? "Analyzing technical conditions…"
            : "Run technical analysis"}
        </button>
        {analysis.isError ? (
          <p className="text-sm text-red-500 md:col-span-4" role="alert">
            {analysis.error.message}
          </p>
        ) : null}
      </section>

      {output ? (
        <section className="space-y-4" aria-label="Technical analysis result">
          <div className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Summary</h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                Data quality: {output.dataQuality}
              </span>
            </div>
            <p className="text-sm leading-6">{output.summary}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card title="RSI">
              <Metric label="Value" value={output.momentum.rsi} />
              <Metric label="State" value={output.momentum.rsiState} />
            </Card>
            <Card title="MACD">
              <Metric label="Trend" value={output.momentum.macd.trend} />
              <Metric
                label="Crossover"
                value={output.momentum.macd.crossover}
              />
            </Card>
            <Card title="Moving averages">
              <Metric
                label="Alignment"
                value={output.movingAverages.alignment}
              />
              <Metric
                label="Price position"
                value={output.movingAverages.pricePosition}
              />
            </Card>
            <Card title="Divergence">
              <Metric label="RSI" value={output.divergence.rsiDivergence} />
              <Metric label="MACD" value={output.divergence.macdDivergence} />
            </Card>
            <Card title="Structure">
              <Metric
                label="Market structure"
                value={output.structure.marketStructure}
              />
              <Metric
                label="Breakout"
                value={
                  output.structure.breakout === undefined
                    ? undefined
                    : String(output.structure.breakout)
                }
              />
            </Card>
            <Card title="Volatility">
              <Metric label="ATR" value={output.volatility.atr} />
              <Metric
                label="Bollinger position"
                value={output.volatility.bollinger.position}
              />
              <Metric
                label="Squeeze"
                value={String(output.volatility.bollinger.squeeze)}
              />
            </Card>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-lg font-semibold">
              Technical observations
            </h2>
            {output.signals.length ? (
              <ul className="list-inside list-disc space-y-1 text-sm">
                {output.signals.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No notable observations.
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
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
