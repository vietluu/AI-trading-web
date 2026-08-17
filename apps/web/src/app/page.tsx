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
} from "lucide-react";

import { HealthStatus } from "@/components/health-status";
import { MarketResearchReport } from "@/components/dashboard/market-research-report";
import { Card } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import {
  useLiveTradingDashboard,
  usePerformanceDashboard,
  usePipelineDashboard,
  usePipelineRuns,
  usePortfolioDashboard,
  useRiskDashboard,
} from "@/hooks/ai/useAiFeature";
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

  useEffect(() => {
    if (
      session.error instanceof ApiRequestError &&
      session.error.status === 401
    ) {
      router.replace("/login?next=%2F");
    }
  }, [router, session.error]);

  if (session.isLoading) {
    return <DashboardSkeleton label="Đang xác thực phiên đăng nhập…" />;
  }
  if (session.isError) {
    if (
      session.error instanceof ApiRequestError &&
      session.error.status === 401
    ) {
      return <DashboardSkeleton label="Đang chuyển đến trang đăng nhập…" />;
    }
    return (
      <StateMessage
        title="Không thể kiểm tra phiên đăng nhập"
        description={session.error.message}
        action={() => void session.refetch()}
      />
    );
  }

  return <AuthenticatedDashboard />;
}

function AuthenticatedDashboard(): React.JSX.Element {
  const portfolio = usePortfolioDashboard();
  const risk = useRiskDashboard();
  const live = useLiveTradingDashboard();
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
  const pnl = portfolioData?.portfolio.pnl;
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
      ? ["Chưa có snapshot tài khoản sàn hợp lệ."]
      : []),
    ...(portfolioData?.source.stale
      ? ["Dữ liệu portfolio đang cũ; cần kiểm tra kết nối và đồng bộ."]
      : []),
    ...(portfolioData?.portfolio.failsafeActive
      ? ["Portfolio failsafe đang bật; lệnh chiến lược mới bị tạm dừng."]
      : []),
    ...(riskData &&
    riskData.portfolio.drawdownPct >= riskData.config.maxDrawdown * 0.8
      ? ["Drawdown đã sử dụng ít nhất 80% giới hạn cho phép."]
      : []),
    ...(performance.alerts.data?.map((item) => item.message) ?? []),
    ...(pipeline.data && pipeline.data.status !== "HEALTHY"
      ? [`Pipeline đang ở trạng thái ${pipeline.data.status}.`]
      : []),
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
            Tổng quan đầu tư và AI Trading
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Trading Command Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Tổng hợp tài khoản sàn, rủi ro, vị thế, quyết định AI và hiệu suất
            đã đánh giá. Số liệu không có nguồn thật sẽ hiển thị “—”, không được
            nội suy thành lợi nhuận.
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
                ? "TRADING ENABLED"
                : "TRADING PAUSED"
            }
            tone={liveData?.globalTradingEnabled ? "success" : "warning"}
          />
          <StatusBadge
            label={portfolioData?.source.stale ? "DATA STALE" : "DATA SYNCED"}
            tone={portfolioData?.source.stale ? "warning" : "success"}
          />
        </div>
      </section>

      {isLoading && (
        <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
          Đang tải dữ liệu tài khoản và AI mới nhất…
        </div>
      )}

      <MarketResearchReport
        loading={researchRuns.isLoading || opportunities.isLoading}
        opportunities={opportunities.data ?? []}
        runs={researchRuns.data?.data ?? []}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={WalletCards}
          label="Tổng equity"
          value={equity === undefined ? "—" : money.format(equity)}
          note={`${portfolioData?.source.environment ?? "Chưa có sàn"} · ${portfolioData?.source.kind ?? "NO SOURCE"}`}
        />
        <MetricCard
          icon={pnl !== undefined && pnl < 0 ? TrendingDown : TrendingUp}
          label="PnL tài khoản sàn"
          value={pnl === undefined ? "—" : money.format(pnl)}
          note={`Biên PnL ${ratioPercent(pnlMargin)}`}
          tone={
            pnl === undefined ? "neutral" : pnl >= 0 ? "positive" : "negative"
          }
        />
        <MetricCard
          icon={Gauge}
          label="Exposure / giới hạn"
          value={ratioPercent(portfolioData?.portfolio.exposurePct)}
          note={`Tối đa ${ratioPercent(portfolioData?.config.maxTotalExposure)}`}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Drawdown / giới hạn"
          value={ratioPercent(portfolioData?.portfolio.drawdownPct)}
          note={`Tối đa ${ratioPercent(portfolioData?.config.maxDrawdown)}`}
          tone={
            portfolioData &&
            portfolioData.portfolio.drawdownPct >=
              portfolioData.config.maxDrawdown * 0.8
              ? "negative"
              : "neutral"
          }
        />
      </section>

      {alerts.length > 0 && (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5">
          <div className="flex items-center gap-2 font-semibold text-amber-200">
            <AlertTriangle className="h-5 w-5" /> Cảnh báo cần chú ý
          </div>
          <ul className="mt-3 space-y-2 text-sm text-amber-100/90">
            {alerts.slice(0, 5).map((alert) => (
              <li key={alert}>• {alert}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="min-w-0 p-5">
          <SectionHeader
            icon={CandlestickChart}
            title="Vị thế AI đang quản lý"
            description={`${openPositions.length} vị thế · Unrealized PnL ${money.format(totalUnrealizedPnl)}`}
            href={ROUTES.ai.liveTrading}
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  {[
                    "Symbol",
                    "Side",
                    "Entry / Mark",
                    "Size",
                    "Leverage",
                    "PnL",
                  ].map((item) => (
                    <th className="pb-3 font-medium" key={item}>
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {openPositions.slice(0, 6).map((position) => (
                  <tr key={position.id}>
                    <td className="py-3 font-semibold">{position.symbol}</td>
                    <td
                      className={`py-3 font-semibold ${position.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {position.side}
                    </td>
                    <td className="py-3 font-mono text-xs">
                      {position.entryPrice} / {position.markPrice ?? "—"}
                    </td>
                    <td className="py-3 font-mono text-xs">
                      {position.quantity}
                    </td>
                    <td className="py-3">{position.leverage ?? "—"}×</td>
                    <td
                      className={`py-3 font-semibold ${position.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {money.format(position.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!openPositions.length && (
              <EmptyState text="AI hiện không quản lý vị thế mở nào." />
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <SectionHeader
            icon={BrainCircuit}
            title="Hiệu suất quyết định AI"
            description="Chỉ số từ các quyết định đã đủ thời gian đánh giá"
            href={ROUTES.ai.performance}
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
              label="Lợi nhuận TB"
              value={scorePercent(metrics?.averageReturn)}
            />
            <CompactMetric
              label="Max drawdown"
              value={scorePercent(metrics?.maxDrawdown)}
            />
            <CompactMetric
              label="Quyết định có hướng"
              value={metrics ? String(metrics.directionalDecisions) : "—"}
            />
            <CompactMetric
              label="Tổng đánh giá"
              value={metrics ? String(metrics.total) : "—"}
            />
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Đây là hiệu suất đánh giá tín hiệu AI, không phải PnL tiền thật. PnL
            tài khoản sàn được hiển thị riêng ở phía trên.
          </p>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <SectionHeader
            icon={Bot}
            title="Quyết định AI gần nhất"
            description={
              latestDecision
                ? `${latestDecision.symbol} · ${latestDecision.decision} · confidence ${latestDecision.confidence ?? "—"}`
                : "Chưa có quyết định LONG/SHORT/WAIT"
            }
            href={ROUTES.ai.pipelineRuns}
          />
          <div className="mt-4 space-y-2">
            {latestRuns.map((run) => (
              <div
                className="grid gap-2 rounded-xl border border-border p-3 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center"
                key={run.id}
              >
                <div>
                  <p className="font-semibold">{run.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </p>
                </div>
                <DecisionBadge decision={run.decision ?? "—"} />
                <span className="text-xs text-muted-foreground">
                  Confidence {run.confidence ?? "—"}
                </span>
                <StatusBadge
                  label={run.status}
                  tone={run.status === "COMPLETED" ? "success" : "warning"}
                />
              </div>
            ))}
            {!latestRuns.length && <EmptyState text="Chưa có pipeline run." />}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            icon={ShieldCheck}
            title="Ngân sách rủi ro"
            description="Mức sử dụng hiện tại so với giới hạn"
            href="/ai/risk"
          />
          <div className="mt-5 space-y-5">
            <RiskBar
              label="Exposure"
              value={riskData?.portfolio.exposurePct}
              limit={riskData?.config.maxExposure}
            />
            <RiskBar
              label="Drawdown"
              value={riskData?.portfolio.drawdownPct}
              limit={riskData?.config.maxDrawdown}
            />
            <RiskBar
              label="Open positions"
              value={riskData?.portfolio.openPositions}
              limit={riskData?.config.maxPositions}
              raw
            />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <CompactMetric
              label="Risk approved"
              value={approvedRisk?.toString() ?? "—"}
            />
            <CompactMetric
              label="Risk rejected"
              value={rejectedRisk?.toString() ?? "—"}
            />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionHeader
            icon={Activity}
            title="Lệnh gần nhất"
            description={`Tối đa 20 lệnh được đồng bộ; đang hiển thị ${recentOrders.length}`}
            href={ROUTES.ai.liveTrading}
          />
          <div className="mt-4 space-y-2">
            {recentOrders.map((order) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm"
                key={order.id}
              >
                <div>
                  <p className="font-semibold">
                    {order.symbol} · {order.side}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {order.purpose} ·{" "}
                    {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {order.netPnl !== null && order.netPnl !== undefined && (
                    <span
                      className={`font-mono text-xs font-semibold ${
                        order.netPnl >= 0 ? "text-emerald-400" : "text-red-400"
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
              <EmptyState text="Chưa có lịch sử lệnh." />
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            icon={CircleDollarSign}
            title="Khuyến nghị định lượng"
            description="Các đề xuất đang chờ trader xem xét"
            href={ROUTES.recommendations}
          />
          <div className="mt-4 space-y-2">
            {recommendations.data?.slice(0, 5).map((item) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm"
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
              <EmptyState text="Chưa có khuyến nghị định lượng mới." />
            )}
          </div>
        </Card>
      </section>

      <HealthStatus />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Phân tích thị trường", ROUTES.market],
            ["Risk Management", "/ai/risk"],
            ["Strategy Portfolio", ROUTES.ai.portfolio],
            ["Live Trading", ROUTES.ai.liveTrading],
          ] as const
        ).map(([label, href]) => (
          <Link
            className="group flex items-center justify-between rounded-xl border border-border bg-card p-4 text-sm font-semibold transition hover:border-primary/40 hover:bg-primary/5"
            href={href}
            key={href}
          >
            {label}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
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
        ? "text-red-400"
        : "text-foreground";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <p className={`mt-3 text-2xl font-bold ${color}`}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </Card>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
  href: string;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Link className="text-xs font-semibold text-primary" href={href}>
        Chi tiết
      </Link>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
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
      <div className="mb-2 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">
          {value === undefined
            ? "—"
            : raw
              ? `${value} / ${limit ?? "—"}`
              : `${ratioPercent(value)} / ${ratioPercent(limit)}`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${usage >= 0.8 ? "bg-red-400" : usage >= 0.6 ? "bg-amber-400" : "bg-emerald-400"}`}
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
    danger: "border-red-400/30 bg-red-400/10 text-red-300",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  };
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-semibold ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const tone =
    decision === "LONG"
      ? "text-emerald-400"
      : decision === "SHORT"
        ? "text-red-400"
        : "text-amber-300";
  return <span className={`font-bold ${tone}`}>{decision}</span>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>
  );
}

function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-border bg-card"
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
}: {
  title: string;
  description: string;
  action: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-red-400/10 p-6">
      <h1 className="font-semibold text-red-200">{title}</h1>
      <p className="mt-2 text-sm text-red-100/80">{description}</p>
      <button
        className="mt-4 rounded-lg border border-red-300/30 px-4 py-2 text-sm font-semibold"
        onClick={action}
        type="button"
      >
        Thử lại
      </button>
    </div>
  );
}
