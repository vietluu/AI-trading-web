"use client";

import { useEffect, useMemo, useState } from "react";
import type { FusionRunInput } from "@platform/shared";
import { useDecisionRunner } from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

import { useConfiguredTradingScope } from "@/hooks/useConfiguredTradingScope";
import { useExchangeSymbols } from "@/hooks/useExchangeSymbols";

const fieldClassName =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default function DecisionPage(): React.JSX.Element {
  const { t } = useTranslation();
  const scope = useConfiguredTradingScope();
  const [provider, setProvider] =
    useState<FusionRunInput["provider"]>("OKX_FUTURES");
  const exchangeSymbols = useExchangeSymbols(provider);
  const availableSymbols = useMemo(() => {
    const configured = scope.data?.symbols ?? [];
    return Array.from(new Set([...configured, ...exchangeSymbols.symbols]));
  }, [scope.data?.symbols, exchangeSymbols.symbols]);
  const [symbol, setSymbol] = useState<string>("");
  const [interval, setInterval] = useState<FusionRunInput["interval"]>("15m");
  useEffect(() => {
    if ((!symbol || !availableSymbols.includes(symbol)) && availableSymbols[0]) {
      setSymbol(availableSymbols[0]);
    }
    const preferred = scope.data?.timeframes[0] as FusionRunInput['interval'] | undefined;
    if (preferred) setInterval(preferred);
  }, [availableSymbols, scope.data?.timeframes, symbol]);

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
            {!symbol && <option value="">{t.ai.symbol}</option>}
            {availableSymbols.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.exchange}
          <select className={fieldClassName} value={provider} onChange={(event) => setProvider(event.target.value as FusionRunInput["provider"])}>
            <option value="OKX_FUTURES">OKX Futures</option>
            <option value="BINANCE_FUTURES">Binance Futures</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          {t.ai.interval}
          <select className={fieldClassName} value={interval} onChange={(event) => setInterval(event.target.value as FusionRunInput["interval"])}>
            {(["1m", "5m", "15m", "1h"] as const).map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-3" disabled={!symbol || decision.isPending} onClick={() => decision.mutate(decisionInput)} type="button">
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
                <Metric label={t.ai.confidence} value={`${output.confidence} / 100`} />
                {output.confidenceCalibration?.status === "CALIBRATED" ? (
                  <>
                    <Metric
                      label={t.ai.calibratedProbability}
                      value={`${Math.round((output.confidenceCalibration.empiricalProbability ?? 0) * 100)}%`}
                    />
                    <Metric
                      label={t.ai.brierScore}
                      value={(output.confidenceCalibration.brierScore ?? 0).toFixed(3)}
                    />
                  </>
                ) : null}
                <Metric label={t.ai.agreement} value={`${output.agreementScore}%`} />
                <Metric label={t.ai.data} value={output.dataQuality} />
                <Metric label={t.ai.regime} value={output.regime.detailed ?? output.regime.type} />
                <Metric label={t.ai.conflict} value={output.conflictLevel} />
              </div>
            </div>
            {output.regime.playbook ? (
              <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{t.ai.playbookTitle}: </span>
                {output.regime.playbook}
              </div>
            ) : null}
            <p className="mt-5 text-sm leading-6">{output.reasoning}</p>
          </div>

          {output.scenarios && output.scenarios.length > 0 ? (
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <h2 className="font-semibold text-base flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                {t.ai.multiScenarioTitle}
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                {output.scenarios.map((scenario) => {
                  const isPrimary = scenario.type === "PRIMARY";
                  const isInvalidation = scenario.type === "INVALIDATION";
                  const borderColor = isPrimary
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : isInvalidation
                      ? "border-red-500/30 bg-red-500/5"
                      : "border-amber-500/30 bg-amber-500/5";
                  const tagColor = isPrimary
                    ? "text-emerald-400 bg-emerald-500/10"
                    : isInvalidation
                      ? "text-red-400 bg-red-500/10"
                      : "text-amber-400 bg-amber-500/10";
                  const title = isPrimary
                    ? t.ai.primaryPlan
                    : isInvalidation
                      ? t.ai.invalidationTrigger
                      : t.ai.contingencyPlan;

                  return (
                    <div key={scenario.id} className={`rounded-lg border p-4 flex flex-col justify-between space-y-3 ${borderColor}`}>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${tagColor}`}>
                            {scenario.direction}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">
                            {t.ai.probabilityLabel}: {Math.round(scenario.probability * 100)}%
                          </span>
                        </div>
                        <h3 className="font-medium text-sm">{title}</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">{scenario.rationale}</p>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-border/50 text-xs">
                        <div>
                          <span className="text-muted-foreground">{t.ai.triggerLabel}: </span>
                          <span className="font-medium">{scenario.triggerCondition}</span>
                        </div>
                        {scenario.priceTarget !== undefined ? (
                          <div>
                            <span className="text-muted-foreground">{t.ai.targetLabel}: </span>
                            <span className="font-mono font-semibold text-emerald-400">${scenario.priceTarget}</span>
                          </div>
                        ) : null}
                        {scenario.invalidationPrice !== undefined ? (
                          <div>
                            <span className="text-muted-foreground">{t.ai.invalidationLabel}: </span>
                            <span className="font-mono font-semibold text-red-400">${scenario.invalidationPrice}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {output.anticipatorySignals ? (
            <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
                  <h2 className="font-semibold text-sm tracking-wide text-purple-300">
                    {t.ai.anticipatorySignalsTitle}
                  </h2>
                </div>
                <span className="text-xs font-mono text-purple-400/80 uppercase">Pre-Breakout Engine</span>
              </div>
              <div className="grid gap-3 md:grid-cols-3 text-xs">
                {output.anticipatorySignals.squeeze ? (
                  <div className="rounded border border-border/60 bg-background/60 p-3 space-y-1">
                    <div className="font-semibold flex items-center justify-between">
                      <span>{t.ai.volatilitySqueeze}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${output.anticipatorySignals.squeeze.active ? 'bg-amber-500/20 text-amber-300' : 'bg-muted text-muted-foreground'}`}>
                        {output.anticipatorySignals.squeeze.active ? 'SQUEEZE ACTIVE' : 'RELEASED'}
                      </span>
                    </div>
                    <p className="text-muted-foreground">Breakout Prob: <span className="font-mono text-foreground font-semibold">{output.anticipatorySignals.squeeze.breakoutProbability}%</span> ({output.anticipatorySignals.squeeze.breakoutBias})</p>
                    <p className="text-muted-foreground">Intensity: <span className="font-mono">{output.anticipatorySignals.squeeze.intensity}%</span> | Duration: <span className="font-mono">{output.anticipatorySignals.squeeze.duration} bars</span></p>
                  </div>
                ) : null}

                {output.anticipatorySignals.liquiditySweep ? (
                  <div className="rounded border border-border/60 bg-background/60 p-3 space-y-1">
                    <div className="font-semibold flex items-center justify-between">
                      <span>{t.ai.liquiditySweep}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${output.anticipatorySignals.liquiditySweep.detected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                        {output.anticipatorySignals.liquiditySweep.detected ? 'SWEEP DETECTED' : 'NONE'}
                      </span>
                    </div>
                    <p className="text-muted-foreground">Direction: <span className="font-semibold text-foreground">{output.anticipatorySignals.liquiditySweep.direction ?? 'N/A'}</span></p>
                    <p className="text-muted-foreground">Confidence: <span className="font-mono font-semibold">{output.anticipatorySignals.liquiditySweep.confidence}%</span></p>
                  </div>
                ) : null}

                {output.anticipatorySignals.derivativesImbalance ? (
                  <div className="rounded border border-border/60 bg-background/60 p-3 space-y-1">
                    <div className="font-semibold flex items-center justify-between">
                      <span>{t.ai.derivativesImbalance}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${output.anticipatorySignals.derivativesImbalance.squeezeDirection !== 'NONE' ? 'bg-red-500/20 text-red-300' : 'bg-muted text-muted-foreground'}`}>
                        {output.anticipatorySignals.derivativesImbalance.squeezeDirection}
                      </span>
                    </div>
                    <p className="text-muted-foreground">Squeeze Prob: <span className="font-mono text-foreground font-semibold">{output.anticipatorySignals.derivativesImbalance.squeezeProbability}%</span></p>
                    <p className="text-muted-foreground">Funding: <span className="font-semibold">{output.anticipatorySignals.derivativesImbalance.fundingExtreme}</span></p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {output.reflection ? (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  <h2 className="font-semibold text-sm tracking-wide text-cyan-300">
                    {t.ai.llmReflectionTitle}
                  </h2>
                </div>
                <div className="flex items-center space-x-2 text-xs">
                  <span className="text-muted-foreground">{t.ai.trapProbability}:</span>
                  <span className={`font-mono font-bold px-2 py-0.5 rounded ${output.reflection.trapProbability > 50 ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                    {output.reflection.trapProbability}%
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed italic bg-background/50 p-3 rounded border border-border/40">
                "{output.reflection.reasoning}"
              </p>

              {output.reflection.contrarianArguments && output.reflection.contrarianArguments.length ? (
                <div className="space-y-1.5 pt-1">
                  <h3 className="text-xs font-semibold text-cyan-200">{t.ai.contrarianArguments}:</h3>
                  <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                    {output.reflection.contrarianArguments.map((arg, idx) => (
                      <li key={idx}>{arg}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {output.reflection.overrideReason ? (
                <div className="rounded bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-300">
                  <span className="font-bold">Override: </span>{output.reflection.overrideReason}
                </div>
              ) : null}
            </div>
          ) : null}

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
