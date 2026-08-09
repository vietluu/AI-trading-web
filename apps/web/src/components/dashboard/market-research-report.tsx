"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Clock3,
  SearchCheck,
  Sparkles,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { ROUTES } from "@/constants/routes";
import type { PipelineRun } from "@/services/ai-feature.service";
import type { SymbolOpportunity } from "@/services/home-dashboard.service";

interface SymbolResearch {
  run: PipelineRun;
  decision: string;
  confidence: number;
}

export interface MarketResearchSummary {
  conclusion:
    "BULLISH_BIAS" | "BEARISH_BIAS" | "CAUTIOUS" | "INSUFFICIENT_DATA";
  headline: string;
  guidance: string;
  longCount: number;
  shortCount: number;
  waitCount: number;
  averageConfidence?: number;
  dominantRegime?: string;
  latestAt?: string;
  research: SymbolResearch[];
  risks: string[];
}

export function buildMarketResearchSummary(
  runs: PipelineRun[],
): MarketResearchSummary {
  const latestBySymbol = new Map<string, SymbolResearch>();
  for (const run of runs) {
    if (run.status !== "COMPLETED" || !run.result?.reasoning) continue;
    if (latestBySymbol.has(run.symbol)) continue;
    latestBySymbol.set(run.symbol, {
      run,
      decision: run.result.decision ?? run.decision ?? "WAIT",
      confidence: run.result.confidence ?? run.confidence ?? 0,
    });
  }
  const research = Array.from(latestBySymbol.values());
  const longCount = research.filter((item) => item.decision === "LONG").length;
  const shortCount = research.filter(
    (item) => item.decision === "SHORT",
  ).length;
  const waitCount = research.length - longCount - shortCount;
  const averageConfidence = research.length
    ? research.reduce((sum, item) => sum + item.confidence, 0) / research.length
    : undefined;
  const regimes = research
    .map((item) => item.run.result?.regime?.type ?? item.run.marketRegime)
    .filter((item): item is string => Boolean(item));
  const dominantRegime = [...new Set(regimes)].sort(
    (a, b) =>
      regimes.filter((item) => item === b).length -
      regimes.filter((item) => item === a).length,
  )[0];
  const risks = [
    ...new Set(research.flatMap((item) => item.run.result?.risks ?? [])),
  ].slice(0, 5);
  const latestAt = research
    .map((item) => item.run.createdAt)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  if (!research.length) {
    return {
      conclusion: "INSUFFICIENT_DATA",
      headline: "Chưa đủ dữ liệu để kết luận thị trường",
      guidance:
        "Chờ pipeline agent hoàn tất phân tích trước khi xây dựng kế hoạch giao dịch.",
      longCount,
      shortCount,
      waitCount,
      research,
      risks,
    };
  }
  const directional = longCount + shortCount;
  const confidenceReady = (averageConfidence ?? 0) >= 60;
  if (
    confidenceReady &&
    directional > 0 &&
    longCount > shortCount &&
    longCount >= waitCount
  ) {
    return {
      conclusion: "BULLISH_BIAS",
      headline: "AI đang nghiêng về kịch bản tăng giá có chọn lọc",
      guidance:
        "Ưu tiên theo dõi setup LONG đã được Risk/Judge phê duyệt; không mua đuổi coin chỉ vì momentum cao.",
      longCount,
      shortCount,
      waitCount,
      averageConfidence,
      dominantRegime,
      latestAt,
      research,
      risks,
    };
  }
  if (
    confidenceReady &&
    directional > 0 &&
    shortCount > longCount &&
    shortCount >= waitCount
  ) {
    return {
      conclusion: "BEARISH_BIAS",
      headline: "AI đang nghiêng về phòng thủ hoặc kịch bản giảm giá",
      guidance:
        "Hạn chế mở LONG mới; chỉ cân nhắc SHORT khi cấu trúc, R:R và Risk Engine cùng xác nhận.",
      longCount,
      shortCount,
      waitCount,
      averageConfidence,
      dominantRegime,
      latestAt,
      research,
      risks,
    };
  }
  return {
    conclusion: "CAUTIOUS",
    headline: "Tín hiệu đang phân hóa — ưu tiên quan sát",
    guidance:
      "Giữ quy mô nhỏ hoặc WAIT cho đến khi agent đồng thuận hơn và xuất hiện setup có reward/risk đạt chuẩn.",
    longCount,
    shortCount,
    waitCount,
    averageConfidence,
    dominantRegime,
    latestAt,
    research,
    risks,
  };
}

