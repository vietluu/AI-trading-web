"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { NewsAgentOutput, NewsSentimentInput } from "@platform/shared";
import { apiRequest } from "@/lib/api-client";

interface NewsAnalysisRun {
  id: string;
  status: string;
  output?: NewsAgentOutput;
}

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function NewsAnalysisPage(): React.JSX.Element {
  const [symbol, setSymbol] = useState<NewsSentimentInput["symbol"]>("BTC");
  const [lookbackHours, setLookbackHours] = useState(6);
  const [maxItems, setMaxItems] = useState(20);
  const analysis = useMutation<NewsAnalysisRun, Error>({
    mutationFn: () =>
      apiRequest<NewsAnalysisRun>("/agents/NEWS_ANALYST/runs", {
        method: "POST",
        body: JSON.stringify({ input: { symbol, lookbackHours, maxItems } }),
      }),
  });
  const output = analysis.data?.output;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">News Analysis</h1>
        <p className="mt-1 text-muted-foreground">
          Evidence-based news impact and narrative research. No trading advice
          or execution.
        </p>
      </header>
      <AnalysisForm
        symbol={symbol}
        lookbackHours={lookbackHours}
        maxItems={maxItems}
        pending={analysis.isPending}
        error={analysis.error}
        onSymbol={setSymbol}
        onLookback={setLookbackHours}
        onMaxItems={setMaxItems}
        onRun={() => analysis.mutate()}
      />
      {output ? (
        <section className="space-y-4" aria-label="News analysis result">
          <Summary summary={output.summary} quality={output.dataQuality} />
          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Impact">
              <Metric label="Level" value={output.impact.level} />
              <Metric label="Direction" value={output.impact.direction} />
            </Card>
            <Card title="Themes">
              <Tags items={output.themes} empty="No themes detected." />
            </Card>
            <Card title="Risk signals">
              <Tags
                items={output.riskSignals}
                empty="No risk signals detected."
              />
            </Card>
          </div>
          <Card title="Key events">
            {output.keyEvents.length ? (
              <div className="space-y-3">
                {output.keyEvents.map((event, index) => (
                  <div
                    className="rounded-md border p-3 text-sm"
                    key={`${event.title}-${index}`}
                  >
                    <p className="font-medium">{event.title}</p>
                    <p className="mt-1 text-muted-foreground">
                      {event.impact} · Importance {event.importance}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No qualifying recent events.
              </p>
            )}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function AnalysisForm(props: {
  symbol: NewsSentimentInput["symbol"];
  lookbackHours: number;
  maxItems: number;
  pending: boolean;
  error: Error | null;
  onSymbol: (value: NewsSentimentInput["symbol"]) => void;
  onLookback: (value: number) => void;
  onMaxItems: (value: number) => void;
  onRun: () => void;
}): React.JSX.Element {
  const invalid =
    props.lookbackHours < 1 ||
    props.lookbackHours > 24 ||
    props.maxItems < 1 ||
    props.maxItems > 50;
  return (
    <section className="grid gap-4 rounded-lg border bg-card p-6 md:grid-cols-3">
      <label className="space-y-1 text-xs font-semibold text-muted-foreground">
        Symbol
        <select
          className={fieldClassName}
          value={props.symbol}
          onChange={(event) =>
            props.onSymbol(event.target.value as NewsSentimentInput["symbol"])
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
        value={props.lookbackHours}
        onChange={props.onLookback}
      />
      <NumberField
        label="Maximum items"
        min={1}
        max={50}
        value={props.maxItems}
        onChange={props.onMaxItems}
      />
      <button
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-3"
        disabled={props.pending || invalid}
        onClick={props.onRun}
        type="button"
      >
        {props.pending ? "Analyzing recent news…" : "Run news analysis"}
      </button>
      {props.error ? (
        <p className="text-sm text-red-500 md:col-span-3" role="alert">
          {props.error.message}
        </p>
      ) : null}
    </section>
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

function Summary({
  summary,
  quality,
}: {
  summary: string;
  quality: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Summary</h2>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
          Data quality: {quality}
        </span>
      </div>
      <p className="text-sm leading-6">{summary}</p>
    </div>
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
  value: string;
}): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

function Tags({
  items,
  empty,
}: {
  items: string[];
  empty: string;
}): React.JSX.Element {
  return items.length ? (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span className="rounded-full bg-muted px-2 py-1 text-xs" key={item}>
          {item}
        </span>
      ))}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">{empty}</p>
  );
}
