import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EvaluationHorizon, Prisma } from "@prisma/client";
import type { PerformanceRecord } from "@platform/shared";
import {
  evaluateDecision,
  calculatePerformanceMetrics,
  type Decision,
} from "../domain/performance-calculator";
import { ReflectionRepository } from "../infrastructure/reflection.repository";
import { buildReliabilityCurve } from "../domain/confidence-calibration";
import { timeframeMilliseconds } from "../../pipeline/domain/adaptive-trading-policy";
import { performanceDriftToleranceMs } from "../domain/performance-provenance";

const FIXED_HORIZONS: Array<{ horizon: EvaluationHorizon; ms: number }> = [
  { horizon: "M15", ms: 15 * 60_000 },
  { horizon: "M30", ms: 30 * 60_000 },
  { horizon: "MID", ms: 60 * 60_000 },
  { horizon: "H2", ms: 2 * 60 * 60_000 },
  { horizon: "H4", ms: 4 * 60 * 60_000 },
  { horizon: "LONG", ms: 24 * 60 * 60_000 },
];

@Injectable()
export class PerformanceService {
  private evaluationCursor?: { completedAt: Date; id: string };

  constructor(
    private readonly repository: ReflectionRepository,
    private readonly config: ConfigService,
  ) {}

  async evaluateDue(): Promise<{
    evaluated: number;
    skippedForMissingMarketData: number;
    skippedForMissingStartPrice: number;
    skippedForMissingTargetPrice: number;
    skippedForMissingStartCandle: number;
    skippedForDrift: number;
    evaluatedUserIds: string[];
  }> {
    if (!this.config.get<boolean>("REFLECTION_ENABLED", true))
      return {
        evaluated: 0,
        skippedForMissingMarketData: 0,
        skippedForMissingStartPrice: 0,
        skippedForMissingTargetPrice: 0,
        skippedForMissingStartCandle: 0,
        skippedForDrift: 0,
        evaluatedUserIds: [],
      };
    const shortMs = this.config.get<number>("EVALUATION_DELAY_MS", 600_000);
    const horizons = [
      { horizon: "SHORT" as const, ms: shortMs },
      ...FIXED_HORIZONS,
    ];
    const batchSize = Math.max(
      50,
      Math.min(
        2000,
        this.config.get<number>("PERFORMANCE_EVALUATION_BATCH_SIZE", 1000),
      ),
    );
    const runs = await this.repository.completedRuns(
      new Date(Date.now() - Math.min(...horizons.map((h) => h.ms))),
      this.evaluationCursor,
      batchSize,
    );
    const last = runs.at(-1);
    this.evaluationCursor =
      runs.length >= batchSize && last?.completedAt
        ? { completedAt: last.completedAt, id: last.id }
        : undefined;
    let evaluated = 0;
    let skippedForMissingMarketData = 0;
    let skippedForMissingStartPrice = 0;
    let skippedForMissingTargetPrice = 0;
    let skippedForMissingStartCandle = 0;
    let skippedForDrift = 0;
    const evaluatedUserIds = new Set<string>();
    for (const run of runs) {
      if (!run.completedAt || !run.decision || run.confidence == null) continue;
      const candidate = evaluationCandidate(run.storedContext);
      const evaluatedDecision = candidate?.decision ?? run.decision;
      const evaluatedConfidence = candidate?.confidence ?? run.confidence;
      const leverage = evaluationLeverage(
        run.result,
        Boolean(candidate),
        this.config,
      );
      const existing = new Set(
        run.performanceRecords.map((record) => record.horizon),
      );
      const candleToleranceMs = timeframeMilliseconds(run.timeframe ?? "15m");
      const start = await this.repository.candleAtOrBefore(
        run.provider,
        run.symbol,
        run.completedAt,
        candleToleranceMs,
      );
      if (!start || !start.closeTime) {
        skippedForMissingStartCandle++;
        skippedForMissingMarketData++;
        skippedForMissingStartPrice++;
        continue;
      }
      const priceAtDecision = Number(start.close);
      if (
        !priceAtDecision ||
        !Number.isFinite(priceAtDecision) ||
        priceAtDecision <= 0
      ) {
        skippedForMissingStartCandle++;
        skippedForMissingMarketData++;
        skippedForMissingStartPrice++;
        continue;
      }
      for (const item of horizons) {
        if (existing.has(item.horizon)) continue;
        const target = new Date(run.completedAt.getTime() + item.ms);
        if (target.getTime() > Date.now()) continue;
        const after = await this.repository.candleAtOrAfter(
          run.provider,
          run.symbol,
          target,
          candleToleranceMs,
        );
        if (!after || !after.closeTime) {
          skippedForMissingMarketData++;
          skippedForMissingTargetPrice++;
          continue;
        }
        const actualTargetTimestamp = after.closeTime instanceof Date
          ? after.closeTime
          : new Date(after.closeTime);
        const driftToleranceMs = performanceDriftToleranceMs(
          item.horizon,
          item.ms,
        );
        const driftMs = Math.abs(
          actualTargetTimestamp.getTime() - target.getTime(),
        );
        if (driftMs > driftToleranceMs) {
          skippedForDrift++;
          continue;
        }

        const priceAfter = Number(after.close);
        const result = evaluateDecision(
          evaluatedDecision as Decision,
          priceAtDecision,
          priceAfter,
          this.config.get<number>("EVALUATION_ROUND_TRIP_COST_PCT", 0.1),
        );
        const context = flags(run.storedContext);
        await this.repository.createRecord({
          userId: run.userId,
          runId: run.id,
          symbol: run.symbol,
          horizon: item.horizon,
          strategyKey: candidate?.strategyKey,
          decision: evaluatedDecision,
          confidence: evaluatedConfidence,
          priceAtDecision,
          priceAfter,
          actualStartTimestamp: start.closeTime,
          actualTargetTimestamp,
          timeDriftMs: Math.round(
            actualTargetTimestamp.getTime() - target.getTime(),
          ),
          ...result,
          leverage: leverage.value,
          netRoePct: round(result.returnPct * leverage.value),
          leverageSource: leverage.source,
          ...context,
          marketRegime: run.marketRegime,
          provenanceEligible: true,
        });
        evaluated++;
        evaluatedUserIds.add(run.userId);
      }
    }
    return {
      evaluated,
      skippedForMissingMarketData,
      skippedForMissingStartPrice,
      skippedForMissingTargetPrice,
      skippedForMissingStartCandle,
      skippedForDrift,
      evaluatedUserIds: [...evaluatedUserIds],
    };
  }

