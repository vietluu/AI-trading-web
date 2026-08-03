import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { DecisionOutput, RiskOutput } from "@platform/shared";
import { AuditService } from "../../../audit/audit.service";
import type { RequestMetadata } from "../../../common/request-context";
import { PrismaService } from "../../../database/prisma.service";
import { ExchangeConnectionService } from "../../../exchange/application/exchange-connection.service";
import { PublicExchangeService } from "../../../exchange/application/public-exchange.service";
import {
  ExchangeEnvironment,
  ExchangeProvider,
  type ExchangePosition,
  type OrderSide,
} from "../../../exchange/domain/exchange.types";
import { ExchangeError } from "../../../exchange/domain/exchange.error";
import { LiveTradingConfigService } from "./live-trading-config.service";
import type {
  CloseApprovedPositionDto,
  ExecuteApprovedOrderDto,
} from "./live-trading.dto";
import { RiskConfigService } from "../../risk/application/risk-config.service";
import { RiskManagementService } from "../../risk/application/risk-management.service";
import { PortfolioService } from "../../portfolio/application/portfolio.service";

@Injectable()
export class LiveTradingService {
  private readonly logger = new Logger(LiveTradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ExchangeConnectionService,
    private readonly config: LiveTradingConfigService,
    private readonly audit: AuditService,
    private readonly riskConfig: RiskConfigService,
    private readonly risk: RiskManagementService,
    private readonly portfolio: PortfolioService,
    private readonly publicExchanges: PublicExchangeService,
  ) {}

  /** Build the execution approval exclusively from synchronized exchange data. */
  async assessPipelineDecision(input: {
    userId: string;
    pipelineRunId: string;
    symbol: string;
    provider: ExchangeProvider;
    decision: DecisionOutput;
    volatilityAtr?: number;
    strategyKey?: string;
  }): Promise<{ outcome: string; price: number; risk?: RiskOutput }> {
    const settings = this.config.values;
    if (settings.mode !== "DEMO" && settings.mode !== "LIVE") {
      return { outcome: "EXCHANGE_MODE_REQUIRED", price: 0 };
    }
    const targetEnvironment =
      settings.mode === "LIVE"
        ? ExchangeEnvironment.PRODUCTION
        : input.provider === ExchangeProvider.BINANCE_FUTURES
          ? ExchangeEnvironment.TESTNET
          : ExchangeEnvironment.DEMO;
    const connection = (await this.connections.list(input.userId)).find(
      (item) =>
        item.provider === input.provider &&
        item.environment === targetEnvironment &&
        item.isEnabled &&
        item.isVerified,
    );
    if (!connection)
      return { outcome: "NO_ELIGIBLE_EXCHANGE_CONNECTION", price: 0 };

    await this.sync(input.userId, connection.id, {});
    const ticker = await this.publicExchanges.ticker(
      input.provider,
      input.symbol,
    );
    const price = Number(ticker.markPrice ?? ticker.lastPrice);
    if (!Number.isFinite(price) || price <= 0)
      throw new Error("INVALID_EXCHANGE_MARK_PRICE");
    const strategy = await this.portfolio.prepareStrategy(
      input.userId,
      input.strategyKey ?? "ai-core",
    );

    const result = await this.prisma.$transaction(
      async (tx) => {
        const [snapshot, peak, positions, latestOrder] = await Promise.all([
          tx.liveAccountSnapshot.findFirst({
            where: { userId: input.userId, connectionId: connection.id },
            orderBy: { syncedAt: "desc" },
          }),
          tx.liveAccountSnapshot.aggregate({
            where: { userId: input.userId, connectionId: connection.id },
            _max: { totalEquity: true },
          }),
          tx.livePosition.findMany({
            where: { userId: input.userId, connectionId: connection.id },
          }),
          tx.liveOrder.findFirst({
            where: {
              userId: input.userId,
              connectionId: connection.id,
              purpose: { in: ["OPEN", "REVERSE"] },
              status: { not: "FAILED" },
            },
            orderBy: { createdAt: "desc" },
          }),
        ]);
        if (!snapshot) throw new Error("EXCHANGE_ACCOUNT_SNAPSHOT_UNAVAILABLE");
        let risk = await this.risk.assess(tx, {
          userId: input.userId,
          strategyId: strategy.id,
          pipelineRunId: input.pipelineRunId,
          symbol: input.symbol,
          decision: input.decision,
          account: {
            balance: snapshot.totalEquity,
            equity: snapshot.totalEquity,
            peakEquity: peak._max.totalEquity ?? snapshot.totalEquity,
          },
          positions: positions.map((position) => ({
            symbol: position.symbol,
            size: position.quantity,
            markPrice: position.markPrice ?? position.entryPrice,
          })),
          price,
          volatility: Math.max(
            0,
            Number.isFinite(input.volatilityAtr)
              ? (input.volatilityAtr ?? 0) / price
              : 0,
          ),
          lastTradeAt: latestOrder?.createdAt,
        });
        if (
          risk.approved &&
          risk.positionSize &&
          input.decision.decision !== "WAIT"
        ) {
          const portfolioRisk = await this.portfolio.assessTrade(tx, {
            userId: input.userId,
            strategyId: strategy.id,
            pipelineRunId: input.pipelineRunId,
            symbol: input.symbol,
            side: input.decision.decision,
            requestedNotional: risk.positionSize * price,
            equity: Number(snapshot.totalEquity),
            peakEquity: Number(peak._max.totalEquity ?? snapshot.totalEquity),
          });
          if (!portfolioRisk.approved) {
            risk = {
              approved: false,
              reason: portfolioRisk.reason ?? "PORTFOLIO_RISK_REJECTED",
              riskScore: risk.riskScore,
            };
            await tx.riskAssessment.update({
              where: { pipelineRunId: input.pipelineRunId },
              data: {
                approved: false,
                reason: risk.reason,
                positionSize: null,
                leverage: null,
                stopLoss: null,
                takeProfit: null,
              },
            });
          } else if (
            portfolioRisk.approvedNotional <
            risk.positionSize * price
          ) {
            const positionSize =
              Math.round((portfolioRisk.approvedNotional / price) * 1e12) /
              1e12;
            risk = { ...risk, positionSize };
            await tx.riskAssessment.update({
              where: { pipelineRunId: input.pipelineRunId },
              data: { positionSize },
            });
          }
        }
        return risk;
      },
      { isolationLevel: "Serializable" },
    );
    return {
      outcome: result.approved ? "RISK_APPROVED" : "RISK_REJECTED",
      price,
      risk: result,
    };
  }

