"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  BrainCircuit,
  CandlestickChart,
  CircleDollarSign,
  Gauge,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WalletCards,
  RefreshCw,
} from "lucide-react";

import { HealthStatus } from "@/components/health-status";
import { MarketResearchReport } from "@/components/dashboard/market-research-report";
import { Card } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "@/lib/i18n/i18n-context";
import {
  usePerformanceDashboard,
  usePipelineDashboard,
  usePipelineRuns,
  usePortfolioDashboard,
  useRiskDashboard,
} from "@/hooks/ai/useAiFeature";
import { useRealtimeLiveTradingDashboard } from "@/hooks/ai/useRealtimeLiveTrading";
import {
  useHomeRecommendations,
  useHomeResearchRuns,
  useHomeSession,
  useHomeSymbolOpportunities,
} from "@/hooks/dashboard/useHomeDashboard";
import { ApiRequestError } from "@/lib/api-client";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const ratioPercent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(2)}%`;

const scorePercent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(2)}%`;

export default function DashboardPage(): React.JSX.Element {
  const router = useRouter();
  const session = useHomeSession();
  const { t } = useTranslation();

  useEffect(() => {
    if (
      session.error instanceof ApiRequestError &&
      session.error.status === 401
    ) {
      router.replace("/login?next=%2F");
    }
  }, [router, session.error]);

  if (session.isLoading) {
    return <DashboardSkeleton label={t.dashboard.sessionVerifying} />;
  }
  if (session.isError) {
    if (
      session.error instanceof ApiRequestError &&
      session.error.status === 401
    ) {
      return <DashboardSkeleton label={t.dashboard.sessionRedirecting} />;
    }
    return (
      <StateMessage
        action={() => void session.refetch()}
        buttonLabel={t.dashboard.retry}
        description={session.error.message}
        title={t.dashboard.sessionCheckFailed}
      />
    );
  }

  return <AuthenticatedDashboard />;
}

