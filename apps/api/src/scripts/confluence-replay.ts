import "reflect-metadata";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://platform:platform_dev@35.247.72.125:5432/crypto_platform?schema=public",
    },
  },
});

function marketDislocationFromParams(value: unknown): {
  direction: "BULLISH" | "BEARISH";
  confirmationCount: number;
  indicatorCloseTime: string;
  reasons: string[];
} | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (
    (event.direction !== "BULLISH" && event.direction !== "BEARISH") ||
    !Number.isFinite(Number(event.confirmationCount)) ||
    typeof event.indicatorCloseTime !== "string" ||
    !Array.isArray(event.reasons) ||
    !event.reasons.every((reason) => typeof reason === "string")
  ) return undefined;
  return {
    direction: event.direction,
    confirmationCount: Number(event.confirmationCount),
    indicatorCloseTime: event.indicatorCloseTime,
    reasons: event.reasons,
  };
}

function computeMultiFactorCompositeScore(signal: {
  confidence: number;
  opportunityScore: number;
  expectedValue: number;
  riskScore: number;
}): number {
  const normConfidence = Math.max(0, Math.min(100, Number(signal.confidence) || 0));
  const normOpportunity = Math.max(0, Math.min(100, Number(signal.opportunityScore) || 0));
  const normEv = Math.max(-50, Math.min(50, (Number(signal.expectedValue) || 0) * 100));
  const normSafety = Math.max(0, Math.min(100, 100 - (Number(signal.riskScore) || 0)));

  return Number(
    (normConfidence * 0.4 +
      normOpportunity * 0.3 +
      normEv * 0.2 +
      normSafety * 0.1).toFixed(3),
  );
}

function computeConcordanceSizeFactor(
  concordanceCount: number,
  boostPerSignal = 0.25,
  maxSizeFactor = 2.0,
  minSignalsForBoost = 2,
  qualityBonus?: { opp?: number; ev?: number; bonus?: number },
): number {
  if (concordanceCount < minSignalsForBoost) return 1.0;
  let boost = boostPerSignal * (concordanceCount - 1);
  if (qualityBonus) {
    if ((qualityBonus.opp && qualityBonus.opp >= 78) || (qualityBonus.ev && qualityBonus.ev >= 0.3)) {
      boost += qualityBonus.bonus ?? 0.1;
    }
  }
  return Number(Math.min(1.0 + boost, maxSizeFactor).toFixed(3));
}

interface ReplayCandidate {
  runId: string;
  symbol: string;
  createdAt: Date;
  decision: "LONG" | "SHORT";
  confidence: number;
  opportunityScore: number;
  expectedValue: number;
  riskScore: number;
  compositeScore: number;
  returnPct: number;
  outcome: string;
  isEligibleCanary: boolean;
}

