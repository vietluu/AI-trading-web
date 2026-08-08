import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EvaluationHorizon, Prisma } from '@prisma/client';
import type { PerformanceRecord } from '@platform/shared';
import { evaluateDecision, calculatePerformanceMetrics, type Decision } from '../domain/performance-calculator';
import { ReflectionRepository } from '../infrastructure/reflection.repository';
import { buildReliabilityCurve } from '../domain/confidence-calibration';

const FIXED_HORIZONS: Array<{ horizon: EvaluationHorizon; ms: number }> = [
  { horizon: 'MID', ms: 60 * 60_000 },
  { horizon: 'LONG', ms: 24 * 60 * 60_000 },
];

@Injectable()
export class PerformanceService {
  constructor(private readonly repository: ReflectionRepository, private readonly config: ConfigService) {}

  async evaluateDue(): Promise<{ evaluated: number; skippedForMissingMarketData: number; evaluatedUserIds: string[] }> {
    if (!this.config.get<boolean>('REFLECTION_ENABLED', true)) return { evaluated: 0, skippedForMissingMarketData: 0, evaluatedUserIds: [] };
    const shortMs = this.config.get<number>('EVALUATION_DELAY_MS', 600_000);
    const horizons = [{ horizon: 'SHORT' as const, ms: shortMs }, ...FIXED_HORIZONS];
    const runs = await this.repository.completedRuns(new Date(Date.now() - Math.min(...horizons.map((h) => h.ms))));
    let evaluated = 0;
    let skippedForMissingMarketData = 0;
    const evaluatedUserIds = new Set<string>();
    for (const run of runs) {
      if (!run.completedAt || !run.decision || run.confidence == null) continue;
      const existing = new Set(run.performanceRecords.map((record) => record.horizon));
      const start = await this.repository.candleAtOrBefore(run.provider, run.symbol, run.completedAt);
      if (!start) { skippedForMissingMarketData++; continue; }
      for (const item of horizons) {
        if (existing.has(item.horizon)) continue;
        const target = new Date(run.completedAt.getTime() + item.ms);
        if (target.getTime() > Date.now()) continue;
        const after = await this.repository.candleAtOrAfter(run.provider, run.symbol, target);
        if (!after) { skippedForMissingMarketData++; continue; }
        const priceAtDecision = Number(start.close);
        const priceAfter = Number(after.close);
        const result = evaluateDecision(
          run.decision as Decision,
          priceAtDecision,
          priceAfter,
          this.config.get<number>('EVALUATION_ROUND_TRIP_COST_PCT', 0.1),
        );
        const context = flags(run.storedContext);
        await this.repository.createRecord({
          userId: run.userId, runId: run.id, symbol: run.symbol, horizon: item.horizon,
          decision: run.decision, confidence: run.confidence, priceAtDecision, priceAfter,
          ...result, ...context, marketRegime: run.marketRegime,
        });
        evaluated++;
        evaluatedUserIds.add(run.userId);
      }
    }
    return { evaluated, skippedForMissingMarketData, evaluatedUserIds: [...evaluatedUserIds] };
  }

  async list(userId: string, horizon?: EvaluationHorizon, symbol?: string) { return (await this.repository.records(userId, horizon, 500, symbol)).map(toDto); }
  async metrics(userId: string, horizon?: EvaluationHorizon, symbol?: string) { return calculatePerformanceMetrics(await this.list(userId, horizon, symbol)); }
  async calibration(userId: string, symbol?: string) {
    const rows = await this.repository.records(userId, 'MID', 500, symbol);
    return buildReliabilityCurve(rows.map((row) => ({
      confidence: row.confidence,
      outcome: row.outcome,
    })));
  }
  async alerts(userId: string, symbol?: string) {
    const records = await this.list(userId, undefined, symbol);
    const metrics = calculatePerformanceMetrics(records);
    const threshold = this.config.get<number>('REFLECTION_ACCURACY_ALERT_THRESHOLD', 50);
    const alerts: Array<{ kind: string; severity: 'MEDIUM' | 'HIGH'; message: string }> = [];
    if (metrics.directionalDecisions >= 5 && metrics.accuracy < threshold) alerts.push({ kind: 'ACCURACY_DROP', severity: 'HIGH', message: `Accuracy ${metrics.accuracy}% is below the ${threshold}% threshold.` });
    const recentDirectional = records.filter((r) => r.decision !== 'WAIT').slice(0, 3);
    if (recentDirectional.length === 3 && recentDirectional.every((r) => r.outcome === 'WRONG')) alerts.push({ kind: 'REPEATED_WRONG', severity: 'HIGH', message: 'The three most recent directional evaluations were wrong.' });
    if (metrics.maxDrawdown >= 10) alerts.push({ kind: 'ABNORMAL_DRAWDOWN', severity: metrics.maxDrawdown >= 20 ? 'HIGH' : 'MEDIUM', message: `Simulated drawdown reached ${metrics.maxDrawdown}%.` });
    return alerts;
  }
}

function flags(value: Prisma.JsonValue | null): { highVolatility: boolean; majorNews: boolean } {
  const text = JSON.stringify(value ?? {}).toLowerCase();
  return { highVolatility: /high_volatility|"level":"high"|volatility spike/.test(text), majorNews: /"impact":\{"level":"high"|major news|high-impact/.test(text) };
}

export function toDto(row: { id: string; runId: string; symbol: string; horizon: EvaluationHorizon; decision: string; confidence: number; priceAtDecision: { toString(): string }; priceAfter: { toString(): string }; outcome: 'CORRECT' | 'WRONG' | 'NEUTRAL'; returnPct: number; evaluatedAt: Date }): PerformanceRecord {
  return { id: row.id, runId: row.runId, symbol: row.symbol, horizon: row.horizon, decision: row.decision as Decision, confidence: row.confidence, priceAtDecision: Number(row.priceAtDecision), priceAfter: Number(row.priceAfter), outcome: row.outcome, returnPct: row.returnPct, evaluatedAt: row.evaluatedAt.toISOString() };
}
