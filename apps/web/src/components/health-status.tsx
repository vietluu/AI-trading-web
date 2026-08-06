"use client";

import { Activity, Database, RefreshCw, Server } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHealthStatus } from "@/hooks/health/useHealthStatus";
import { useTranslation } from "@/lib/i18n/i18n-context";

function StatusDot({ isUp }: { isUp: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`h-2.5 w-2.5 rounded-full ${
        isUp ? "bg-emerald-400 shadow-status-up" : "bg-rose-400"
      }`}
    />
  );
}

export function HealthStatus(): React.JSX.Element {
  const { t } = useTranslation();
  const healthQuery = useHealthStatus();

  if (healthQuery.isPending) {
    return (
      <Card aria-live="polite">
        <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 animate-pulse-soft" />
          {t.common.loading}
        </CardContent>
      </Card>
    );
  }

  if (healthQuery.isError) {
    return (
      <Card className="border-rose-500/30" role="alert">
        <CardHeader>
          <CardTitle className="text-rose-300">
            {t.health.title} ({t.health.degraded})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {healthQuery.error.message}
          </p>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-white/5"
            onClick={() => void healthQuery.refetch()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const { services, timestamp } = healthQuery.data;
  const serviceRows = [
    { label: t.health.postgres, icon: Database, health: services.database },
    { label: t.health.redis, icon: Server, health: services.redis },
  ];

  return (
    <Card aria-live="polite">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {t.health.systemConnections}
          </p>
          <CardTitle className="mt-2 text-xl">{t.health.title}</CardTitle>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          <StatusDot isUp />
          {t.health.allHealthy}
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {serviceRows.map(({ label, icon: Icon, health }) => (
            <div
              className="flex items-center justify-between rounded-xl border border-border bg-white/[0.02] p-4"
              key={label}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{label}</span>
              </div>
              <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <StatusDot isUp={health.status === "up"} />
                {health.latencyMs} ms
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-right font-mono text-[11px] text-muted-foreground">
          Updated {new Date(timestamp).toLocaleTimeString()}
        </p>
      </CardContent>
    </Card>
  );
}