export function MarketResearchReport({
  runs,
  opportunities,
  loading,
}: {
  runs: PipelineRun[];
  opportunities: SymbolOpportunity[];
  loading: boolean;
}): React.JSX.Element {
  const report = buildMarketResearchSummary(runs);
  const conclusionStyle = {
    BULLISH_BIAS: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    BEARISH_BIAS: "border-red-400/30 bg-red-400/10 text-red-200",
    CAUTIOUS: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    INSUFFICIENT_DATA: "border-sky-400/30 bg-sky-400/10 text-sky-100",
  }[report.conclusion];

  return (
    <section className="space-y-4">
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-gradient-to-r from-primary/10 via-card to-card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                <BrainCircuit className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  AI multi-agent market research
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  Báo cáo nhận định thị trường
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tổng hợp kết luận mới nhất từ Decision, Judge, Market,
                  Technical, News và Sentiment pipeline.
                </p>
              </div>
            </div>
            <Link
              className="text-xs font-semibold text-primary"
              href={ROUTES.ai.pipelineRuns}
            >
              Xem bằng chứng pipeline
            </Link>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className={`rounded-xl border p-4 ${conclusionStyle}`}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="h-4 w-4" /> Kết luận tổng hợp
              </div>
              <h3 className="mt-2 text-lg font-bold">{report.headline}</h3>
              <p className="mt-2 text-sm leading-6 opacity-90">
                {report.guidance}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReportMetric
                label="LONG"
                value={String(report.longCount)}
                tone="positive"
              />
              <ReportMetric
                label="SHORT"
                value={String(report.shortCount)}
                tone="negative"
              />
              <ReportMetric
                label="WAIT"
                value={String(report.waitCount)}
                tone="warning"
              />
              <ReportMetric
                label="Confidence TB"
                value={
                  report.averageConfidence === undefined
                    ? "—"
                    : `${report.averageConfidence.toFixed(1)}/100`
                }
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Regime chính:{" "}
                {report.dominantRegime ?? "—"}
              </span>
              <span className="flex items-center gap-1.5">
                <SearchCheck className="h-3.5 w-3.5" /> {report.research.length}{" "}
                coin có báo cáo agent
              </span>
              <span className="flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                {report.latestAt
                  ? `Cập nhật ${new Date(report.latestAt).toLocaleString()}`
                  : "Chưa có thời điểm cập nhật"}
              </span>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">
              Luận điểm mới nhất của agent
            </h3>
            <div className="mt-3 space-y-3">
              {report.research
                .slice(0, 3)
                .map(({ run, decision, confidence }) => (
                  <article
                    className="rounded-xl border border-border p-3"
                    key={run.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{run.symbol}</span>
                      <DecisionPill
                        decision={decision}
                        confidence={confidence}
                      />
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                      {run.result?.reasoning}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded bg-muted px-2 py-1">
                        {run.result?.regime?.type ??
                          run.marketRegime ??
                          "UNKNOWN REGIME"}
                      </span>
                      <span className="rounded bg-muted px-2 py-1">
                        Opportunity {run.result?.opportunityScore ?? "—"}
                      </span>
                      <span className="rounded bg-muted px-2 py-1">
                        Risk {run.result?.riskScore ?? "—"}
                      </span>
                      <span className="rounded bg-muted px-2 py-1">
                        Judge {run.result?.judge?.verdict ?? "—"}
                      </span>
                    </div>
                  </article>
                ))}
              {!report.research.length && (
                <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  {loading
                    ? "Agent đang tổng hợp dữ liệu…"
                    : "Chưa có pipeline result đủ dữ liệu để lập báo cáo."}
                </p>
              )}
            </div>
          </div>
        </div>

        {report.risks.length > 0 && (
          <div className="border-t border-border bg-amber-400/5 px-5 py-4 sm:px-6">
            <div className="flex gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div>
                <span className="font-semibold text-amber-200">
                  Rủi ro agent ghi nhận:{" "}
                </span>
                <span className="text-muted-foreground">
                  {report.risks.join(" · ")}
                </span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Coin đáng theo dõi</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Xếp hạng thanh khoản/momentum từ sàn; LONG/SHORT chỉ hiển thị khi
              có kết luận agent tương ứng.
            </p>
          </div>
          <Link
            className="text-xs font-semibold text-primary"
            href={ROUTES.recommendations}
          >
            Xem toàn bộ cơ hội
          </Link>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {opportunities.slice(0, 6).map((opportunity) => {
            const evidence = report.research.find(
              (item) => item.run.symbol === opportunity.symbol,
            );
            return (
              <article
                className="rounded-2xl border border-border bg-card p-4"
                key={opportunity.symbol}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{opportunity.symbol}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {opportunity.provider}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                    Watch {opportunity.opportunityScore}/100
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <span className="font-mono text-sm">
                    ${formatPrice(opportunity.price)}
                  </span>
                  <span
                    className={`text-sm font-semibold ${opportunity.change24hPct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {opportunity.change24hPct >= 0 ? "+" : ""}
                    {opportunity.change24hPct.toFixed(2)}%
                  </span>
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  {evidence ? (
                    <div className="flex items-center justify-between gap-2">
                      <DecisionPill
                        decision={evidence.decision}
                        confidence={evidence.confidence}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        EV{" "}
                        {evidence.run.result?.expectedValue?.toFixed(2) ?? "—"}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Chưa có kết luận agent — chỉ theo dõi
                    </span>
                  )}
                  <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                    {opportunity.reasons.join(" · ") ||
                      "Được xếp hạng từ dữ liệu thị trường hiện tại."}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
        {!opportunities.length && !loading && (
          <p className="mt-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Chưa lấy được danh sách coin đáng theo dõi từ sàn.
          </p>
        )}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        Báo cáo phục vụ nghiên cứu và quản trị rủi ro, không phải lời khuyên tài
        chính hay cam kết lợi nhuận. Quyết định giao dịch vẫn phải qua Judge,
        Risk Engine và giới hạn portfolio.
      </p>
    </section>
  );
}

function DecisionPill({
  decision,
  confidence,
}: {
  decision: string;
  confidence: number;
}) {
  const style =
    decision === "LONG"
      ? "bg-emerald-400/10 text-emerald-300"
      : decision === "SHORT"
        ? "bg-red-400/10 text-red-300"
        : "bg-amber-400/10 text-amber-200";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${style}`}>
      {decision} · {confidence.toFixed(0)}
    </span>
  );
}

function ReportMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative" | "warning";
}) {
  const style = {
    neutral: "text-foreground",
    positive: "text-emerald-400",
    negative: "text-red-400",
    warning: "text-amber-300",
  }[tone];
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${style}`}>{value}</p>
    </div>
  );
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value < 1 ? 6 : 2,
  });
}