  async list(userId: string, horizon?: EvaluationHorizon, symbol?: string) {
    return (await this.repository.records(userId, horizon, 500, symbol)).map(
      toDto,
    );
  }
  async metrics(userId: string, horizon?: EvaluationHorizon, symbol?: string) {
    return calculatePerformanceMetrics(
      await this.list(userId, horizon, symbol),
    );
  }
  async calibration(userId: string, symbol?: string) {
    const rows = await this.repository.records(userId, "MID", 500, symbol, true);
    return buildReliabilityCurve(
      rows.map((row) => ({
        confidence: row.confidence,
        outcome: row.outcome,
      })),
    );
  }
  async alerts(userId: string, symbol?: string) {
    const records = await this.list(userId, undefined, symbol);
    const metrics = calculatePerformanceMetrics(records);
    const threshold = this.config.get<number>(
      "REFLECTION_ACCURACY_ALERT_THRESHOLD",
      50,
    );
    const alerts: Array<{
      kind: string;
      severity: "MEDIUM" | "HIGH";
      message: string;
    }> = [];
    if (metrics.directionalDecisions >= 5 && metrics.accuracy < threshold)
      alerts.push({
        kind: "ACCURACY_DROP",
        severity: "HIGH",
        message: `Accuracy ${metrics.accuracy}% is below the ${threshold}% threshold.`,
      });
    const recentDirectional = records
      .filter((r) => r.decision !== "WAIT")
      .slice(0, 3);
    if (
      recentDirectional.length === 3 &&
      recentDirectional.every((r) => r.outcome === "WRONG")
    )
      alerts.push({
        kind: "REPEATED_WRONG",
        severity: "HIGH",
        message: "The three most recent directional evaluations were wrong.",
      });
    if (metrics.maxDrawdown >= 10)
      alerts.push({
        kind: "ABNORMAL_DRAWDOWN",
        severity: metrics.maxDrawdown >= 20 ? "HIGH" : "MEDIUM",
        message: `Simulated drawdown reached ${metrics.maxDrawdown}%.`,
      });
    return alerts;
  }
}

