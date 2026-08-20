"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import {
  usePipelineActions,
  usePipelineDashboard,
  usePipelineSchedules,
} from "@/hooks/ai/useAiFeature";
import { useTranslation } from "@/lib/i18n/i18n-context";

import { useConfiguredTradingScope } from "@/hooks/useConfiguredTradingScope";
import { useExchangeSymbols } from "@/hooks/useExchangeSymbols";

export default function PipelinePage() {
  const { t } = useTranslation();
  const scope = useConfiguredTradingScope();
  const [provider, setProvider] = useState("OKX_FUTURES");
  const exchangeSymbols = useExchangeSymbols(provider);
  const [symbolSearch, setSymbolSearch] = useState("");
  
  const availableSymbols = useMemo(() => {
    const configured = scope.data?.symbols ?? [];
    const fromExchange = exchangeSymbols.symbols;
    const combined = Array.from(new Set([...configured, ...fromExchange]));
    if (!symbolSearch.trim()) return combined;
    const query = symbolSearch.trim().toUpperCase();
    return combined.filter((s) => s.toUpperCase().includes(query));
  }, [scope.data?.symbols, exchangeSymbols.symbols, symbolSearch]);

  const [symbol, setSymbol] = useState("");
  const [message, setMessage] = useState("");
  const health = usePipelineDashboard();
  const schedules = usePipelineSchedules();
  const { runMutation, createScheduleMutation, cancelScheduleMutation } = usePipelineActions();
  useEffect(() => {
    if ((!symbol || !availableSymbols.includes(symbol)) && availableSymbols[0]) {
      setSymbol(availableSymbols[0]);
    }
  }, [availableSymbols, symbol]);
  async function run() {
    if (!symbol) return setMessage('NO_SYMBOLS_SELECTED');
    try {
      const result = await runMutation.mutateAsync({
        symbol,
        provider,
        pipelineId: "FULL_ANALYSIS_DECISION",
        params: {},
      });
      setMessage(`Run ${result.id.slice(0, 8)} ${t.ai.runQueued} (${result.status}).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.ai.triggerFailed);
    }
  }

  async function addSchedule(intervalMinutes = 15, targetSymbols?: string[]) {
    const symbolsToSchedule = targetSymbols ?? [symbol];
    try {
      await createScheduleMutation.mutateAsync({
        pipelineId: "FULL_ANALYSIS_DECISION",
        symbols: symbolsToSchedule,
        provider,
        mode: "INTERVAL",
        intervalMs: intervalMinutes * 60_000,
        enabled: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        maxRunsPerHour: 60,
      });
      setMessage(
        `Schedule created: ${intervalMinutes} min interval for ${symbolsToSchedule.join(", ")}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.ai.scheduleFailed);
    }
  }

  async function cancelSchedule(id: string) {
    try {
      await cancelScheduleMutation.mutateAsync(id);
      setMessage("Schedule cancelled.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t.ai.cancellationFailed,
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.ai.pipelineTitle}</h1>
          <p className="mt-1 text-muted-foreground">{t.ai.pipelineSubtitle}</p>
        </div>
        <Link
          className="text-nowrap rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          href={ROUTES.ai.pipelineRuns}
        >
          {t.ai.runHistory}
        </Link>
      </div>
      <section className="grid gap-4 md:grid-cols-4">
        {[
          [t.ai.system, health.data?.status ?? t.ai.loadingStatus],
          [
            t.ai.scheduler,
            health.data?.scheduler.enabled ? t.ai.enabled : t.ai.disabled,
          ],
          [t.ai.queueDepth, String(health.data?.queueDepth ?? "—")],
          [t.ai.failureStreak, String(health.data?.failureStreak ?? "—")],
        ].map(([label, value]) => (
          <div className="rounded-lg border bg-card p-4" key={label}>
            <p className="text-xs uppercase text-muted-foreground">{label}</p>
            <p className="mt-2 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">{t.ai.manualTriggerTitle}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            className="w-32 rounded border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
            placeholder="Search..."
            value={symbolSearch}
            onChange={(e) => setSymbolSearch(e.target.value)}
          />
          <select
            className="min-w-40 flex-1 rounded border bg-background px-3 py-2 sm:flex-none"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {!symbol && <option value="">{t.ai.symbol}</option>}
            {availableSymbols.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select
            className="min-w-36 flex-1 rounded border bg-background px-3 py-2 sm:flex-none"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="OKX_FUTURES">OKX Futures</option>
            <option value="BINANCE_FUTURES">Binance Futures</option>
          </select>
          <button
            className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
            disabled={!symbol}
            onClick={() => void run()}
            type="button"
          >
            {t.ai.runAnalysisNow}
          </button>
          <button
            className="rounded border border-border px-4 py-2 font-medium hover:bg-muted"
            disabled={!symbol || (schedules.data?.length ?? 0) >= 10}
            onClick={() => void addSchedule(15)}
            type="button"
          >
            {t.ai.schedule15m} ({symbol})
          </button>
        </div>
        {message && (
          <p className="mt-3 text-sm font-medium text-emerald-400">{message}</p>
        )}
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold"> {t.ai.activeSchedules}{' '}({schedules.data?.length ?? 0}/10)</h2>
        <div className="mt-3 space-y-2">
          {schedules.data?.length ? (
            schedules.data.map((item) => (
              <div
                className="flex flex-col gap-3 rounded border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                key={item.id}
              >
                <div>
                  <p className="font-medium">
                    {item.symbols.join(", ")} · {item.provider}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.enabled ? t.ai.enabled : t.ai.disabled} ·{" "}
                    {item.mode === "CRON"
                      ? item.cron
                      : `${(item.intervalMs ?? 0) / 60000} min interval`}
                  </p>
                </div>
                <button
                  className="self-start rounded border border-red-500/50 px-3 py-2 text-red-400 hover:bg-red-500/10 sm:self-auto"
                  onClick={() => void cancelSchedule(item.id)}
                  type="button"
                >
                  {t.ai.cancelSchedule}
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.ai.noSchedules}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
