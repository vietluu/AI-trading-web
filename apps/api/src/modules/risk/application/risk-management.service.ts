import { Injectable, Logger } from "@nestjs/common";
import type { DecisionOutput, RiskOutput } from "@platform/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { round } from "../../paper-trading/domain/paper-trading";
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
    const row = await tx.riskAssessment.create({
      data: {
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
    return this.output(row);
  }

  async dashboard(userId: string) {
    const limits = this.config.values;
    const account = await this.prisma.paperAccount.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        balance: limits.initialBalance,
        equity: limits.initialBalance,
        peakEquity: limits.initialBalance,
      },
    });
    const [positions, assessments] = await Promise.all([
      this.prisma.paperPosition.findMany({ where: { accountId: account.id } }),
      this.prisma.riskAssessment.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const exposure = positions.reduce(
      (sum, position) =>
        sum + Math.abs(Number(position.size) * Number(position.markPrice)),
      0,
    );
    const equity = Number(account.equity);
    const drawdown =
      Number(account.peakEquity) > 0
        ? Math.max(
            0,
            (Number(account.peakEquity) - equity) / Number(account.peakEquity),
          )
        : 1;
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
        balance: Number(account.balance),
        equity,
        peakEquity: Number(account.peakEquity),
        openPositions: positions.length,
        exposure: round(exposure),
        exposurePct: round(equity > 0 ? exposure / equity : 1, 6),
        drawdownPct: round(drawdown, 6),
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