function evaluationCandidate(value: Prisma.JsonValue | null):
  | {
      decision: "LONG" | "SHORT";
      confidence: number;
      strategyKey?: string;
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value.candidateDecision;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return undefined;
  const decision = candidate.decision;
  const confidence = candidate.confidence;
  const strategyKey = candidate.strategyKey;
  if (
    (decision !== "LONG" && decision !== "SHORT") ||
    typeof confidence !== "number"
  )
    return undefined;
  return {
    decision,
    confidence,
    ...(typeof strategyKey === "string" ? { strategyKey } : {}),
  };
}

function flags(value: Prisma.JsonValue | null): {
  highVolatility: boolean;
  majorNews: boolean;
} {
  const text = JSON.stringify(value ?? {}).toLowerCase();
  return {
    highVolatility: /high_volatility|"level":"high"|volatility spike/.test(
      text,
    ),
    majorNews: /"impact":\{"level":"high"|major news|high-impact/.test(text),
  };
}

export function toDto(row: {
  id: string;
  runId: string;
  symbol: string;
  strategyKey: string | null;
  horizon: EvaluationHorizon;
  decision: string;
  confidence: number;
  priceAtDecision: { toString(): string };
  priceAfter: { toString(): string };
  outcome: "CORRECT" | "WRONG" | "NEUTRAL";
  returnPct: number;
  leverage: number;
  netRoePct: number;
  leverageSource: string;
  evaluatedAt: Date;
}): PerformanceRecord {
  return {
    id: row.id,
    runId: row.runId,
    symbol: row.symbol,
    ...(row.strategyKey ? { strategyKey: row.strategyKey } : {}),
    horizon: row.horizon,
    decision: row.decision as Decision,
    confidence: row.confidence,
    priceAtDecision: Number(row.priceAtDecision),
    priceAfter: Number(row.priceAfter),
    outcome: row.outcome,
    returnPct: row.returnPct,
    leverage: row.leverage,
    netRoePct: row.netRoePct,
    leverageSource: row.leverageSource as PerformanceRecord["leverageSource"],
    evaluatedAt: row.evaluatedAt.toISOString(),
  };
}

function evaluationLeverage(
  value: Prisma.JsonValue | null,
  shadowCandidate: boolean,
  config: ConfigService,
): {
  value: number;
  source: "RISK_ASSESSMENT" | "SHADOW_CONFIG" | "UNLEVERAGED";
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const assessment = value.riskAssessment;
    if (
      assessment &&
      typeof assessment === "object" &&
      !Array.isArray(assessment)
    ) {
      const risk = assessment.risk;
      if (risk && typeof risk === "object" && !Array.isArray(risk)) {
        const assessed = Number(risk.leverage);
        if (Number.isFinite(assessed) && assessed >= 1) {
          return {
            value: Math.min(125, Math.floor(assessed)),
            source: "RISK_ASSESSMENT",
          };
        }
      }
    }
  }
  if (shadowCandidate) {
    const configured = config.get<number>("EVALUATION_SHADOW_LEVERAGE", 5);
    return {
      value: Math.max(1, Math.min(10, Math.floor(configured))),
      source: "SHADOW_CONFIG",
    };
  }
  return { value: 1, source: "UNLEVERAGED" };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function priceFromRun(run: {
  storedContext?: unknown;
  result?: unknown;
}): number | undefined {
  if (run.storedContext && typeof run.storedContext === "object") {
    const ctx = run.storedContext as Record<string, unknown>;
    const dec = ctx.decision as Record<string, unknown> | undefined;
    if (dec && typeof dec.entryPrice === "number" && dec.entryPrice > 0) {
      return dec.entryPrice;
    }
    const market = ctx.market as Record<string, unknown> | undefined;
    if (market && typeof market.price === "number" && market.price > 0) {
      return market.price;
    }
    const anal = ctx.analyses as Record<string, unknown> | undefined;
    const tech = anal?.technical as Record<string, unknown> | undefined;
    if (tech && typeof tech.price === "number" && tech.price > 0) {
      return tech.price;
    }
  }
  if (run.result && typeof run.result === "object") {
    const res = run.result as Record<string, unknown>;
    if (typeof res.entryPrice === "number" && res.entryPrice > 0) {
      return res.entryPrice;
    }
  }
  return undefined;
}
