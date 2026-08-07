import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DecisionOutput, RiskOutput } from "@platform/shared";
import {
  ExchangeEnvironment as PrismaExchangeEnvironment,
  type Prisma,
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { evaluateRisk, type RiskPosition } from "../domain/risk-engine";
import { RiskConfigService } from "./risk-config.service";

type Tx = Prisma.TransactionClient;

export interface AssessRiskInput {
  userId: string;
  strategyId?: string;
  pipelineRunId: string;
  symbol: string;
  decision: DecisionOutput;
  account: {
    balance: Prisma.Decimal;
    equity: Prisma.Decimal;
    peakEquity: Prisma.Decimal;
  };
  positions: Array<{
    symbol: string;
    size: Prisma.Decimal;
    markPrice: Prisma.Decimal;
  }>;
  price: number;
  volatility: number;
  lastTradeAt?: Date;
}

@Injectable()
export class RiskManagementService {
  private readonly logger = new Logger(RiskManagementService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RiskConfigService,
    private readonly environment: ConfigService,
  ) {}

  async assess(tx: Tx, input: AssessRiskInput): Promise<RiskOutput> {
    const existing = await tx.riskAssessment.findUnique({
      where: { pipelineRunId: input.pipelineRunId },
    });
    if (existing) return this.output(existing);
    const evaluation = evaluateRisk(
      {
        symbol: input.symbol,
        decision: input.decision,
        account: {
          balance: Number(input.account.balance),
          equity: Number(input.account.equity),
          peakEquity: Number(input.account.peakEquity),
        },
        currentPositions: input.positions.map((position): RiskPosition => ({
          symbol: position.symbol,
          size: Number(position.size),
          markPrice: Number(position.markPrice),
        })),
        marketData: { price: input.price, volatility: input.volatility },
        lastTradeAt: input.lastTradeAt,
      },
      this.config.values,
    );
    const row = await tx.riskAssessment.upsert({
      where: { pipelineRunId: input.pipelineRunId },
      update: {
        userId: input.userId,
        strategyId: input.strategyId,
        symbol: input.symbol,
        decision: input.decision.decision,
        confidence: input.decision.confidence,
        approved: evaluation.approved,
        reason: evaluation.reason,
        positionSize: evaluation.positionSize,
        leverage: evaluation.leverage,
        stopLoss: evaluation.stopLoss,
        takeProfit: evaluation.takeProfit,
        riskScore: evaluation.riskScore,
        referencePrice: input.price,
        volatility: input.volatility,
        exposurePct: evaluation.exposurePct,
        drawdownPct: evaluation.drawdownPct,
      },
      create: {
        userId: input.userId,
        strategyId: input.strategyId,
        pipelineRunId: input.pipelineRunId,
        symbol: input.symbol,
        decision: input.decision.decision,
        confidence: input.decision.confidence,
        approved: evaluation.approved,
        reason: evaluation.reason,
        positionSize: evaluation.positionSize,
        leverage: evaluation.leverage,
        stopLoss: evaluation.stopLoss,
        takeProfit: evaluation.takeProfit,
        riskScore: evaluation.riskScore,
        referencePrice: input.price,
        volatility: input.volatility,
        exposurePct: evaluation.exposurePct,
        drawdownPct: evaluation.drawdownPct,
      },
    });
    this.logger.log({
      event: "trade_risk_assessed",
      runId: input.pipelineRunId,
      symbol: input.symbol,
      approved: evaluation.approved,
      reason: evaluation.reason,
      riskScore: evaluation.riskScore,
    });
    if (!evaluation.approved) {
      this.logger.warn({
        event: "trade_risk_rejected",
        runId: input.pipelineRunId,
        symbol: input.symbol,
        reason: evaluation.reason,
      });
    }
    return this.output(row);
  }

  async dashboard(userId: string) {
    const limits = this.config.values;
    const mode =
      this.environment.get<"DEMO" | "LIVE">("TRADING_MODE") ?? "DEMO";
    const environments =
      mode === "LIVE"
        ? [PrismaExchangeEnvironment.PRODUCTION]
        : [PrismaExchangeEnvironment.DEMO, PrismaExchangeEnvironment.TESTNET];
    const connections = await this.prisma.exchangeConnection.findMany({
      where: {
        userId,
        isEnabled: true,
        isVerified: true,
        environment: { in: environments },
      },
      select: { id: true },
    });
    const connectionIds = connections.map((item) => item.id);
    const [positions, snapshots, assessments] = await Promise.all([
      this.prisma.livePosition.findMany({
        where: { userId, connectionId: { in: connectionIds } },
      }),
      this.prisma.liveAccountSnapshot.findMany({
        where: { userId, connectionId: { in: connectionIds } },
        orderBy: { syncedAt: "desc" },
        take: 5_000,
      }),
      this.prisma.riskAssessment.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const latest = [
      ...new Map(snapshots.map((item) => [item.connectionId, item])).values(),
    ];
    const peaks = new Map<string, number>();
    for (const snapshot of snapshots)
      peaks.set(
        snapshot.connectionId,
        Math.max(
          peaks.get(snapshot.connectionId) ?? 0,
          Number(snapshot.totalEquity),
        ),
      );
    const exposure = positions.reduce(
      (sum, position) =>
        sum +
        Math.abs(
          Number(
            position.notional ??
              Number(position.quantity) *
                Number(position.markPrice ?? position.entryPrice),
          ),
        ),
      0,
    );
    const equity = latest.reduce(
      (sum, item) => sum + Number(item.totalEquity),
      0,
    );
    const peakEquity = [...peaks.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const drawdown =
      peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity) : 1;
    return {
      config: {
        riskPerTrade: limits.riskPerTrade,
        maxPositions: limits.maxPositions,
        maxLeverage: limits.maxLeverage,
        maxDrawdown: limits.maxDrawdown,
        maxExposure: limits.maxExposure,
        cooldownMs: limits.cooldownMs,
      },
      portfolio: {
        source: "EXCHANGE",
        available: latest.length > 0,
        syncedAt: latest[0]?.syncedAt.toISOString() ?? null,
        balance: equity,
        equity,
        peakEquity,
        openPositions: positions.length,
        exposure: rounded(exposure),
        exposurePct: rounded(equity > 0 ? exposure / equity : 1, 6),
        drawdownPct: rounded(drawdown, 6),
      },
      assessments: assessments.map((row) => ({
        id: row.id,
        pipelineRunId: row.pipelineRunId,
        symbol: row.symbol,
        decision: row.decision,
        confidence: row.confidence,
        ...this.output(row),
        referencePrice: Number(row.referencePrice),
        volatility: row.volatility,
        exposurePct: row.exposurePct,
        drawdownPct: row.drawdownPct,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private output(row: {
    approved: boolean;
    reason: string | null;
    positionSize: Prisma.Decimal | null;
    leverage: number | null;
    stopLoss: Prisma.Decimal | null;
    takeProfit: Prisma.Decimal | null;
    riskScore: number;
  }): RiskOutput {
    return {
      approved: row.approved,
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.positionSize ? { positionSize: Number(row.positionSize) } : {}),
      ...(row.leverage ? { leverage: row.leverage } : {}),
      ...(row.stopLoss ? { stopLoss: Number(row.stopLoss) } : {}),
      ...(row.takeProfit ? { takeProfit: Number(row.takeProfit) } : {}),
      riskScore: row.riskScore,
    };
  }
}

function rounded(value: number, digits = 8): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
