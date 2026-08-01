"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  NewsSentimentInput,
  SentimentAgentOutput,
} from "@platform/shared";
import { apiRequest } from "@/lib/api-client";

interface SentimentAnalysisRun {
  id: string;
  status: string;
  output?: SentimentAgentOutput;
}
const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function SentimentAnalysisPage(): React.JSX.Element {
  const [symbol, setSymbol] = useState<NewsSentimentInput["symbol"]>("BTC");
  const [lookbackHours, setLookbackHours] = useState(6);
  const [maxItems, setMaxItems] = useState(20);
  const analysis = useMutation<SentimentAnalysisRun, Error>({
    mutationFn: () =>
      apiRequest<SentimentAnalysisRun>("/agents/SENTIMENT_ANALYST/runs", {
        method: "POST",
        body: JSON.stringify({ input: { symbol, lookbackHours, maxItems } }),
      }),
  });
  const output = analysis.data?.output;
  const invalid =
    lookbackHours < 1 || lookbackHours > 24 || maxItems < 1 || maxItems > 50;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">
          Sentiment Analysis
        </h1>
        <p className="mt-1 text-muted-foreground">
          Social sentiment, narrative shifts, and crowd psychology research. No
          trading advice or execution.
        </p>
      </header>
      <section className="grid gap-4 rounded-lg border bg-card p-6 md:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          Symbol
          <select
            className={fieldClassName}
            value={symbol}
            onChange={(event) =>
              setSymbol(event.target.value as NewsSentimentInput["symbol"])
            }
          >
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
          </select>
        </label>
        <NumberField
          label="Lookback hours"
          min={1}
          max={24}
          value={lookbackHours}
          onChange={setLookbackHours}
        />
        <NumberField
          label="Maximum social posts"
          min={1}
          max={50}
          value={maxItems}
          onChange={setMaxItems}
        />
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-3"
          disabled={analysis.isPending || invalid}
          onClick={() => analysis.mutate()}
          type="button"
        >
          {analysis.isPending
            ? "Analyzing market psychology…"
            : "Run sentiment analysis"}
        </button>
        {analysis.isError ? (
          <p className="text-sm text-red-500 md:col-span-3" role="alert">
            {analysis.error.message}
          </p>
        ) : null}
      </section>
      {output ? (
        <section className="space-y-4" aria-label="Sentiment analysis result">
          <div className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Summary</h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                Data quality: {output.dataQuality}
              </span>
            </div>
            <p className="text-sm leading-6">{output.summary}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Sentiment">
              <Metric label="Overall" value={output.sentiment.overall} />
              <Metric label="Intensity" value={output.sentiment.intensity} />
            </Card>
            <Card title="Crowd behavior">
              <Flag label="FOMO" value={output.crowdBehavior.fomo} />
              <Flag label="Panic" value={output.crowdBehavior.panic} />
              <Flag label="Euphoria" value={output.crowdBehavior.euphoria} />
            </Card>
            <Card title="Sources">
              <Metric label="Social" value={output.sources.social} />
              <Metric
                label="Market index"
                value={output.sources.marketSentimentIndex}
              />
            </Card>
          </div>
          <Card title="Anomalies">
            {output.anomalies.length ? (
              <ul className="list-inside list-disc space-y-1 text-sm">
                {output.anomalies.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No sentiment anomalies detected.
              </p>
            )}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="space-y-1 text-xs font-semibold text-muted-foreground">
      {label}
      <input
        className={fieldClassName}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
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
function Flag({
  label,
  value,
}: {
  label: string;
  value: boolean;
}): React.JSX.Element {
  return <Metric label={label} value={value ? "Detected" : "Not detected"} />;
}
