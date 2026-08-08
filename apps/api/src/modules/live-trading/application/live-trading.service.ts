import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
import { LiveTradingGateway } from "../presentation/live-trading.gateway";
import type { TradePlanMarketContext } from "../../risk/domain/trade-plan-engine";
import type { TradePlan } from "../../risk/domain/trade-plan-engine";
import { evaluatePositionManagement } from "../domain/position-manager";

const RECENT_TRADE_HISTORY_LIMIT = 20;

@Injectable()
export class LiveTradingService {
  private readonly logger = new Logger(LiveTradingService.name);
  private readonly realtimeSnapshots = new Map<string, unknown>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ExchangeConnectionService,
    private readonly config: LiveTradingConfigService,
    private readonly audit: AuditService,
    private readonly riskConfig: RiskConfigService,
    private readonly risk: RiskManagementService,
    private readonly portfolio: PortfolioService,
    private readonly publicExchanges: PublicExchangeService,
    private readonly gateway?: LiveTradingGateway,
  ) {}

  /** Build the execution approval exclusively from synchronized exchange data. */
  async assessPipelineDecision(input: {
    userId: string;
    pipelineRunId: string;
    symbol: string;
    provider: ExchangeProvider;
    decision: DecisionOutput;
    volatilityAtr?: number;
    tradePlanContext?: TradePlanMarketContext;
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
    const userConnections = await this.connections.list(input.userId);
    let connection = userConnections.find(
      (item) =>
        item.provider === input.provider &&
        item.environment === targetEnvironment &&
        item.isEnabled &&
        item.isVerified,
    );
    let effectiveProvider = input.provider;
    if (!connection) {
      const fallback = userConnections.find(
        (item) => item.isEnabled && item.isVerified,
      );
      if (fallback) {
        connection = fallback;
        effectiveProvider = fallback.provider;
      }
    }
    if (!connection)
      return { outcome: "NO_ELIGIBLE_EXCHANGE_CONNECTION", price: 0 };

    await this.sync(input.userId, connection.id, {});
    const ticker = await this.publicExchanges.ticker(
      effectiveProvider,
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
        await this.supersedeEarlierEntry(tx, input, price);
        let risk = await this.risk.assess(tx, {
          userId: input.userId,
          connectionId: connection.id,
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
          tradePlanContext: {
            ...input.tradePlanContext,
            ...(Number.isFinite(input.volatilityAtr) && (input.volatilityAtr ?? 0) > 0
              ? { atr: input.volatilityAtr }
              : {}),
          },
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
    const existingOpenPosition = await this.prisma.livePosition.findFirst({
      where: {
        userId,
        connectionId: dto.connectionId,
        symbol: assessment.symbol,
      },
    });
    if (
      existingOpenPosition &&
      existingOpenPosition.side === (assessment.decision as "LONG" | "SHORT")
    ) {
      throw new ConflictException(
        "A position already exists in the approved direction",
      );
    }
    const sameSignalOrder = await this.prisma.liveOrder.findFirst({
      where: {
        userId,
        connectionId: dto.connectionId,
        symbol: assessment.symbol,
        purpose: { in: ["OPEN", "REVERSE"] },
        status: { not: "FAILED" },
        stopLoss: assessment.stopLoss,
        takeProfit: assessment.takeProfit,
      },
      orderBy: { createdAt: "desc" },
    });
    if (sameSignalOrder) {
      throw new ConflictException(
        "An equivalent order for this symbol and protection levels already exists",
      );
    }
    const last = await this.prisma.liveOrder.findFirst({
      where: {
        userId,
        connectionId: dto.connectionId,
        symbol: assessment.symbol,
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
    const sizing = await this.assertExchangePortfolioRisk(
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
    this.logger.warn({
      event: "execution_sizing",
      userId,
      connectionId: dto.connectionId,
      symbol: assessment.symbol,
      approvedPositionSize: assessment.positionSize,
      approvedLeverage: assessment.leverage,
      executionPositionSize: sizing.positionSize,
      executionLeverage: sizing.leverage,
      referencePrice: sizing.referencePrice,
    });
    const result = await this.submit(
      userId,
      connection,
      {
        symbol: assessment.symbol,
        side,
        quantity: String(sizing.positionSize),
        leverage: sizing.leverage,
        clientOrderId: this.normalizeClientOrderId(dto.clientOrderId),
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
    const assessment = await this.prisma.riskAssessment.findUnique({ where: { pipelineRunId } });
    if (!assessment || assessment.userId !== userId)
      return { outcome: "RISK_ASSESSMENT_MISSING" };
    if (!assessment.approved)
      return { outcome: "RISK_REJECTED", reason: assessment.reason };

    // Use the connection that was pinned during risk assessment, falling back
    // to any eligible connection if the pinned one is unavailable.
    const connections = await this.connections.list(userId);
    let connection = assessment.connectionId
      ? connections.find(
          (item) =>
            item.id === assessment.connectionId &&
            item.isEnabled &&
            item.isVerified,
        )
      : undefined;
    if (!connection) {
      // Fallback: pick any eligible connection (preserves behaviour when
      // connectionId was not recorded on older assessments).
      connection = connections.find((item) => item.isEnabled && item.isVerified);
    }
    if (!connection) return { outcome: "NO_ELIGIBLE_EXCHANGE_CONNECTION" };
    const clientOrderId = this.normalizeClientOrderId(
      `p9${this.removeHyphens(randomUUID()).slice(0, 28)}`,
    );
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
        errorMessage: safe.message,
      });
      return {
        outcome: "EXECUTION_FAILED",
        errorCode: safe.code,
        errorMessage: safe.message,
      };
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
        clientOrderId: this.normalizeClientOrderId(dto.clientOrderId),
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
      Date.now() - previousSnapshot.syncedAt.getTime() >= 60_000;
    // Fetch positions first so we can pass their symbols to orderHistory
    const [account, positions, openOrders] = await Promise.all([
      this.connections.account(userId, connectionId, context),
      this.connections.positions(userId, connectionId, context),
      this.connections.openOrders(userId, connectionId, context),
    ]);
    // Build symbol list from active positions plus any symbols already tracked
    // in liveOrders. This ensures history is imported for all traded symbols.
    const trackedSymbols = await this.prisma.liveOrder
      .findMany({
        where: { userId, connectionId },
        select: { symbol: true },
        distinct: ["symbol"],
        orderBy: { createdAt: "desc" },
        take: 20,
      })
      .then((rows) => rows.map((r) => r.symbol));
    const positionSymbols = positions
      .filter((p) => Number(p.quantity) > 0)
      .map((p) => p.symbol);
    const historySymbols = [
      ...new Set([...positionSymbols, ...trackedSymbols]),
    ];
    const orderHistory = historyDue
      ? await this.connections.orderHistory(
          userId,
          connectionId,
          context,
          historySymbols.length > 0 ? historySymbols : undefined,
          RECENT_TRADE_HISTORY_LIMIT,
        )
      : [];
    const syncedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
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

      const activePositions = positions.filter((p) => Number(p.quantity) > 0);
      const activeKeysSet = new Set(
        activePositions.map((pos) => `${pos.symbol}:${pos.side}`),
      );

      const currentDbPositions = await tx.livePosition.findMany({
        where: { connectionId },
      });
      for (const dbPos of currentDbPositions) {
        if (!activeKeysSet.has(`${dbPos.symbol}:${dbPos.side}`)) {
          await tx.livePosition.delete({ where: { id: dbPos.id } });
        }
      }

      for (const pos of activePositions) {
        await tx.livePosition.upsert({
          where: {
            connectionId_symbol_side: {
              connectionId,
              symbol: pos.symbol,
              side: pos.side,
            },
          },
          update: {
            provider: pos.provider,
            environment: connection.environment,
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
            connectionId,
            provider: pos.provider,
            environment: connection.environment,
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
      for (const order of orderHistory.slice(0, RECENT_TRADE_HISTORY_LIMIT)) {
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
    const persistedOrders = await this.prisma.liveOrder.findMany({
      where: { userId, connectionId },
      orderBy: { createdAt: "desc" },
      take: RECENT_TRADE_HISTORY_LIMIT,
    });
    await this.monitorProtection(userId, connection, positions, context);
    await this.cleanupOrphanProtection(userId, connection, positions, context);
    this.logger.log({
      event: "live_state_synced",
      userId,
      connectionId,
      positionCount: positions.length,
      openOrderCount: openOrders.length,
    });
    const summary = {
      syncedAt: syncedAt.toISOString(),
      positions: positions.length,
      openOrders: openOrders.length,
      importedOrders: orderHistory.length,
    };
    const connections = await this.connections.list(userId);
    const snapshot = {
      mode: this.config.values.mode,
      globalTradingEnabled: this.config.values.runtimeEnabled,
      liveTradingEnabled: this.config.values.liveEnabled,
      connections: connections.filter(
        (item) => item.isEnabled && item.isVerified && (!connectionId || item.id === connectionId),
      ),
      accounts: [
        {
          connectionId,
          provider: connection.provider,
          environment: connection.environment,
          totalEquity: Number(account.totalEquity),
          availableBalance: Number(account.availableBalance),
          unrealizedPnl: Number(account.totalUnrealizedPnl),
          marginBalance: Number(account.totalMarginBalance),
          syncedAt: syncedAt.toISOString(),
        },
      ],
      positions: positions.map((position) => ({
        id: `${connectionId}:${position.symbol}:${position.side}`,
        connectionId,
        provider: position.provider,
        symbol: position.symbol,
        side: position.side,
        quantity: Number(position.quantity),
        entryPrice: Number(position.entryPrice),
        markPrice: position.markPrice ? Number(position.markPrice) : null,
        liquidationPrice: position.liquidationPrice
          ? Number(position.liquidationPrice)
          : null,
        leverage: position.leverage ? Number(position.leverage) : null,
        unrealizedPnl: Number(position.unrealizedPnl),
        realizedPnl: position.realizedPnl ? Number(position.realizedPnl) : null,
        notional: position.notional ? Number(position.notional) : null,
        syncedAt: syncedAt.toISOString(),
      })),
      orders: persistedOrders.map((row) =>
        this.orderView({
          id: row.id,
          exchangeOrderId: row.exchangeOrderId,
          clientOrderId: row.clientOrderId,
          provider: row.provider,
          environment: row.environment,
          symbol: row.symbol,
          side: row.side,
          quantity: row.quantity,
          averagePrice: row.averagePrice,
          status: row.status,
          purpose: row.purpose,
          errorCode: row.errorCode,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      ),
    };
    this.realtimeSnapshots.set(this.realtimeCacheKey(userId, connectionId), snapshot);
    this.realtimeSnapshots.delete(this.realtimeCacheKey(userId, undefined));
    if (this.gateway) {
      this.gateway.pushSnapshot(userId, snapshot);
    }
    return summary;
  }

  async dashboard(userId: string, connectionId?: string) {
    return this.buildDashboardSnapshot(userId, connectionId);
  }

  private realtimeCacheKey(userId: string, connectionId?: string) {
    return `${userId}:${connectionId ?? "all"}`;
  }

  private isValidUserId(userId?: string | null): userId is string {
    if (!userId) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
    );
  }

  private async buildDashboardSnapshot(userId: string, connectionId?: string) {
    const cached = this.realtimeSnapshots.get(this.realtimeCacheKey(userId, connectionId));
    if (cached) return cached;
    if (!this.isValidUserId(userId)) {
      this.logger.warn({
        event: "dashboard_snapshot_skipped_invalid_user_id",
        userId,
      });
      return {
        mode: this.config.values.mode,
        globalTradingEnabled: this.config.values.runtimeEnabled,
        liveTradingEnabled: this.config.values.liveEnabled,
        connections: [],
        accounts: [],
        positions: [],
        orders: [],
      };
    }
    const connections = await this.connections.list(userId);
    const eligible = connections.filter(
      (item) =>
        item.isEnabled &&
        item.isVerified &&
        (!connectionId || item.id === connectionId),
    );
    const eligibleIds = eligible.map((item) => item.id);
    const where = {
      userId,
      connectionId: {
        in: connectionId ? [connectionId] : eligibleIds,
      },
    };
    await Promise.allSettled(
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
        take: RECENT_TRADE_HISTORY_LIMIT,
      }),
      this.prisma.liveAccountSnapshot.findMany({
        where,
        orderBy: { syncedAt: "desc" },
        take: 100,
      }),
    ]);
    const latestMap = new Map<string, (typeof snapshots)[number]>();
    for (const item of snapshots) {
      if (!latestMap.has(item.connectionId)) {
        latestMap.set(item.connectionId, item);
      }
    }
    const latest = Array.from(latestMap.values());
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
    const persistedSnapshots = Array.from(this.realtimeSnapshots.entries()).filter(
      ([key]) => key.startsWith(`${userId}:`),
    );
    // Fetch all connections once to resolve provider/environment from the key
    const allConnections = await this.connections.list(userId);
    const connectionMap = new Map(allConnections.map((c) => [c.id, c]));
    for (const [key, snapshot] of persistedSnapshots) {
      const connectionId = key.split(":").slice(1).join(":") ?? undefined;
      const account = (snapshot as { accounts?: Array<{ connectionId?: string; totalEquity?: number; availableBalance?: number; unrealizedPnl?: number; marginBalance?: number; syncedAt?: string }> }).accounts?.[0];
      if (!account || !connectionId) continue;
      const conn = connectionMap.get(connectionId);
      const provider = conn?.provider ?? "OKX_FUTURES";
      const environment = conn?.environment ?? "DEMO";
      const latest = await this.prisma.liveAccountSnapshot.findFirst({
        where: { userId, connectionId },
        orderBy: { syncedAt: "desc" },
      });
      if (latest) {
        await this.prisma.liveAccountSnapshot.update({
          where: { id: latest.id },
          data: {
            provider,
            environment,
            totalEquity: account.totalEquity ?? 0,
            availableBalance: account.availableBalance ?? 0,
            unrealizedPnl: account.unrealizedPnl ?? 0,
            marginBalance: account.marginBalance ?? 0,
            syncedAt: new Date(account.syncedAt ?? Date.now()),
          },
        });
      } else {
        await this.prisma.liveAccountSnapshot.create({
          data: {
            userId,
            connectionId,
            provider,
            environment,
            totalEquity: account.totalEquity ?? 0,
            availableBalance: account.availableBalance ?? 0,
            unrealizedPnl: account.unrealizedPnl ?? 0,
            marginBalance: account.marginBalance ?? 0,
            syncedAt: new Date(account.syncedAt ?? Date.now()),
          },
        });
      }
    }
    await this.audit.record("GLOBAL_TRADING_KILL_SWITCH", userId, context, {
      status: "DISABLED",
    });
    this.logger.error({ event: "global_trading_disabled", userId });
    return { globalTradingEnabled: false };
  }

  async enable(userId: string, context: RequestMetadata) {
    this.config.enable();
    await this.audit.record("GLOBAL_TRADING_KILL_SWITCH", userId, context, {
      status: "ENABLED",
    });
    this.logger.log({ event: "global_trading_enabled", userId });
    return { globalTradingEnabled: true };
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
      tradePlan?: Prisma.JsonValue | null;
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
          initialStopLoss: assessment?.stopLoss,
          tradePlan: assessment?.tradePlan === null || assessment?.tradePlan === undefined
            ? Prisma.JsonNull
            : (assessment.tradePlan as Prisma.InputJsonValue),
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
          protectiveClientOrderId: order.protectiveClientOrderId,
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
        errorMessage: safe.message,
        exchangeCode:
          error instanceof ExchangeError ? error.exchangeCode : undefined,
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
      if (!Number.isFinite(mark) || mark <= 0) continue;
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
      const rawPlan = source.tradePlan as unknown as Partial<TradePlan> | null;
      if (
        rawPlan &&
        typeof rawPlan.regime === "string" &&
        typeof rawPlan.strategy === "string" &&
        typeof rawPlan.maxHoldingCandles === "number" &&
        typeof rawPlan.breakEvenAtR === "number"
      ) {
        const entry = Number(position.entryPrice);
        const initialStop = Number(source.initialStopLoss ?? source.stopLoss);
        const currentStop = Number(source.stopLoss);
        if ([entry, initialStop, currentStop].every(Number.isFinite)) {
          const action = evaluatePositionManagement({
            side: position.side as "LONG" | "SHORT",
            entryPrice: entry,
            markPrice: mark,
            initialStopLoss: initialStop,
            currentStopLoss: currentStop,
            highestMark: source.highestMark ? Number(source.highestMark) : undefined,
            lowestMark: source.lowestMark ? Number(source.lowestMark) : undefined,
            openedAt: source.createdAt,
            partialTaken: source.partialTakenAt !== null,
            plan: rawPlan as TradePlan,
          });
          let amendedStop: number | undefined;
          if (action.tightenedStopLoss !== undefined) {
            try {
              if (
                position.provider === ExchangeProvider.OKX_FUTURES &&
                source.protectiveClientOrderId
              ) {
                await this.connections.amendProtectiveOrder(
                  userId,
                  connection.id,
                  {
                    symbol: position.symbol,
                    protectiveClientOrderId: source.protectiveClientOrderId,
                    stopLoss: String(action.tightenedStopLoss),
                    ...(source.takeProfit ? { takeProfit: String(source.takeProfit) } : {}),
                    requestId: this.derivedId(
                      source.clientOrderId,
                      `a${Math.abs(Math.round(action.tightenedStopLoss * 100))}`,
                    ),
                  },
                  context,
                );
              }
              amendedStop = action.tightenedStopLoss;
            } catch (error) {
              this.logger.error({
                event: "protective_order_amend_failed",
                connectionId: connection.id,
                symbol: position.symbol,
                error: this.safeError(error),
              });
            }
          }
          await this.prisma.liveOrder.update({
            where: { id: source.id },
            data: {
              highestMark: action.highestMark,
              lowestMark: action.lowestMark,
              ...(amendedStop !== undefined ? { stopLoss: amendedStop } : {}),
            },
          });

          const configuration = await this.connections.configuration(userId, connection.id, context);
          if (action.timeExit) {
            const clientOrderId = this.derivedId(source.clientOrderId, "time");
            const duplicate = await this.prisma.liveOrder.findUnique({
              where: { connectionId_clientOrderId: { connectionId: connection.id, clientOrderId } },
            });
            if (!duplicate) {
              try {
                await this.submit(userId, connection, {
                  symbol: position.symbol,
                  side: position.side === "LONG" ? "SELL" : "BUY",
                  quantity: position.quantity,
                  leverage: Number(position.leverage ?? source.leverage),
                  clientOrderId,
                  reduceOnly: true,
                  ...(configuration.positionMode === "HEDGE" ? { positionSide: position.side as "LONG" | "SHORT" } : {}),
                }, "CLOSE", null, source.strategyId, context);
                if (
                  position.provider === ExchangeProvider.OKX_FUTURES &&
                  source.protectiveClientOrderId
                ) {
                  await this.connections.cancelProtectiveOrder(userId, connection.id, {
                    symbol: position.symbol,
                    protectiveClientOrderId: source.protectiveClientOrderId,
                  }, context).catch((error: unknown) =>
                    this.logger.warn({ event: "protective_order_cancel_after_close_failed", symbol: position.symbol, error: this.safeError(error) }));
                }
              } catch (error) {
                this.logger.error({ event: "position_time_exit_failed", symbol: position.symbol, error: this.safeError(error) });
              }
            }
            continue;
          }
          if (action.takePartial) {
            const clientOrderId = this.derivedId(source.clientOrderId, "partial1");
            const duplicate = await this.prisma.liveOrder.findUnique({
              where: { connectionId_clientOrderId: { connectionId: connection.id, clientOrderId } },
            });
            if (!duplicate) {
              const quantity = Number(position.quantity) * 0.4;
              if (Number.isFinite(quantity) && quantity > 0) {
                await this.submit(userId, connection, {
                  symbol: position.symbol,
                  side: position.side === "LONG" ? "SELL" : "BUY",
                  quantity: String(Number(quantity.toFixed(12))),
                  leverage: Number(position.leverage ?? source.leverage),
                  clientOrderId,
                  reduceOnly: true,
                  ...(configuration.positionMode === "HEDGE" ? { positionSide: position.side as "LONG" | "SHORT" } : {}),
                }, "TAKE_PROFIT", null, source.strategyId, context).then(() =>
                  this.prisma.liveOrder.update({ where: { id: source.id }, data: { partialTakenAt: new Date() } }))
                  .catch((error: unknown) => this.logger.error({ event: "partial_take_profit_failed", symbol: position.symbol, error: this.safeError(error) }));
              }
            }
          }
        }
      }
      // OKX has a native attached algo order. Binance protection is monitored
      // here and submitted as reduce-only when the ratcheted level is crossed.
      if (position.provider !== ExchangeProvider.BINANCE_FUTURES) continue;
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

  private async cleanupOrphanProtection(
    userId: string,
    connection: Awaited<ReturnType<ExchangeConnectionService["get"]>>,
    positions: ExchangePosition[],
    context: RequestMetadata,
  ): Promise<void> {
    if (connection.provider !== ExchangeProvider.OKX_FUTURES) return;
    const protectedEntries = await this.prisma.liveOrder.findMany({
      where: {
        userId,
        connectionId: connection.id,
        purpose: { in: ["OPEN", "REVERSE"] },
        status: { not: "FAILED" },
        protectiveClientOrderId: { not: null },
      },
    });
    for (const source of protectedEntries) {
      const expectedSide = source.side === "BUY" ? "LONG" : "SHORT";
      const stillOpen = positions.some(
        (position) => position.symbol === source.symbol && position.side === expectedSide,
      );
      if (stillOpen || !source.protectiveClientOrderId) continue;
      try {
        await this.connections.cancelProtectiveOrder(userId, connection.id, {
          symbol: source.symbol,
          protectiveClientOrderId: source.protectiveClientOrderId,
        }, context);
        await this.prisma.liveOrder.update({
          where: { id: source.id },
          data: { protectiveClientOrderId: null },
        });
      } catch (error) {
        this.logger.warn({
          event: "orphan_protective_order_cancel_failed",
          connectionId: connection.id,
          symbol: source.symbol,
          error: this.safeError(error),
        });
      }
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
  ): Promise<{ positionSize: number; leverage: number; referencePrice: number }> {
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
    const availableBalance = Number(snapshot.availableBalance);
    const requestedPositionSize = Number(assessment.positionSize);
    const requestedLeverage = assessment.leverage;
    const requestedNotional = requestedPositionSize * Number(assessment.referencePrice);
    const sizing = {
      positionSize: requestedPositionSize,
      leverage: requestedLeverage,
      referencePrice: Number(assessment.referencePrice),
    };
    if (requestedNotional / requestedLeverage > availableBalance + 1e-8) {
      throw new ForbiddenException(
        "Exchange preflight failed: insufficient available margin",
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
    const orderNotional = sizing.positionSize * sizing.referencePrice;
    const projectedExposure = retainedExposure + orderNotional;
    if (
      !Number.isFinite(projectedExposure) ||
      projectedExposure > equity * limits.maxExposure + 1e-8
    ) {
      throw new ForbiddenException(
        "Exchange preflight failed: maximum portfolio exposure exceeded",
      );
    }
    const requiredMargin = orderNotional / sizing.leverage;
    if (requiredMargin > availableBalance + 1e-8) {
      throw new ForbiddenException(
        "Exchange preflight failed: insufficient available margin",
      );
    }
    return sizing;
  }

  private deriveExecutionSizing(
    assessment: {
      positionSize: number;
      leverage: number;
      referencePrice: number;
    },
    availableBalance: number,
    maxLeverage: number,
  ): { positionSize: number; leverage: number; referencePrice: number } {
    const requestedNotional = assessment.positionSize * assessment.referencePrice;
    const minLeverage = 1;
    const maxAllowedLeverage = Math.min(assessment.leverage, maxLeverage);
    const leverage = Math.max(minLeverage, Math.floor(maxAllowedLeverage));
    if (!Number.isFinite(availableBalance) || availableBalance <= 0) {
      return { ...assessment, positionSize: 0, leverage };
    }
    if (requestedNotional / leverage > availableBalance + 1e-8) {
      return { ...assessment, positionSize: 0, leverage };
    }
    return {
      positionSize: Number(assessment.positionSize.toFixed(12)),
      leverage,
      referencePrice: assessment.referencePrice,
    };
  }

  private async supersedeEarlierEntry(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      pipelineRunId: string;
      symbol: string;
      decision: DecisionOutput;
    },
    price: number,
  ): Promise<void> {
    if (input.decision.decision === "WAIT") return;
    const candidates = await tx.riskAssessment.findMany({
      where: {
        userId: input.userId,
        symbol: input.symbol,
        approved: true,
        decision: input.decision.decision,
        pipelineRunId: { not: input.pipelineRunId },
        positionSize: { not: null },
        leverage: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });
    const supersededIds = [] as string[];
    for (const candidate of candidates) {
      const hasActiveOrder = await tx.liveOrder.findFirst({
        where: {
          riskAssessmentId: candidate.id,
          status: { not: "FAILED" },
        },
      });
      if (hasActiveOrder) continue;
      const referencePrice = Number(candidate.referencePrice);
      const isBetterEntry =
        input.decision.decision === "LONG"
          ? Number.isFinite(referencePrice) && price < referencePrice
          : input.decision.decision === "SHORT"
            ? Number.isFinite(referencePrice) && price > referencePrice
            : false;
      if (isBetterEntry) supersededIds.push(candidate.id);
    }
    if (!supersededIds.length) return;
    await tx.riskAssessment.updateMany({
      where: { id: { in: supersededIds } },
      data: {
        approved: false,
        reason: "SUPERSEDED_BY_BETTER_ENTRY",
        positionSize: null,
        leverage: null,
        stopLoss: null,
        takeProfit: null,
      },
    });
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
    const normalized = this.normalizeClientOrderId(value);
    const prefixLength = Math.max(0, 32 - suffix.length);
    return `${normalized.slice(0, prefixLength)}${suffix}`;
  }

  private normalizeClientOrderId(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "order";
    const withoutDashes = this.removeHyphens(trimmed);
    const alphanumeric = withoutDashes.replace(/[^A-Za-z0-9]/g, "");
    if (!alphanumeric) return "order";
    if (alphanumeric.length <= 32) return alphanumeric;
    return `${alphanumeric.slice(0, 30)}${alphanumeric.slice(-2)}`;
  }

  private removeHyphens(value: string): string {
    return value.replace(/-/g, "");
  }

  private safeError(error: unknown): { code: string; message: string } {
    if (error instanceof ExchangeError) {
      const detail = [
        error.message,
        error.exchangeCode ? `exchangeCode=${error.exchangeCode}` : undefined,
      ]
        .filter(Boolean)
        .join(" | ");
      return { code: error.code, message: detail.slice(0, 300) };
    }
    if (error instanceof Error) {
      return {
        code: "EXECUTION_FAILED",
        message: error.message.slice(0, 300),
      };
    }
    return {
      code: "EXECUTION_FAILED",
      message: "Exchange order execution failed",
    };
  }
}
