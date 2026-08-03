"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";

interface Schedule {
  id: string;
  symbols: string[];
  provider: string;
  mode: string;
  cron?: string;
  intervalMs?: number;
  enabled: boolean;
  timezone: string;
}
interface Health {
  status: string;
  queueDepth: number;
  failureStreak: number;
  lastSuccessfulRun?: string;
  scheduler: { enabled: boolean; running: boolean };
}

export default function PipelinePage() {
  const client = useQueryClient();
  const [symbol, setSymbol] = useState("BTC-USDT");
  const [provider, setProvider] = useState("BINANCE_FUTURES");
  const [message, setMessage] = useState("");
  const health = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: () => apiRequest<Health>("/system/pipeline/health"),
    refetchInterval: 10_000,
  });
  const schedules = useQuery({
    queryKey: ["pipeline-schedules"],
    queryFn: () => apiRequest<Schedule[]>("/pipeline/schedules"),
  });
  async function run() {
    try {
      const result = await apiRequest<{ id: string; status: string }>(
        "/pipeline/run",
        {
          method: "POST",
          body: JSON.stringify({
            symbol,
            provider,
            pipelineId: "FULL_ANALYSIS_DECISION",
            params: {},
          }),
        },
      );
      setMessage(`Run ${result.id.slice(0, 8)} queued (${result.status}).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Trigger failed");
    }
  }
  async function addSchedule() {
    try {
      await apiRequest("/pipeline/schedules", {
        method: "POST",
        body: JSON.stringify({
          pipelineId: "FULL_ANALYSIS_DECISION",
          symbols: [symbol],
          provider,
          mode: "INTERVAL",
          intervalMs: 300000,
          enabled: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          maxRunsPerHour: 12,
        }),
      });
      await client.invalidateQueries({ queryKey: ["pipeline-schedules"] });
      setMessage("5-minute schedule created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schedule failed");
    }
  }
  async function cancelSchedule(id: string) {
    try {
      await apiRequest(`/pipeline/schedules/${id}`, { method: "DELETE" });
      await client.invalidateQueries({ queryKey: ["pipeline-schedules"] });
      setMessage("Schedule cancelled.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Cancellation failed",
      );
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pipeline automation</h1>
          <p className="mt-1 text-muted-foreground">
            Automated research and decision generation. Trading execution
            remains disabled.
          </p>
        </div>
        <Link className="text-primary hover:underline" href="/ai/pipeline-runs">
          Run history →
        </Link>
      </div>
      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["System", health.data?.status ?? "Loading"],
          [
            "Scheduler",
            health.data?.scheduler.enabled ? "Enabled" : "Disabled",
          ],
          ["Queue depth", String(health.data?.queueDepth ?? "—")],
          ["Failure streak", String(health.data?.failureStreak ?? "—")],
        ].map(([label, value]) => (
          <div className="rounded-lg border bg-card p-4" key={label}>
            <p className="text-xs uppercase text-muted-foreground">{label}</p>
            <p className="mt-2 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </section>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">Manual trigger</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <select
            className="min-w-0 flex-1 rounded border bg-background px-3 py-2 sm:flex-none"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            <option>BTC-USDT</option>
            <option>ETH-USDT</option>
          </select>
          <select
            className="min-w-0 flex-1 rounded border bg-background px-3 py-2 sm:flex-none"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option>BINANCE_FUTURES</option>
            <option>OKX_FUTURES</option>
          </select>
          <button
            className="rounded bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => void run()}
          >
            Run analysis
          </button>
          <button
            className="rounded border px-4 py-2"
            onClick={() => void addSchedule()}
          >
            Schedule every 5 minutes
          </button>
        </div>
        {message && (
          <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        )}
      </section>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">Schedules</h2>
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
                    {item.enabled ? "Enabled" : "Disabled"} ·{" "}
                    {item.mode === "CRON"
                      ? item.cron
                      : `${(item.intervalMs ?? 0) / 60000} min`}
                  </p>
                </div>
                <button
                  className="self-start rounded border border-red-500/50 px-3 py-2 text-red-400 hover:bg-red-500/10 sm:self-auto"
                  onClick={() => void cancelSchedule(item.id)}
                >
                  Cancel schedule
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No schedules configured.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
