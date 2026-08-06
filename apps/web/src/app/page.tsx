"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  CandlestickChart,
  ShieldCheck,
} from "lucide-react";

import { HealthStatus } from "@/components/health-status";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";

interface DashboardRecommendation {
  id: string;
  title: string;
  priority: string;
  status: string;
  moduleSource: string;
}

export default function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [recommendations, setRecommendations] = useState<DashboardRecommendation[]>([]);

  useEffect(() => {
    let active = true;
    void apiRequest<DashboardRecommendation[]>("/quant-intelligence/recommendations")
      .then((data) => {
        if (active) setRecommendations(data.slice(0, 3));
      })
      .catch(() => {
        if (active) setRecommendations([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <section className="grid gap-8 py-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
            {t.dashboard.badge}
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-[-0.035em] sm:text-5xl">
            {t.dashboard.heroTitle}
          </h1>
        </div>
        <p className="max-w-xl text-sm leading-7 text-muted-foreground lg:pb-1">
          {t.dashboard.heroDesc}
        </p>
      </section>

      <HealthStatus />

      <Link
        className="group flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5 transition hover:border-emerald-300/40 hover:bg-emerald-400/15"
        href={ROUTES.market}
      >
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
            <CandlestickChart className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{t.dashboard.openMarket}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.dashboard.openMarketDesc}
            </p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 text-emerald-300 transition group-hover:translate-x-1" />
      </Link>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="flex gap-4 pt-6">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">{t.dashboard.agentPipelineTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t.dashboard.agentPipelineDesc}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex gap-4 pt-6">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">{t.dashboard.riskTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t.dashboard.riskDesc}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Live recommendations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pending quant recommendations are now surfaced directly on the main dashboard.
            </p>
          </div>
          <Link className="text-sm font-semibold text-primary" href={ROUTES.recommendations}>
            View all
          </Link>
        </div>
        <div className="mt-4 space-y-2">
          {recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending recommendations yet.</p>
          ) : (
            recommendations.map((recommendation) => (
              <div key={recommendation.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">{recommendation.title}</p>
                  <p className="text-xs text-muted-foreground">{recommendation.moduleSource}</p>
                </div>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-500">
                  {recommendation.priority}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5" />
        {t.dashboard.footerNotice}
      </div>
    </div>
  );
}