async function main() {
  const startDate = new Date("2026-08-30T00:00:00.000Z");
  const endDate = new Date("2026-08-31T23:59:59.999Z");

  const CORE_SYMBOLS = new Set(["BTC-USDT", "ETH-USDT", "BNB-USDT", "SOL-USDT"]);

  const runs = await prisma.pipelineRun.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      status: "COMPLETED",
      trigger: "EVENT",
    },
    include: {
      performanceRecords: {
        where: { horizon: "MID" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates: ReplayCandidate[] = [];

  for (const r of runs) {
    if (!CORE_SYMBOLS.has(r.symbol)) continue;

    const result = r.result as Record<string, unknown> | null;
    const params = r.params as Record<string, unknown> | null;
    if (!result) continue;

    const event = marketDislocationFromParams(params?.eventScan);
    const candidateDecision = result.candidateDecision as Record<string, unknown> | undefined;
    const decisionStr = (candidateDecision?.decision as string) ?? r.decision;
    if (decisionStr !== "LONG" && decisionStr !== "SHORT") continue;

    const midPerf = r.performanceRecords.find((p) => p.horizon === "MID");
    if (!midPerf || midPerf.returnPct === null) continue;

    const confidence = r.confidence ?? (candidateDecision?.confidence as number) ?? 0;
    const opportunityScore = typeof result.opportunityScore === "number" ? result.opportunityScore : 0;
    const expectedValue = typeof result.expectedValue === "number" ? result.expectedValue : 0;
    const riskScore = typeof result.riskScore === "number" ? result.riskScore : 0;

    const multiFactorScore = computeMultiFactorCompositeScore({
      confidence,
      opportunityScore,
      expectedValue,
      riskScore,
    });

    let isEligible = false;
    if (event) {
      const directionAligned =
        (decisionStr === "LONG" && event.direction === "BULLISH") ||
        (decisionStr === "SHORT" && event.direction === "BEARISH");
      const structuralBreakout = event.reasons.some((item) =>
        /ROLLING_(?:HIGH_BREAKOUT|LOW_BREAKDOWN)/.test(item),
      );
      const atrImpulse = event.reasons.some((item) =>
        /(?:BULLISH|BEARISH)_ATR_IMPULSE/.test(item),
      );
      const sourceTime = Date.parse(event.indicatorCloseTime);
      const sourceAgeMs = r.createdAt.getTime() - sourceTime;

      const multiTimeframe = result.multiTimeframe as Record<string, unknown> | undefined;
      const mtfConfirmation = typeof multiTimeframe?.decisionConfirmation === "number" ? multiTimeframe.decisionConfirmation : 85;

      // ENHANCED QUALITY FILTERING:
      // 1. Core dislocation criteria
      // 2. Expected Value >= 0.15 to filter out razor-thin margin trades
      // 3. High MTF confirmation >= 80%
      isEligible =
        directionAligned &&
        structuralBreakout &&
        atrImpulse &&
        event.confirmationCount >= 2 &&
        Number.isFinite(sourceTime) &&
        sourceAgeMs >= -60_000 &&
        sourceAgeMs <= 10 * 60_000 &&
        confidence >= 74 &&
        opportunityScore >= 70 &&
        riskScore < 80 &&
        expectedValue >= 0.15 && // ENHANCED FILTER
        (r.marketRegime ?? "TRENDING") !== "HIGH_VOLATILITY" &&
        mtfConfirmation >= 80;
    }

    candidates.push({
      runId: r.id,
      symbol: r.symbol,
      createdAt: r.createdAt,
      decision: decisionStr,
      confidence,
      opportunityScore,
      expectedValue,
      riskScore,
      compositeScore: multiFactorScore,
      returnPct: midPerf.returnPct,
      outcome: midPerf.outcome,
      isEligibleCanary: isEligible,
    });
  }

  const eligibleCandidates = candidates.filter((c) => c.isEligibleCanary);

  // Group into Confluence Batches (45s window)
  const CONFLUENCE_WINDOW_MS = 45_000;
  const batches: {
    start: Date;
    signals: ReplayCandidate[];
    selected: ReplayCandidate;
    rejected: ReplayCandidate[];
    sizeFactor: number;
  }[] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < eligibleCandidates.length; i++) {
    const sig = eligibleCandidates[i]!;
    if (assigned.has(sig.runId)) continue;

    const windowEnd = new Date(sig.createdAt.getTime() + CONFLUENCE_WINDOW_MS);
    const batchSigs: ReplayCandidate[] = [sig];
    assigned.add(sig.runId);

    for (let j = i + 1; j < eligibleCandidates.length; j++) {
      const other = eligibleCandidates[j]!;
      if (assigned.has(other.runId)) continue;
      if (other.createdAt > windowEnd) break;
      if (other.symbol !== sig.symbol) {
        batchSigs.push(other);
        assigned.add(other.runId);
      }
    }

    const sorted = [...batchSigs].sort(
      (a, b) => b.compositeScore - a.compositeScore || b.confidence - a.confidence || b.opportunityScore - a.opportunityScore,
    );
    const selected = sorted[0]!;
    const rejected = sorted.slice(1);

    // Enhanced Sizing Boost with quality bonus:
    const sizeFactor = computeConcordanceSizeFactor(
      batchSigs.length,
      0.25, // 0.25 per signal
      2.0,  // max 2.0x
      2,
      { opp: selected.opportunityScore, ev: selected.expectedValue, bonus: 0.1 },
    );

    batches.push({
      start: sig.createdAt,
      signals: batchSigs,
      selected,
      rejected,
      sizeFactor,
    });
  }

  // Simulation: STRICT 1 POSITION PER DIRECTION (Hold 60 min)
  const activePositionUntil = new Map<string, number>();
  const executedWith1PosLimit: {
    batchStart: Date;
    symbol: string;
    decision: string;
    rawReturn: number;
    boostedReturn: number;
    sizeFactor: number;
    concordanceCount: number;
    outcome: string;
  }[] = [];

  for (const b of batches) {
    const direction = b.selected.decision;
    const until = activePositionUntil.get(direction) ?? 0;
    if (b.start.getTime() >= until) {
      activePositionUntil.set(direction, b.start.getTime() + 60 * 60_000);
      executedWith1PosLimit.push({
        batchStart: b.start,
        symbol: b.selected.symbol,
        decision: b.selected.decision,
        rawReturn: b.selected.returnPct,
        boostedReturn: b.selected.returnPct * b.sizeFactor,
        sizeFactor: b.sizeFactor,
        concordanceCount: b.signals.length,
        outcome: b.selected.outcome,
      });
    }
  }

  console.log("============================================================");
  console.log("  ENHANCED CONFLUENCE REPLAY AUDIT (Aug 30-31, 2026)");
  console.log("============================================================\n");

  let sumRaw = 0;
  let sumBoosted = 0;
  let wins = 0;

  for (let i = 0; i < executedWith1PosLimit.length; i++) {
    const t = executedWith1PosLimit[i]!;
    sumRaw += t.rawReturn;
    sumBoosted += t.boostedReturn;
    if (t.rawReturn > 0) wins++;
    const timeStr = t.batchStart.toISOString().replace("T", " ").slice(0, 19);
    console.log(
      `[${String(i + 1).padStart(2)}] ${timeStr} UTC | ${t.symbol.padEnd(9)} | ${t.decision} | ${t.outcome === "CORRECT" ? "WIN " : "LOSS"} | Raw: ${t.rawReturn > 0 ? "+" : ""}${t.rawReturn.toFixed(4)}% | Boost (${t.sizeFactor.toFixed(2)}x): ${t.boostedReturn > 0 ? "+" : ""}${t.boostedReturn.toFixed(4)}% | (${t.concordanceCount} signals)`,
    );
  }

  const winRate = (wins / executedWith1PosLimit.length) * 100;
  const positive = executedWith1PosLimit.filter((t) => t.boostedReturn > 0).reduce((s, t) => s + t.boostedReturn, 0);
  const negative = Math.abs(executedWith1PosLimit.filter((t) => t.boostedReturn < 0).reduce((s, t) => s + t.boostedReturn, 0));
  const pf = negative > 0 ? positive / negative : Infinity;

  console.log("\n============================================================");
  console.log("  METRICS AUDIT: QUALITY FILTERING + SUPER CONFLUENCE BOOST");
  console.log("============================================================\n");
  console.log(`Số lệnh vào được: ${executedWith1PosLimit.length} lệnh`);
  console.log(`Số lệnh thắng: ${wins} / ${executedWith1PosLimit.length}`);
  console.log(`Win Rate: ${winRate.toFixed(2)}%`);
  console.log(`Profit Factor: ${pf.toFixed(4)}`);
  console.log(`Tổng PnL cơ bản (Raw Return): ${sumRaw > 0 ? "+" : ""}${sumRaw.toFixed(4)}%`);
  console.log(`Tổng PnL với Super Confluence Boost: ${sumBoosted > 0 ? "+" : ""}${sumBoosted.toFixed(4)}%`);
  console.log(`Alpha thặng dư từ Confluence Engine: +${(sumBoosted - sumRaw).toFixed(4)}%`);

  await prisma.$disconnect();
}

main().catch(console.error);