function AuthenticatedDashboard(): React.JSX.Element {
  const { t, language } = useTranslation();
  const portfolio = usePortfolioDashboard();
  const risk = useRiskDashboard();
  const live = useRealtimeLiveTradingDashboard();
  const performance = usePerformanceDashboard();
  const pipeline = usePipelineDashboard();
  const runs = usePipelineRuns();
  const recommendations = useHomeRecommendations();
  const opportunities = useHomeSymbolOpportunities();
  const researchRuns = useHomeResearchRuns();

  const portfolioData = portfolio.data;
  const riskData = risk.data;
  const liveData = live.data;
  const metrics = performance.metrics.data;
  const latestRuns = runs.data?.data.slice(0, 5) ?? [];
  const openPositions = liveData?.positions ?? [];
  const recentOrders = liveData?.orders.slice(0, 5) ?? [];
  const totalUnrealizedPnl = openPositions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );
  const equity = portfolioData?.portfolio.equity ?? riskData?.portfolio.equity;
  const pnl = portfolioData
    ? portfolioData.portfolio.realizedPnl + totalUnrealizedPnl
    : undefined;
  const estimatedStartingEquity =
    equity !== undefined && pnl !== undefined ? equity - pnl : undefined;
  const pnlMargin =
    pnl !== undefined &&
    estimatedStartingEquity !== undefined &&
    estimatedStartingEquity > 0
      ? pnl / estimatedStartingEquity
      : undefined;
  const latestDecision = latestRuns.find((run) => run.decision);
  const approvedRisk = riskData?.assessments.filter(
    (item) => item.approved,
  ).length;
  const rejectedRisk = riskData
    ? riskData.assessments.length - (approvedRisk ?? 0)
    : undefined;
  const isLoading =
    portfolio.isLoading || risk.isLoading || live.isLoading || runs.isLoading;

  const alerts = [
    ...(portfolioData && !portfolioData.source.available
      ? [language === "vi" ? "Chưa có snapshot tài khoản sàn hợp lệ." : "No valid exchange account snapshot available."]
      : []),
    ...(portfolioData?.source.stale
      ? [language === "vi" ? "Dữ liệu portfolio đang cũ; cần kiểm tra kết nối và đồng bộ." : "Portfolio data is stale; verify connection sync."]
      : []),
    ...(portfolioData?.portfolio.failsafeActive
      ? [language === "vi" ? "Portfolio failsafe đang bật; lệnh chiến lược mới bị tạm dừng." : "Portfolio failsafe active; new orders paused."]
      : []),
    ...(riskData &&
    riskData.portfolio.drawdownPct >= riskData.config.maxDrawdown * 0.8
      ? [language === "vi" ? "Drawdown đã sử dụng ít nhất 80% giới hạn cho phép." : "Drawdown reached 80% of allowed limit."]
      : []),
    ...(performance.alerts.data?.map((item) => item.message) ?? []),
    ...(pipeline.data && pipeline.data.status !== "HEALTHY"
      ? [language === "vi" ? `Pipeline đang ở trạng thái ${pipeline.data.status}.` : `Pipeline status is ${pipeline.data.status}.`]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header section */}
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400">
            {t.dashboard.overviewSub}
          </p>
          <h1 className="mt-1.5 text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
            {t.dashboard.commandCenterTitle}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t.dashboard.commandCenterDesc}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge
            label={liveData?.mode ?? "UNKNOWN"}
            tone={liveData?.mode === "LIVE" ? "danger" : "info"}
          />
          <StatusBadge
            label={
              liveData?.globalTradingEnabled
                ? t.dashboard.tradingEnabled
                : t.dashboard.tradingPaused
            }
            tone={liveData?.globalTradingEnabled ? "success" : "warning"}
          />
          <StatusBadge
            label={portfolioData?.source.stale ? t.dashboard.dataStale : t.dashboard.dataSynced}
            tone={portfolioData?.source.stale ? "warning" : "success"}
          />
        </div>
      </section>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200 backdrop-blur-xs animate-pulse">
          <RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
          <span>{t.dashboard.loadingData}</span>
        </div>
      )}

      {/* Market Research Report */}
      <MarketResearchReport
        loading={researchRuns.isLoading || opportunities.isLoading}
        opportunities={opportunities.data ?? []}
        runs={researchRuns.data?.data ?? []}
      />

      {/* Top 4 Core Metrics */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={WalletCards}
          label={t.dashboard.totalEquity}
          note={`${portfolioData?.source.environment ?? t.dashboard.noExchange} · ${portfolioData?.source.kind ?? "NO SOURCE"}`}
          value={equity === undefined ? "—" : money.format(equity)}
        />
        <MetricCard
          icon={pnl !== undefined && pnl < 0 ? TrendingDown : TrendingUp}
          label={t.dashboard.exchangePnL}
          note={`${t.dashboard.pnlMargin} ${ratioPercent(pnlMargin)}`}
          tone={
            pnl === undefined ? "neutral" : pnl >= 0 ? "positive" : "negative"
          }
          value={pnl === undefined ? "—" : money.format(pnl)}
        />
        <MetricCard
          icon={Gauge}
          label={t.dashboard.exposureLimit}
          note={`${t.dashboard.maxAllowed} ${ratioPercent(portfolioData?.config.maxTotalExposure)}`}
          value={ratioPercent(portfolioData?.portfolio.exposurePct)}
        />
        <MetricCard
          icon={ShieldCheck}
          label={t.dashboard.drawdownLimit}
          note={`${t.dashboard.maxAllowed} ${ratioPercent(portfolioData?.config.maxDrawdown)}`}
          tone={
            portfolioData &&
            portfolioData.portfolio.drawdownPct >=
              portfolioData.config.maxDrawdown * 0.8
              ? "negative"
              : "neutral"
          }
          value={ratioPercent(portfolioData?.portfolio.drawdownPct)}
        />
      </section>

      {/* Actionable Alerts */}
      {alerts.length > 0 && (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 backdrop-blur-xs">
          <div className="flex items-center gap-2 font-semibold text-amber-200">
            <AlertTriangle className="h-5 w-5" /> {t.dashboard.alertsTitle}
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-amber-100/90">
            {alerts.slice(0, 5).map((alert) => (
              <li className="flex items-start gap-2" key={alert}>
                <span className="text-amber-400">•</span>
                <span>{alert}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Positions & Performance Grid */}
      <section className="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="min-w-0 p-5">
          <SectionHeader
            actionLabel={t.dashboard.viewDetails}
            description={`${openPositions.length} ${language === "vi" ? "vị thế" : "positions"} · Unrealized PnL ${money.format(totalUnrealizedPnl)}`}
            href={ROUTES.liveTrading}
            icon={CandlestickChart}
            title={t.dashboard.aiPositions}
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[580px] text-left text-sm">
              <thead className="border-b border-border/80 text-xs uppercase text-muted-foreground">
                <tr>
                  {[
                    "Symbol",
                    "Side",
                    "Entry / Mark",
                    "Size",
                    "Leverage",
                    "PnL",
                  ].map((item) => (
                    <th className="pb-3 font-semibold" key={item}>
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {openPositions.slice(0, 6).map((position) => (
                  <tr className="hover:bg-muted/40 transition-colors" key={position.id}>
                    <td className="py-3 font-semibold">{position.symbol}</td>
                    <td
                      className={`py-3 font-bold ${position.side === "LONG" ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {position.side}
                    </td>
                    <td className="py-3 font-mono text-xs text-muted-foreground">
                      {position.entryPrice} / {position.markPrice ?? "—"}
                    </td>
                    <td className="py-3 font-mono text-xs">
                      {position.quantity}
                    </td>
                    <td className="py-3 text-xs font-semibold">{position.leverage ?? "—"}×</td>
                    <td
                      className={`py-3 font-semibold ${position.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {money.format(position.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!openPositions.length && (
              <EmptyState text={t.dashboard.noPositions} />
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <SectionHeader
            actionLabel={t.dashboard.viewDetails}
            description={language === "vi" ? "Chỉ số từ các quyết định đã đủ thời gian đánh giá" : "Performance metrics from evaluated AI decisions"}
            href={ROUTES.ai.performance}
            icon={BrainCircuit}
            title={language === "vi" ? "Hiệu suất Quyết định AI" : "AI Decision Performance"}
          />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <CompactMetric
              label="Win rate"
              value={scorePercent(metrics?.winRate)}
            />
            <CompactMetric
              label="Accuracy"
              value={scorePercent(metrics?.accuracy)}
            />
            <CompactMetric
              label={language === "vi" ? "Lợi nhuận TB" : "Avg Return"}
              value={scorePercent(metrics?.averageReturn)}
            />
            <CompactMetric
              label="Max drawdown"
              value={scorePercent(metrics?.maxDrawdown)}
            />
            <CompactMetric
              label={language === "vi" ? "Quyết định có hướng" : "Directional Signals"}
              value={metrics ? String(metrics.directionalDecisions) : "—"}
            />
            <CompactMetric
              label={language === "vi" ? "Tổng đánh giá" : "Evaluated Signals"}
              value={metrics ? String(metrics.total) : "—"}
            />
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {language === "vi"
              ? "Đây là hiệu suất đánh giá tín hiệu AI định lượng, không phải PnL tiền thật. PnL tài khoản sàn được hiển thị riêng ở phía trên."
              : "Reflects theoretical AI signal evaluation metrics. Realized exchange PnL is tracked separately in the financial ledger above."}
          </p>
        </Card>
      </section>

      {/* Decisions & Risk Budgets */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <SectionHeader
            actionLabel={t.dashboard.viewAll}
            description={
              latestDecision
                ? `${latestDecision.symbol} · ${latestDecision.decision} · ${t.dashboard.confidenceScore} ${latestDecision.confidence ?? "—"}`
                : t.dashboard.noDecisions
            }
            href={ROUTES.ai.pipelineRuns}
            icon={Bot}
            title={t.dashboard.agentDecisions}
          />
          <div className="mt-4 space-y-2">
            {latestRuns.map((run) => (
              <div
                className="grid gap-2 rounded-xl border border-border/80 bg-card/60 p-3.5 text-sm transition hover:border-primary/30 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center"
                key={run.id}
              >
                <div>
                  <p className="font-semibold">{run.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}
                  </p>
                </div>
                <DecisionBadge decision={run.decision ?? "—"} />
                <span className="text-xs text-muted-foreground font-mono">
                  {t.dashboard.confidenceScore}: {run.confidence ?? "—"}
                </span>
                <StatusBadge
                  label={run.status}
                  tone={run.status === "COMPLETED" ? "success" : "warning"}
                />
              </div>
            ))}
            {!latestRuns.length && <EmptyState text={t.dashboard.noDecisions} />}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            actionLabel={t.dashboard.viewDetails}
            description={language === "vi" ? "Mức sử dụng hiện tại so với giới hạn an toàn" : "Current utilization vs guardrail thresholds"}
            href={ROUTES.ai.risk}
            icon={ShieldCheck}
            title={t.dashboard.riskGovernance}
          />
          <div className="mt-5 space-y-4">
            <RiskBar
              label="Exposure"
              limit={riskData?.config.maxExposure}
              value={riskData?.portfolio.exposurePct}
            />
            <RiskBar
              label="Drawdown"
              limit={riskData?.config.maxDrawdown}
              value={riskData?.portfolio.drawdownPct}
            />
            <RiskBar
              label={language === "vi" ? "Vị thế mở" : "Open positions"}
              limit={riskData?.config.maxPositions}
              raw
              value={riskData?.portfolio.openPositions}
            />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <CompactMetric
              label={language === "vi" ? "Risk Phê duyệt" : "Risk Approved"}
              value={approvedRisk?.toString() ?? "—"}
            />
            <CompactMetric
              label={language === "vi" ? "Risk Từ chối" : "Risk Rejected"}
              value={rejectedRisk?.toString() ?? "—"}
            />
          </div>
        </Card>
      </section>

      {/* Orders & Recommendations */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionHeader
            actionLabel={t.dashboard.viewDetails}
            description={language === "vi" ? `Đang hiển thị ${recentOrders.length} lệnh gần nhất` : `Displaying latest ${recentOrders.length} orders`}
            href={ROUTES.liveTrading}
            icon={Activity}
            title={t.dashboard.openOrders}
          />
          <div className="mt-4 space-y-2">
            {recentOrders.map((order) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/60 p-3.5 text-sm transition hover:border-primary/30"
                key={order.id}
              >
                <div>
                  <p className="font-semibold">
                    {order.symbol} · <span className={order.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>{order.side}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {order.purpose} ·{" "}
                    {new Date(order.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {order.netPnl !== null && order.netPnl !== undefined && (
                    <span
                      className={`font-mono text-xs font-semibold ${
                        order.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {money.format(order.netPnl)}
                    </span>
                  )}
                  <StatusBadge
                    label={order.status}
                    tone={order.status === "FILLED" ? "success" : "info"}
                  />
                </div>
              </div>
            ))}
            {!recentOrders.length && (
              <EmptyState text={t.dashboard.noOrders} />
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            actionLabel={t.dashboard.viewAll}
            description={language === "vi" ? "Các đề xuất định lượng đang chờ xem xét" : "Quantitative research proposals awaiting review"}
            href={ROUTES.recommendations}
            icon={CircleDollarSign}
            title={t.nav.recommendations}
          />
          <div className="mt-4 space-y-2">
            {recommendations.data?.slice(0, 5).map((item) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/60 p-3.5 text-sm transition hover:border-primary/30"
                key={item.id}
              >
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.moduleSource} · {item.status}
                  </p>
                </div>
                <StatusBadge
                  label={item.priority}
                  tone={item.priority === "HIGH" ? "danger" : "warning"}
                />
              </div>
            ))}
            {!recommendations.data?.length && (
              <EmptyState text={language === "vi" ? "Chưa có khuyến nghị định lượng mới." : "No new recommendations pending."} />
            )}
          </div>
        </Card>
      </section>

      {/* System Health */}
      <HealthStatus />

      {/* Quick Launch Cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t.dashboard.marketAnalysis, href: ROUTES.market },
          { label: t.dashboard.riskManagement, href: ROUTES.ai.risk },
          { label: t.dashboard.strategyPortfolio, href: ROUTES.ai.portfolio },
          { label: t.dashboard.liveTrading, href: ROUTES.liveTrading },
        ].map(({ label, href }) => (
          <Link
            className="group flex items-center justify-between rounded-2xl border border-border/80 bg-card/70 p-4 text-sm font-semibold transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-xs"
            href={href}
            key={href}
          >
            <span className="text-foreground group-hover:text-primary transition-colors">{label}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
          </Link>
        ))}
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  tone = "neutral",
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "positive" | "negative";
}): React.JSX.Element {
  const color =
    tone === "positive"
      ? "text-emerald-400"
      : tone === "negative"
        ? "text-rose-400"
        : "text-foreground";
  return (
    <Card className="p-5 relative overflow-hidden transition-all hover:border-border/80">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className={`mt-3 text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </Card>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  href,
  actionLabel = "Details",
}: {
  icon: typeof Activity;
  title: string;
  description: string;
  href: string;
  actionLabel?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Link
        className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-card/60 px-2.5 py-1 text-xs font-semibold text-primary transition-all hover:border-primary/40 hover:bg-primary/10"
        href={href}
      >
        <span>{actionLabel}</span>
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 p-3 transition-colors hover:border-border">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function RiskBar({
  label,
  value,
  limit,
  raw = false,
}: {
  label: string;
  value?: number;
  limit?: number;
  raw?: boolean;
}) {
  const usage =
    value !== undefined && limit !== undefined && limit > 0
      ? Math.min(1, value / limit)
      : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="font-semibold font-mono">
          {value === undefined
            ? "—"
            : raw
              ? `${value} / ${limit ?? "—"}`
              : `${ratioPercent(value)} / ${ratioPercent(limit)}`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/80">
        <div
          className={`h-full rounded-full transition-all ${
            usage >= 0.8 ? "bg-rose-400" : usage >= 0.6 ? "bg-amber-400" : "bg-emerald-400"
          }`}
          style={{ width: `${usage * 100}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "info";
}) {
  const styles = {
    success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    danger: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  };
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const tone =
    decision === "LONG"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400"
      : decision === "SHORT"
        ? "border-rose-400/30 bg-rose-400/10 text-rose-400"
        : "border-amber-400/30 bg-amber-400/10 text-amber-300";
  return (
    <span className={`rounded-lg border px-2 py-0.5 text-xs font-bold ${tone}`}>
      {decision}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="py-8 text-center text-xs text-muted-foreground">{text}</p>
  );
}

function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
        <RefreshCw className="h-4 w-4 animate-spin text-primary" />
        <span>{label}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-border bg-card/60"
            key={index}
          />
        ))}
      </div>
    </div>
  );
}

function StateMessage({
  title,
  description,
  action,
  buttonLabel = "Try Again",
}: {
  title: string;
  description: string;
  action: () => void;
  buttonLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-rose-400/30 bg-rose-400/10 p-6 text-center">
      <h1 className="font-semibold text-rose-200">{title}</h1>
      <p className="mt-2 text-sm text-rose-100/80">{description}</p>
      <button
        className="mt-4 rounded-xl border border-rose-300/30 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/30"
        onClick={action}
        type="button"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

