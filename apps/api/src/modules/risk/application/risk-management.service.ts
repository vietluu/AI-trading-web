import { Injectable, Logger, Optional } from "@nestjs/common";
import type { DecisionOutput, RiskOutput } from "@platform/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { ExchangeConnectionService } from "../../../exchange/application/exchange-connection.service";
import { evaluateRisk, type RiskPosition } from "../domain/risk-engine";
import type { TradePlanMarketContext } from "../domain/trade-plan-engine";
import { RiskConfigService } from "./risk-config.service";

type Tx = Prisma.TransactionClient;

export interface AssessRiskInput {
  userId: string;
  connectionId?: string;
  strategyId?: string;
  pipelineRunId: string;
  symbol: string;
  decision: DecisionOutput;
  account: {
    balance: Prisma.Decimal;
    equity: Prisma.Decimal;
    peakEquity: Prisma.Decimal;
    availableBalance?: Prisma.Decimal;
  };
  positions: Array<{
    symbol: string;
    side?: "LONG" | "SHORT";
    size: Prisma.Decimal;
    markPrice: Prisma.Decimal;
  }>;
  price: number;
  volatility: number;
  tradePlanContext?: TradePlanMarketContext;
  lastTradeAt?: Date;
  recentClosedTrades?: Array<{ netPnl: Prisma.Decimal; closedAt: Date }>;
}

import { DataRetentionService } from "../../system/data-retention.service";

@Injectable()
export class RiskManagementService {
  private readonly logger = new Logger(RiskManagementService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RiskConfigService,
    @Optional() private readonly connections?: ExchangeConnectionService,
    @Optional() private readonly retention?: DataRetentionService,
  ) {}

  async assess(tx: Tx, input: AssessRiskInput): Promise<RiskOutput> {
    const existing = await tx.riskAssessment.findUnique({
      where: { pipelineRunId: input.pipelineRunId },
    });
    if (existing) return this.output(existing);
    const userLimits = await this.config.getUserLimits(input.userId);
    const evaluation = evaluateRisk(
      {
        symbol: input.symbol,
        decision: input.decision,
        account: {
          balance: Number(input.account.balance),
          equity: Number(input.account.equity),
          peakEquity: Number(input.account.peakEquity),
          ...(input.account.availableBalance !== undefined
            ? { availableBalance: Number(input.account.availableBalance) }
            : {}),
        },
        currentPositions: input.positions.map((position): RiskPosition => ({
          symbol: position.symbol,
          side: position.side,
          size: Number(position.size),
          markPrice: Number(position.markPrice),
        })),
        marketData: {
          price: input.price,
          volatility: input.volatility,
          tradePlanContext: input.tradePlanContext,
        },
        lastTradeAt: input.lastTradeAt,
        recentClosedTrades: input.recentClosedTrades?.map((trade) => ({
          netPnl: Number(trade.netPnl),
          closedAt: trade.closedAt,
        })),
      },
      userLimits,
    );
    const safeFloat = (val: unknown, fallback = 0): number =>
      typeof val === "number" && Number.isFinite(val) ? val : fallback;
    const safeFloatOrNull = (val: unknown): number | null =>
      typeof val === "number" && Number.isFinite(val) ? val : null;
    const safeUuid = (val?: string | null): string | null =>
      val && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val) ? val : null;

    const sanitizedStrategyId = safeUuid(input.strategyId);
    const sanitizedRiskScore = safeFloat(evaluation.riskScore, 50);
    const sanitizedRefPrice = safeFloat(input.price, 0);
    const sanitizedVolatility = safeFloat(input.volatility, 0);
    const sanitizedExposurePct = safeFloat(evaluation.exposurePct, 0);
    const sanitizedDrawdownPct = safeFloat(evaluation.drawdownPct, 0);

    const sanitizedConnectionId = safeUuid(input.connectionId);
    const tradePlan = evaluation.tradePlan
      ? (evaluation.tradePlan as unknown as Prisma.InputJsonObject)
      : Prisma.JsonNull;

