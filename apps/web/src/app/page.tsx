import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  CandlestickChart,
  ShieldCheck,
} from "lucide-react";

import { HealthStatus } from "@/components/health-status";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardPage(): React.JSX.Element {
  return (
    <div className="space-y-8">
      <section className="grid gap-8 py-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
            Research operations
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-[-0.035em] sm:text-5xl">
            A dependable base for evidence-led futures research.
          </h1>
        </div>
        <p className="max-w-xl text-sm leading-7 text-muted-foreground lg:pb-1">
          The application shell, typed API boundary, PostgreSQL, and Redis are
          ready. Market intelligence, agents, and exchange-backed execution
          arrive in their dedicated roadmap phases.
        </p>
      </section>

      <HealthStatus />

      <Link
        className="group flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5 transition hover:border-emerald-300/40 hover:bg-emerald-400/15"
        href="/market"
      >
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
            <CandlestickChart className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">Open realtime market dashboard</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Charts, stream health, indicators, funding and open interest.
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
              <h2 className="font-semibold">Agent pipeline</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Specialized research agents, the Decision Agent, and the Judge
                Agent are intentionally reserved for Phase 6.
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
              <h2 className="font-semibold">Risk before execution</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                No AI output can place an order. Future execution will remain
                gated by the deterministic Risk Engine.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5" />
        Dashboard features remain placeholders until their owning phase.
      </div>
    </div>
  );
}