  async execute(
    userId: string,
    dto: ExecuteApprovedOrderDto,
    context: RequestMetadata,
  ) {
    const connection = await this.connections.get(userId, dto.connectionId);
    this.config.assertExecutionAllowed(connection.environment);
    if (!connection.isEnabled || !connection.isVerified) {
      throw new ForbiddenException(
        "Exchange connection must be enabled and verified",
      );
    }
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: { id: dto.riskAssessmentId, userId },
    });
    if (!assessment) throw new NotFoundException("Risk assessment not found");
    if (
      !assessment.approved ||
      !assessment.positionSize ||
      !assessment.leverage ||
      assessment.decision === "WAIT"
    ) {
      throw new ForbiddenException(
        "Order blocked: risk assessment is not approved for execution",
      );
    }
    if (
      Date.now() - assessment.createdAt.getTime() >
      this.config.values.approvalTtlMs
    ) {
      throw new ForbiddenException("Order blocked: risk approval has expired");
    }
    const existingApproval = await this.prisma.liveOrder.findUnique({
      where: { riskAssessmentId: assessment.id },
    });
    if (existingApproval)
      throw new ConflictException("Risk approval has already been consumed");
    const last = await this.prisma.liveOrder.findFirst({
      where: {
        userId,
        connectionId: dto.connectionId,
        status: { not: "FAILED" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      last &&
      Date.now() - last.createdAt.getTime() < this.config.values.cooldownMs
    ) {
      throw new ConflictException("Trade cooldown is active");
    }

    await this.sync(userId, dto.connectionId, context);
    const positions = await this.prisma.livePosition.findMany({
      where: {
        userId,
        connectionId: dto.connectionId,
        symbol: assessment.symbol,
      },
    });
    await this.assertExchangePortfolioRisk(
      userId,
      dto.connectionId,
      assessment,
    );
    const desiredSide = assessment.decision as "LONG" | "SHORT";
    const same = positions.find((position) => position.side === desiredSide);
    if (same)
      throw new ConflictException(
        "A position already exists in the approved direction",
      );
    const opposite = positions.find(
      (position) => position.side !== desiredSide,
    );
    const configuration = await this.connections.configuration(
      userId,
      dto.connectionId,
      context,
    );
    if (opposite) {
      await this.submit(
        userId,
        connection,
        {
          symbol: assessment.symbol,
          side: desiredSide === "LONG" ? "BUY" : "SELL",
          quantity: String(opposite.quantity),
          leverage: opposite.leverage ?? assessment.leverage,
          clientOrderId: this.derivedId(dto.clientOrderId, "close"),
          reduceOnly: true,
          ...(configuration.positionMode === "HEDGE"
            ? { positionSide: opposite.side as "LONG" | "SHORT" }
            : {}),
        },
        "REVERSE",
        null,
        opposite.strategyId,
        context,
      );
    }

    const side: OrderSide = desiredSide === "LONG" ? "BUY" : "SELL";
    const result = await this.submit(
      userId,
      connection,
      {
        symbol: assessment.symbol,
        side,
        quantity: String(assessment.positionSize),
        leverage: assessment.leverage,
        clientOrderId: dto.clientOrderId,
        ...(configuration.positionMode === "HEDGE"
          ? { positionSide: desiredSide }
          : {}),
        ...(assessment.stopLoss
          ? { stopLoss: String(assessment.stopLoss) }
          : {}),
        ...(assessment.takeProfit
          ? { takeProfit: String(assessment.takeProfit) }
          : {}),
      },
      opposite ? "REVERSE" : "OPEN",
      assessment,
      assessment.strategyId,
      context,
    );
    await this.sync(userId, dto.connectionId, context).catch((error) =>
      this.logger.warn({
        event: "post_order_sync_failed",
        orderId: result.id,
        error: this.safeError(error),
      }),
    );
    return result;
  }

  async executePipeline(userId: string, pipelineRunId: string) {
    const settings = this.config.values;
    if (!settings.runtimeEnabled) return { outcome: "KILL_SWITCH_ACTIVE" };
    if (settings.mode !== "DEMO" && settings.mode !== "LIVE")
      return { outcome: "EXECUTION_MODE_INACTIVE" };
    const [assessment, run] = await Promise.all([
      this.prisma.riskAssessment.findUnique({ where: { pipelineRunId } }),
      this.prisma.pipelineRun.findUnique({
        where: { id: pipelineRunId },
        select: { provider: true },
      }),
    ]);
    if (!assessment || assessment.userId !== userId)
      return { outcome: "RISK_ASSESSMENT_MISSING" };
    if (!assessment.approved)
      return { outcome: "RISK_REJECTED", reason: assessment.reason };
    const demoEnvironment: Record<ExchangeProvider, ExchangeEnvironment> = {
      [ExchangeProvider.BINANCE_FUTURES]: ExchangeEnvironment.TESTNET,
      [ExchangeProvider.OKX_FUTURES]: ExchangeEnvironment.DEMO,
    };
    const connections = await this.connections.list(userId);
    const connection = connections.find(
      (item) =>
        item.isEnabled &&
        item.isVerified &&
        item.provider === run?.provider &&
        item.environment ===
          (settings.mode === "LIVE"
            ? ExchangeEnvironment.PRODUCTION
            : demoEnvironment[item.provider]),
    );
    if (!connection) return { outcome: "NO_ELIGIBLE_EXCHANGE_CONNECTION" };
    const clientOrderId = `p9-${pipelineRunId.replaceAll("-", "").slice(0, 32)}`;
    try {
      const order = await this.execute(
        userId,
        {
          connectionId: connection.id,
          riskAssessmentId: assessment.id,
          clientOrderId,
        },
        {},
      );
      return { outcome: "ORDER_SUBMITTED", order };
    } catch (error) {
      const safe = this.safeError(error);
      this.logger.error({
        event: "pipeline_order_failed",
        pipelineRunId,
        errorCode: safe.code,
      });
      return { outcome: "EXECUTION_FAILED", errorCode: safe.code };
    }
  }

  async close(
    userId: string,
    dto: CloseApprovedPositionDto,
    context: RequestMetadata,
  ) {
    const connection = await this.connections.get(userId, dto.connectionId);
    this.config.assertExecutionAllowed(connection.environment);
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: {
        id: dto.riskAssessmentId,
        userId,
        symbol: dto.symbol,
        approved: true,
      },
    });
    if (!assessment || assessment.decision === "WAIT" || !assessment.leverage) {
      throw new ForbiddenException(
        "Position close requires an approved directional risk assessment",
      );
    }
    if (
      Date.now() - assessment.createdAt.getTime() >
      this.config.values.approvalTtlMs
    ) {
      throw new ForbiddenException("Order blocked: risk approval has expired");
    }
    await this.sync(userId, dto.connectionId, context);
    const position = await this.prisma.livePosition.findFirst({
      where: { userId, connectionId: dto.connectionId, symbol: dto.symbol },
    });
    if (!position) throw new NotFoundException("Open position not found");
    if (assessment.decision === position.side) {
      throw new ForbiddenException(
        "Close approval must point opposite to the current position",
      );
    }
    const configuration = await this.connections.configuration(
      userId,
      dto.connectionId,
      context,
    );
    const result = await this.submit(
      userId,
      connection,
      {
        symbol: position.symbol,
        side: position.side === "LONG" ? "SELL" : "BUY",
        quantity: String(position.quantity),
        leverage: position.leverage ?? assessment.leverage,
        clientOrderId: dto.clientOrderId,
        reduceOnly: true,
        ...(configuration.positionMode === "HEDGE"
          ? { positionSide: position.side as "LONG" | "SHORT" }
          : {}),
      },
      "CLOSE",
      assessment,
      position.strategyId ?? assessment.strategyId,
      context,
    );
    await this.sync(userId, dto.connectionId, context).catch(() => undefined);
    return result;
  }

  async cancel(userId: string, localOrderId: string, context: RequestMetadata) {
    const row = await this.prisma.liveOrder.findFirst({
      where: { id: localOrderId, userId },
    });
    if (!row) throw new NotFoundException("Order not found");
    if (!row.exchangeOrderId)
      throw new ConflictException("Order has no exchange identifier");
    const connection = await this.connections.get(userId, row.connectionId);
    const order = await this.connections.cancelOrder(
      userId,
      row.connectionId,
      {
        symbol: row.symbol,
        orderId: row.exchangeOrderId,
        clientOrderId: row.clientOrderId,
      },
      context,
    );
    const updated = await this.prisma.liveOrder.update({
      where: { id: row.id },
      data: { status: order.status },
    });
    await this.audit.record("LIVE_ORDER_CANCELLED", userId, context, {
      orderId: row.id,
      exchangeOrderId: row.exchangeOrderId,
      connectionId: connection.id,
    });
    return this.orderView(updated);
  }

  async sync(userId: string, connectionId: string, context: RequestMetadata) {
    const connection = await this.connections.get(userId, connectionId);
    const previousSnapshot = await this.prisma.liveAccountSnapshot.findFirst({
      where: { userId, connectionId },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    });
    const historyDue =
      !previousSnapshot ||
      Date.now() - previousSnapshot.syncedAt.getTime() >= 300_000;
    const [account, positions, openOrders, orderHistory] = await Promise.all([
      this.connections.account(userId, connectionId, context),
      this.connections.positions(userId, connectionId, context),
      this.connections.openOrders(userId, connectionId, context),
      historyDue
        ? this.connections.orderHistory(userId, connectionId, context)
        : Promise.resolve([]),
    ]);
    const syncedAt = new Date();
    const [previousPositions, ownershipOrders] = await Promise.all([
      this.prisma.livePosition.findMany({ where: { userId, connectionId } }),
      this.prisma.liveOrder.findMany({
        where: {
          userId,
          connectionId,
          strategyId: { not: null },
          purpose: { in: ["OPEN", "REVERSE"] },
          status: { not: "FAILED" },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    await this.prisma.$transaction(async (tx) => {
      await tx.livePosition.deleteMany({ where: { userId, connectionId } });
      if (positions.length) {
        await tx.livePosition.createMany({
          data: positions.map((position) => {
            const previous = previousPositions.find(
              (item) =>
                item.symbol === position.symbol && item.side === position.side,
            );
            const source = ownershipOrders.find(
              (item) =>
                item.symbol === position.symbol &&
                (item.side === "BUY" ? "LONG" : "SHORT") === position.side,
            );
            return this.positionData(
              userId,
              connectionId,
              connection.environment,
              position,
              syncedAt,
              previous?.strategyId ?? source?.strategyId,
            );
          }),
        });
      }
      await tx.liveAccountSnapshot.create({
        data: {
          userId,
          connectionId,
          provider: connection.provider,
          environment: connection.environment,
          totalEquity: account.totalEquity,
          availableBalance: account.availableBalance,
          unrealizedPnl: account.totalUnrealizedPnl,
          marginBalance: account.totalMarginBalance,
          syncedAt,
        },
      });
      for (const order of openOrders) {
        await tx.liveOrder.updateMany({
          where: {
            connectionId,
            OR: [
              { exchangeOrderId: order.exchangeOrderId },
              ...(order.clientOrderId
                ? [{ clientOrderId: order.clientOrderId }]
                : []),
            ],
          },
          data: { status: order.status, averagePrice: order.averagePrice },
        });
      }
      for (const order of orderHistory) {
        const clientOrderId =
          order.clientOrderId || `external-${order.exchangeOrderId}`;
        const matched = await tx.liveOrder.updateMany({
          where: {
            connectionId,
            OR: [{ exchangeOrderId: order.exchangeOrderId }, { clientOrderId }],
          },
          data: {
            exchangeOrderId: order.exchangeOrderId,
            status: order.status,
            averagePrice: order.averagePrice,
            updatedAt: order.updatedAt ?? syncedAt,
          },
        });
        if (matched.count === 0) {
          await tx.liveOrder.create({
            data: {
              userId,
              connectionId,
              clientOrderId,
              exchangeOrderId: order.exchangeOrderId,
              provider: connection.provider,
              environment: connection.environment,
              symbol: order.symbol,
              side: order.side,
              type: order.type,
              quantity: order.originalQuantity,
              leverage: 1,
              averagePrice: order.averagePrice,
              status: order.status,
              purpose: "IMPORTED",
              reduceOnly: order.reduceOnly ?? false,
              createdAt: order.createdAt ?? syncedAt,
              updatedAt: order.updatedAt ?? syncedAt,
            },
          });
        }
      }
    });
    await this.monitorProtection(userId, connection, positions, context);
    this.logger.log({
      event: "live_state_synced",
      userId,
      connectionId,
      positionCount: positions.length,
      openOrderCount: openOrders.length,
    });
    return {
      syncedAt: syncedAt.toISOString(),
      positions: positions.length,
      openOrders: openOrders.length,
      importedOrders: orderHistory.length,
    };
  }

  async dashboard(userId: string, connectionId?: string) {
    const where = { userId, ...(connectionId ? { connectionId } : {}) };
    const connections = await this.connections.list(userId);
    const eligible = connections.filter(
      (item) =>
        item.isEnabled &&
        item.isVerified &&
        (!connectionId || item.id === connectionId),
    );
    await Promise.all(
      eligible.map((item) =>
        this.sync(userId, item.id, {}).catch((error: unknown) =>
          this.logger.warn({
            event: "dashboard_exchange_sync_failed",
            connectionId: item.id,
            error: this.safeError(error),
          }),
        ),
      ),
    );
    const [positions, orders, snapshots] = await Promise.all([
      this.prisma.livePosition.findMany({
        where,
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.liveOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.liveAccountSnapshot.findMany({
        where,
        orderBy: { syncedAt: "desc" },
        take: 100,
      }),
    ]);
    const latest = [
      ...new Map(snapshots.map((item) => [item.connectionId, item])).values(),
    ];
    return {
      mode: this.config.values.mode,
      globalTradingEnabled: this.config.values.runtimeEnabled,
      liveTradingEnabled: this.config.values.liveEnabled,
      connections,
      accounts: latest.map((row) => ({
        ...row,
        totalEquity: Number(row.totalEquity),
        availableBalance: Number(row.availableBalance),
        unrealizedPnl: Number(row.unrealizedPnl),
        marginBalance: Number(row.marginBalance),
        syncedAt: row.syncedAt.toISOString(),
      })),
      positions: positions.map((row) => ({
        ...row,
        quantity: Number(row.quantity),
        entryPrice: Number(row.entryPrice),
        markPrice: row.markPrice ? Number(row.markPrice) : null,
        liquidationPrice: row.liquidationPrice
          ? Number(row.liquidationPrice)
          : null,
        unrealizedPnl: Number(row.unrealizedPnl),
        realizedPnl: row.realizedPnl ? Number(row.realizedPnl) : null,
        notional: row.notional ? Number(row.notional) : null,
        syncedAt: row.syncedAt.toISOString(),
      })),
      orders: orders.map((row) => this.orderView(row)),
    };
  }

  async kill(userId: string, context: RequestMetadata) {
    this.config.kill();
    await this.audit.record("GLOBAL_TRADING_KILL_SWITCH", userId, context, {
      status: "DISABLED",
    });
    this.logger.error({ event: "global_trading_disabled", userId });
    return { globalTradingEnabled: false };
  }

  private async submit(
    userId: string,
    connection: Awaited<ReturnType<ExchangeConnectionService["get"]>>,
    command: Parameters<ExchangeConnectionService["placeOrder"]>[2],
    purpose: "OPEN" | "CLOSE" | "REVERSE" | "STOP_LOSS" | "TAKE_PROFIT",
    assessment: {
      id: string;
      stopLoss: Prisma.Decimal | null;
      takeProfit: Prisma.Decimal | null;
    } | null,
    strategyId: string | null | undefined,
    context: RequestMetadata,
  ) {
    let row;
    try {
      row = await this.prisma.liveOrder.create({
        data: {
          userId,
          connectionId: connection.id,
          riskAssessmentId: assessment?.id,
          strategyId,
          clientOrderId: command.clientOrderId,
          provider: connection.provider,
          environment: connection.environment,
          symbol: command.symbol,
          side: command.side,
          quantity: command.quantity,
          leverage: command.leverage,
          status: "SUBMITTING",
          purpose,
          reduceOnly: command.reduceOnly ?? false,
          stopLoss: assessment?.stopLoss,
          takeProfit: assessment?.takeProfit,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Duplicate order or consumed risk approval",
        );
      }
      throw error;
    }
    try {
      const order = await this.connections.placeOrder(
        userId,
        connection.id,
        command,
        context,
      );
      const updated = await this.prisma.liveOrder.update({
        where: { id: row.id },
        data: {
          exchangeOrderId: order.exchangeOrderId,
          averagePrice: order.averagePrice,
          status: order.status,
        },
      });
      await this.audit.record("LIVE_ORDER_EXECUTED", userId, context, {
        orderId: updated.id,
        exchangeOrderId: order.exchangeOrderId,
        connectionId: connection.id,
        symbol: command.symbol,
        side: command.side,
        purpose,
      });
      this.logger.log({
        event: "order_executed",
        orderId: updated.id,
        exchangeOrderId: order.exchangeOrderId,
        symbol: command.symbol,
        side: command.side,
        purpose,
      });
      return this.orderView(updated);
    } catch (error) {
      const safe = this.safeError(error);
      await this.prisma.liveOrder.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          errorCode: safe.code,
          errorMessage: safe.message,
        },
      });
      await this.audit.record("LIVE_ORDER_FAILED", userId, context, {
        orderId: row.id,
        connectionId: connection.id,
        symbol: command.symbol,
        errorCode: safe.code,
      });
      this.logger.error({
        event: "order_failed",
        orderId: row.id,
        symbol: command.symbol,
        errorCode: safe.code,
      });
      throw error;
    }
  }

  private positionData(
    userId: string,
    connectionId: string,
    environment: string,
    position: ExchangePosition,
    syncedAt: Date,
    strategyId?: string | null,
  ) {
    return {
      userId,
      connectionId,
      provider: position.provider,
      environment,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice,
      liquidationPrice: position.liquidationPrice,
      leverage: position.leverage ? Number(position.leverage) : undefined,
      unrealizedPnl: position.unrealizedPnl,
      realizedPnl: position.realizedPnl,
      notional: position.notional,
      strategyId,
      syncedAt,
    };
  }

  private async monitorProtection(
    userId: string,
    connection: Awaited<ReturnType<ExchangeConnectionService["get"]>>,
    positions: ExchangePosition[],
    context: RequestMetadata,
  ): Promise<void> {
    try {
      this.config.assertExecutionAllowed(connection.environment);
    } catch {
      return;
    }
    for (const position of positions) {
      const mark = Number(position.markPrice);
      const liquidation = Number(position.liquidationPrice);
      if (
        Number.isFinite(mark) &&
        mark > 0 &&
        Number.isFinite(liquidation) &&
        liquidation > 0
      ) {
        const distance = Math.abs(mark - liquidation) / mark;
        if (distance <= 0.05) {
          this.logger.error({
            event: "liquidation_risk",
            userId,
            connectionId: connection.id,
            symbol: position.symbol,
            distancePct: distance * 100,
          });
        }
      }
      // OKX receives attached TP/SL orders atomically with the entry. Binance
      // protection is monitored here and always submitted as reduce-only.
      if (
        position.provider !== ExchangeProvider.BINANCE_FUTURES ||
        !Number.isFinite(mark) ||
        mark <= 0
      )
        continue;
      const source = await this.prisma.liveOrder.findFirst({
        where: {
          userId,
          connectionId: connection.id,
          symbol: position.symbol,
          purpose: { in: ["OPEN", "REVERSE"] },
          status: { not: "FAILED" },
          OR: [{ stopLoss: { not: null } }, { takeProfit: { not: null } }],
        },
        orderBy: { createdAt: "desc" },
      });
      if (!source) continue;
      const stop = source.stopLoss ? Number(source.stopLoss) : undefined;
      const take = source.takeProfit ? Number(source.takeProfit) : undefined;
      const stopHit =
        stop !== undefined &&
        (position.side === "LONG" ? mark <= stop : mark >= stop);
      const takeHit =
        take !== undefined &&
        (position.side === "LONG" ? mark >= take : mark <= take);
      if (!stopHit && !takeHit) continue;
      const purpose = stopHit ? "STOP_LOSS" : "TAKE_PROFIT";
      const clientOrderId = this.derivedId(
        source.clientOrderId,
        stopHit ? "sl" : "tp",
      );
      const duplicate = await this.prisma.liveOrder.findUnique({
        where: {
          connectionId_clientOrderId: {
            connectionId: connection.id,
            clientOrderId,
          },
        },
      });
      if (duplicate) continue;
      const configuration = await this.connections.configuration(
        userId,
        connection.id,
        context,
      );
      await this.submit(
        userId,
        connection,
        {
          symbol: position.symbol,
          side: position.side === "LONG" ? "SELL" : "BUY",
          quantity: position.quantity,
          leverage: Number(position.leverage ?? source.leverage),
          clientOrderId,
          reduceOnly: true,
          ...(configuration.positionMode === "HEDGE"
            ? { positionSide: position.side as "LONG" | "SHORT" }
            : {}),
        },
        purpose,
        null,
        source.strategyId,
        context,
      ).catch((error: unknown) =>
        this.logger.error({
          event: "protective_exit_failed",
          connectionId: connection.id,
          symbol: position.symbol,
          purpose,
          error: this.safeError(error),
        }),
      );
    }
  }

  private async assertExchangePortfolioRisk(
    userId: string,
    connectionId: string,
    assessment: {
      symbol: string;
      positionSize: Prisma.Decimal | null;
      leverage: number | null;
      referencePrice: Prisma.Decimal;
    },
  ): Promise<void> {
    if (!assessment.positionSize || !assessment.leverage) {
      throw new ForbiddenException(
        "Exchange preflight failed: incomplete risk approval",
      );
    }
    const [snapshot, peak, positions] = await Promise.all([
      this.prisma.liveAccountSnapshot.findFirst({
        where: { userId, connectionId },
        orderBy: { syncedAt: "desc" },
      }),
      this.prisma.liveAccountSnapshot.aggregate({
        where: { userId, connectionId },
        _max: { totalEquity: true },
      }),
      this.prisma.livePosition.findMany({ where: { userId, connectionId } }),
    ]);
    if (!snapshot) {
      throw new ForbiddenException(
        "Exchange preflight failed: synchronized account state is unavailable",
      );
    }
    const limits = this.riskConfig.values;
    const equity = Number(snapshot.totalEquity);
    const peakEquity = Number(peak._max.totalEquity ?? snapshot.totalEquity);
    if (!Number.isFinite(equity) || equity <= 0) {
      throw new ForbiddenException(
        "Exchange preflight failed: account equity is unavailable",
      );
    }
    const drawdown =
      peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity) : 1;
    if (drawdown >= limits.maxDrawdown) {
      throw new ForbiddenException(
        "Exchange preflight failed: maximum drawdown exceeded",
      );
    }
    if (assessment.leverage > limits.maxLeverage) {
      throw new ForbiddenException(
        "Exchange preflight failed: leverage exceeds configured maximum",
      );
    }
    const retained = positions.filter(
      (position) => position.symbol !== assessment.symbol,
    );
    if (retained.length >= limits.maxPositions) {
      throw new ForbiddenException(
        "Exchange preflight failed: maximum open positions exceeded",
      );
    }
    const retainedExposure = retained.reduce((sum, position) => {
      const explicit = position.notional
        ? Math.abs(Number(position.notional))
        : 0;
      const calculated = Math.abs(
        Number(position.quantity) *
          Number(position.markPrice ?? position.entryPrice),
      );
      return sum + (explicit > 0 ? explicit : calculated);
    }, 0);
    const orderNotional =
      Number(assessment.positionSize) * Number(assessment.referencePrice);
    const projectedExposure = retainedExposure + orderNotional;
    if (
      !Number.isFinite(projectedExposure) ||
      projectedExposure > equity * limits.maxExposure + 1e-8
    ) {
      throw new ForbiddenException(
        "Exchange preflight failed: maximum portfolio exposure exceeded",
      );
    }
    const requiredMargin = orderNotional / assessment.leverage;
    if (requiredMargin > Number(snapshot.availableBalance) + 1e-8) {
      throw new ForbiddenException(
        "Exchange preflight failed: insufficient available margin",
      );
    }
  }

  private orderView(row: {
    id: string;
    exchangeOrderId: string | null;
    clientOrderId: string;
    provider: string;
    environment: string;
    symbol: string;
    side: string;
    quantity: Prisma.Decimal;
    averagePrice: Prisma.Decimal | null;
    status: string;
    purpose: string;
    errorCode: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      orderId: row.exchangeOrderId,
      clientOrderId: row.clientOrderId,
      provider: row.provider,
      environment: row.environment,
      symbol: row.symbol,
      side: row.side,
      size: Number(row.quantity),
      price: row.averagePrice ? Number(row.averagePrice) : null,
      status: row.status,
      purpose: row.purpose,
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private derivedId(value: string, suffix: string): string {
    return `${value.slice(0, 36 - suffix.length - 1)}-${suffix}`;
  }

  private safeError(error: unknown): { code: string; message: string } {
    return error instanceof ExchangeError
      ? { code: error.code, message: error.message.slice(0, 300) }
      : {
          code: "EXECUTION_FAILED",
          message: "Exchange order execution failed",
        };
  }
}