    const row = await tx.riskAssessment.upsert({
      where: { pipelineRunId: input.pipelineRunId },
      update: {
        userId: input.userId,
        connectionId: sanitizedConnectionId,
        strategyId: sanitizedStrategyId,
        symbol: input.symbol,
        decision: input.decision.decision,
        confidence: safeFloat(input.decision.confidence, 0),
        approved: evaluation.approved,
        reason: evaluation.reason ?? null,
        positionSize: safeFloatOrNull(evaluation.positionSize),
        leverage: evaluation.leverage ? Math.round(safeFloat(evaluation.leverage, 1)) : null,
        stopLoss: safeFloatOrNull(evaluation.stopLoss),
        takeProfit: safeFloatOrNull(evaluation.takeProfit),
        riskScore: sanitizedRiskScore,
        referencePrice: sanitizedRefPrice,
        volatility: sanitizedVolatility,
        exposurePct: sanitizedExposurePct,
        drawdownPct: sanitizedDrawdownPct,
        tradePlan,
      },
      create: {
        userId: input.userId,
        connectionId: sanitizedConnectionId,
        strategyId: sanitizedStrategyId,
        pipelineRunId: input.pipelineRunId,
        symbol: input.symbol,
        decision: input.decision.decision,
        confidence: safeFloat(input.decision.confidence, 0),
        approved: evaluation.approved,
        reason: evaluation.reason ?? null,
        positionSize: safeFloatOrNull(evaluation.positionSize),
        leverage: evaluation.leverage ? Math.round(safeFloat(evaluation.leverage, 1)) : null,
        stopLoss: safeFloatOrNull(evaluation.stopLoss),
        takeProfit: safeFloatOrNull(evaluation.takeProfit),
        riskScore: sanitizedRiskScore,
        referencePrice: sanitizedRefPrice,
        volatility: sanitizedVolatility,
        exposurePct: sanitizedExposurePct,
        drawdownPct: sanitizedDrawdownPct,
        tradePlan,
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

  private async syncActiveConnections(userId: string): Promise<void> {
    if (!this.connections) return;
    try {
      const activeConnections = await this.prisma.exchangeConnection.findMany({
        where: {
          userId,
          isEnabled: true,
          isVerified: true,
        },
      });
      await Promise.allSettled(
        activeConnections.map(async (conn) => {
          const [account, positions] = await Promise.all([
            this.connections!.account(userId, conn.id, {}),
            this.connections!.positions(userId, conn.id, {}),
          ]);
          const totalEquity = Number(account.totalEquity);
          if (!Number.isFinite(totalEquity) || totalEquity <= 0) {
            this.logger.warn({
              event: "exchange_account_snapshot_skipped",
              connectionId: conn.id,
              provider: conn.provider,
              reason: "invalid_or_zero_total_equity",
              totalEquity: account.totalEquity,
            });
            return;
          }
          const syncedAt = new Date();
          await this.prisma.$transaction(async (tx) => {
            await tx.liveAccountSnapshot.create({
              data: {
                userId,
                connectionId: conn.id,
                provider: conn.provider,
                environment: conn.environment,
                totalEquity: account.totalEquity,
                availableBalance: account.availableBalance,
                unrealizedPnl: account.totalUnrealizedPnl,
                marginBalance: account.totalMarginBalance,
                syncedAt,
              },
            });
            const activeSymbolSides = new Set(
              positions
                .filter((pos) => Number(pos.quantity) > 0)
                .map((pos) => `${pos.symbol}:${pos.side}`),
            );
            for (const pos of positions) {
              if (Number(pos.quantity) <= 0) continue;
              await tx.livePosition.upsert({
                where: {
                  connectionId_symbol_side: {
                    connectionId: conn.id,
                    symbol: pos.symbol,
                    side: pos.side,
                  },
                },
                update: {
                  quantity: pos.quantity,
                  entryPrice: pos.entryPrice,
                  markPrice: pos.markPrice,
                  liquidationPrice: pos.liquidationPrice,
                  leverage: pos.leverage ? Number(pos.leverage) : undefined,
                  unrealizedPnl: pos.unrealizedPnl,
                  realizedPnl: pos.realizedPnl,
                  notional: pos.notional,
                  syncedAt,
                },
                create: {
                  userId,
                  connectionId: conn.id,
                  provider: conn.provider,
                  environment: conn.environment,
                  symbol: pos.symbol,
                  side: pos.side,
                  quantity: pos.quantity,
                  entryPrice: pos.entryPrice,
                  markPrice: pos.markPrice,
                  liquidationPrice: pos.liquidationPrice,
                  leverage: pos.leverage ? Number(pos.leverage) : undefined,
                  unrealizedPnl: pos.unrealizedPnl,
                  realizedPnl: pos.realizedPnl,
                  notional: pos.notional,
                  syncedAt,
                },
              });
            }
            const currentPositions = await tx.livePosition.findMany({
              where: { connectionId: conn.id },
            });
            for (const cp of currentPositions) {
              if (!activeSymbolSides.has(`${cp.symbol}:${cp.side}`)) {
                await tx.livePosition.delete({ where: { id: cp.id } });
              }
            }
          });
        }),
      );
    } catch {
      // Fallback silently if exchange API is offline
    }
  }

  async dashboard(userId: string) {
    await this.syncActiveConnections(userId);
    const limits = await this.config.getUserLimits(userId);
    const userSetting = await this.prisma.userSetting.findUnique({
      where: { userId },
      select: { riskPreference: true },
    });
    const connections = await this.prisma.exchangeConnection.findMany({
      where: {
        userId,
        isEnabled: true,
        isVerified: true,
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
    const now = Date.now();
    const STALE_TTL_MS = 10 * 60 * 1000;
    const freshSnapshots = snapshots.filter(
      (s) => !s.syncedAt || now - new Date(s.syncedAt).getTime() < STALE_TTL_MS,
    );
    const freshPositions = positions.filter(
      (p) => !p.syncedAt || now - new Date(p.syncedAt).getTime() < STALE_TTL_MS,
    );
    const validFreshSnapshots = freshSnapshots.filter(
      (snapshot) => Number.isFinite(Number(snapshot.totalEquity)) && Number(snapshot.totalEquity) > 0,
    );
    const latestMap = new Map<string, (typeof validFreshSnapshots)[number]>();
    for (const snapshot of validFreshSnapshots) {
      if (!latestMap.has(snapshot.connectionId)) {
        latestMap.set(snapshot.connectionId, snapshot);
      }
    }
    const latest = Array.from(latestMap.values());
    const peaks = new Map<string, number>();
    for (const snapshot of snapshots) {
      const value = Number(snapshot.totalEquity);
      if (!Number.isFinite(value) || value <= 0) continue;
      peaks.set(
        snapshot.connectionId,
        Math.max(
          peaks.get(snapshot.connectionId) ?? 0,
          value,
        ),
      );
    }
    const exposure = freshPositions.reduce(
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
    const balance = latest.reduce(
      (sum, item) => sum + Number(item.availableBalance),
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
      peakEquity > 0 && equity > 0
        ? Math.max(0, (peakEquity - equity) / peakEquity)
        : 0;
    return {
      config: {
        riskPreference: userSetting?.riskPreference ?? "UNKNOWN",
        riskPerTrade: limits.riskPerTrade,
        maxPositions: limits.maxPositions,
        maxSameDirectionPositions: limits.maxSameDirectionPositions ?? 1,
        maxLeverage: limits.maxLeverage,
        maxDrawdown: limits.maxDrawdown,
        maxExposure: limits.maxExposure,
        cooldownMs: limits.cooldownMs,
        maxStopLossRoe: limits.maxStopLossRoe,
        rangeScalpRoeMultiplier: limits.rangeScalpRoeMultiplier,
        minLiquidationBufferPct: limits.minLiquidationBufferPct,
      },
      portfolio: {
        source: "EXCHANGE",
        available: latest.length > 0,
        syncedAt: latest[0]?.syncedAt.toISOString() ?? null,
        balance: rounded(balance),
        equity: rounded(equity),
        peakEquity: rounded(Math.max(peakEquity, equity)),
        openPositions: freshPositions.length,
        exposure: rounded(exposure),
        exposurePct: rounded(equity > 0 ? exposure / equity : 0, 6),
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
