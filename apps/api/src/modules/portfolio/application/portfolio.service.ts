import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Prisma,
  ExchangeEnvironment,
  StrategyKind,
  StrategyStatus,
  StrategyType,
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { ExchangeConnectionService } from "../../../exchange/application/exchange-connection.service";
import {
  aggregatePositions,
  assessPortfolioRisk,
  calculateAllocations,
  type PositionSide,
  type StrategyPositionSnapshot,
} from "../domain/portfolio-engine";
import { PortfolioConfigService } from "./portfolio-config.service";
import { resolveDefaultSymbols } from "../../../exchange/infrastructure/exchange-symbol";

type Tx = Prisma.TransactionClient;

const defaults: Array<{
  key: string;
  name: string;
  type: StrategyType;
  kind: StrategyKind;
}> = [
  {
    key: "ai-core",
    name: "AI Core",
    type: StrategyType.AI,
    kind: StrategyKind.AI_CORE,
  },
  {
    key: "trend",
    name: "Trend Following",
    type: StrategyType.RULE_BASED,
    kind: StrategyKind.TREND_FOLLOWING,
  },
  {
    key: "mean-reversion",
    name: "Mean Reversion",
    type: StrategyType.RULE_BASED,
    kind: StrategyKind.MEAN_REVERSION,
  },
  {
    key: "breakout",
    name: "Breakout",
    type: StrategyType.HYBRID,
    kind: StrategyKind.BREAKOUT,
  },
  {
    key: "news",
    name: "News Driven",
    type: StrategyType.HYBRID,
    kind: StrategyKind.NEWS_DRIVEN,
  },
];

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PortfolioConfigService,
    @Optional() private readonly connections?: ExchangeConnectionService,
    @Optional() private readonly environment?: ConfigService,
  ) {}

  async ensureDefaults(userId: string): Promise<void> {
    const symbols = resolveDefaultSymbols();
    for (const definition of defaults.slice(
      0,
      this.config.values.maxStrategies,
    )) {
      const strategy = await this.prisma.portfolioStrategy.upsert({
        where: { userId_key: { userId, key: definition.key } },
        update: {},
        create: { userId, ...definition, symbols },
      });
      await Promise.all([
        this.prisma.strategyPerformance.upsert({
          where: { strategyId: strategy.id },
          update: {},
          create: { strategyId: strategy.id },
        }),
        this.prisma.strategyAllocation.upsert({
          where: { strategyId: strategy.id },
          update: {},
          create: { strategyId: strategy.id, weight: 0, allocatedCapital: 0 },
        }),
      ]);
    }
  }

  async prepareStrategy(userId: string, key = "ai-core") {
    await this.ensureDefaults(userId);
    let strategy = await this.prisma.portfolioStrategy.findUnique({
      where: { userId_key: { userId, key } },
      include: { allocation: true },
    });
    if (!strategy) throw new NotFoundException("Portfolio strategy not found");
    if (
      !strategy.allocation ||
      Number(strategy.allocation.allocatedCapital) <= 0
    ) {
      await this.rebalance(userId, "INITIAL_ALLOCATION");
      strategy = await this.prisma.portfolioStrategy.findUnique({
        where: { userId_key: { userId, key } },
        include: { allocation: true },
      });
    }
    if (!strategy) throw new NotFoundException("Portfolio strategy not found");
    return strategy;
  }

  async assessTrade(
    tx: Tx,
    input: {
      userId: string;
      strategyId: string;
      pipelineRunId?: string;
      symbol: string;
      side: PositionSide;
      requestedNotional: number;
      equity: number;
      peakEquity: number;
    },
  ) {
    const strategy = await tx.portfolioStrategy.findFirst({
      where: { id: input.strategyId, userId: input.userId },
      include: { allocation: true },
    });
    const activeConnections = await tx.exchangeConnection.findMany({
      where: { userId: input.userId, isEnabled: true, isVerified: true },
      select: { id: true },
    });
    const activeConnectionIds = activeConnections.map((c) => c.id);
    const snapshots: StrategyPositionSnapshot[] = (
      await tx.livePosition.findMany({
        where: {
          userId: input.userId,
          connectionId: { in: activeConnectionIds },
          environment: { in: this.exchangeEnvironments() },
        },
      })
    ).map((position) => ({
      strategyId:
        position.strategyId ??
        `unassigned:${position.connectionId}:${position.symbol}:${position.side}`,
      symbol: position.symbol,
      side: position.side as PositionSide,
      quantity: Number(position.quantity),
      markPrice: Number(position.markPrice ?? position.entryPrice),
    }));
    const result =
      !strategy || strategy.status !== StrategyStatus.ACTIVE
        ? {
            approved: false,
            reason: "STRATEGY_NOT_ACTIVE",
            approvedNotional: 0,
            totalExposurePct:
              input.equity > 0
                ? snapshots.reduce(
                    (sum, item) =>
                      sum + Math.abs(item.quantity * item.markPrice),
                    0,
                  ) / input.equity
                : 1,
            strategyExposurePct: 0,
            correlatedStrategies: 0,
            failsafe: false,
          }
        : assessPortfolioRisk(
            {
              strategyId: input.strategyId,
              symbol: input.symbol,
              side: input.side,
              requestedNotional: input.requestedNotional,
              equity: input.equity,
              peakEquity: input.peakEquity,
              allocatedCapital: Number(
                strategy.allocation?.allocatedCapital ?? 0,
              ),
              positions: snapshots,
            },
            this.config.values,
          );
    await tx.portfolioRiskEvent.create({
      data: {
        userId: input.userId,
        strategyId: strategy?.id,
        pipelineRunId: input.pipelineRunId,
        symbol: input.symbol,
        side: input.side,
        requestedNotional: input.requestedNotional,
        approvedNotional: result.approvedNotional,
        approved: result.approved,
        reason: result.reason,
        totalExposurePct: result.totalExposurePct,
        strategyExposurePct: result.strategyExposurePct,
        correlatedStrategies: result.correlatedStrategies,
      },
    });
    if (result.failsafe) {
      await tx.portfolioStrategy.updateMany({
        where: { userId: input.userId, status: StrategyStatus.ACTIVE },
        data: {
          status: StrategyStatus.PAUSED,
          disabledReason: "PORTFOLIO_FAILSAFE",
        },
      });
      await tx.strategyPosition.deleteMany({
        where: { strategy: { userId: input.userId } },
      });
    }
    return result;
  }

  async recordPosition(
    tx: Tx,
    input: {
      strategyId: string;
      symbol: string;
      side: PositionSide;
      quantity: number;
      entryPrice: number;
      markPrice: number;
    },
  ) {
    return tx.strategyPosition.upsert({
      where: {
        strategyId_symbol: {
          strategyId: input.strategyId,
          symbol: input.symbol,
        },
      },
      update: {
        side: input.side,
        quantity: input.quantity,
        entryPrice: input.entryPrice,
        markPrice: input.markPrice,
      },
      create: input,
    });
  }

  closePosition(tx: Tx, strategyId: string, symbol: string) {
    return tx.strategyPosition.deleteMany({ where: { strategyId, symbol } });
  }

  async recordTradeResult(
    tx: Tx,
    strategyId: string,
    symbol: string,
    pnl: number,
    returnPct: number,
  ) {
    await tx.strategyTradeResult.create({
      data: { strategyId, symbol, pnl, returnPct },
    });
    const results = await tx.strategyTradeResult.findMany({
      where: { strategyId },
      orderBy: { closedAt: "asc" },
    });
    const allocation = await tx.strategyAllocation.findUnique({
      where: { strategyId },
    });
    const returns = results.map((item) => item.returnPct);
    const mean =
      returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const deviation = Math.sqrt(
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        Math.max(1, returns.length - 1),
    );
    const initial = Math.max(1, Number(allocation?.allocatedCapital ?? 1));
    let equity = initial;
    let peak = initial;
    let maxDrawdown = 0;
    for (const item of results) {
      equity += Number(item.pnl);
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(
        maxDrawdown,
        peak > 0 ? (peak - equity) / peak : 1,
      );
    }
    const wins = results.filter((item) => Number(item.pnl) > 0).length;
    await tx.strategyPerformance.upsert({
      where: { strategyId },
      update: {
        totalTrades: results.length,
        winningTrades: wins,
        winRate: wins / results.length,
        returnPct: (equity - initial) / initial,
        drawdownPct: maxDrawdown,
        sharpeRatio: deviation > 0 ? (mean / deviation) * Math.sqrt(365) : null,
        realizedPnl: results.reduce((sum, item) => sum + Number(item.pnl), 0),
      },
      create: { strategyId },
    });
  }

  async rebalance(userId: string, reason = "MANUAL") {
    await this.ensureDefaults(userId);
    const live = await this.liveState(userId);
    const equity = live.equity;
    const strategies = await this.prisma.portfolioStrategy.findMany({
      where: { userId },
      include: { performance: true, allocation: true, livePositions: true },
      orderBy: { createdAt: "asc" },
    });
    const allocations = calculateAllocations(
      strategies.map((strategy) => {
        const exchangePositions =
          live?.positions.filter(
            (position) => position.strategyId === strategy.id,
          ) ?? [];
        const pnl = exchangePositions.reduce(
          (sum, position) =>
            sum +
            Number(position.unrealizedPnl) +
            Number(position.realizedPnl ?? 0),
          0,
        );
        const capital = Number(strategy.allocation?.allocatedCapital ?? 0);
        return {
          id: strategy.id,
          key: strategy.key,
          status: strategy.status,
          performance: {
            totalTrades: strategy.performance?.totalTrades ?? 0,
            winRate: strategy.performance?.winRate ?? 0,
            returnPct: strategy.performance?.returnPct ?? (capital > 0 ? pnl / capital : 0),
            drawdownPct: strategy.performance?.drawdownPct ?? 0,
            sharpeRatio: strategy.performance?.sharpeRatio ?? null,
          },
        };
      }),
      equity,
      this.config.values,
    );
    const disabledIds = new Set(
      allocations
        .filter((item) => item.disabled)
        .map((item) => item.strategyId),
    );
    await this.prisma.$transaction(async (tx) => {
      for (const allocation of allocations) {
        await tx.strategyAllocation.upsert({
          where: { strategyId: allocation.strategyId },
          update: {
            weight: allocation.weight,
            allocatedCapital: allocation.allocatedCapital,
          },
          create: {
            strategyId: allocation.strategyId,
            weight: allocation.weight,
            allocatedCapital: allocation.allocatedCapital,
          },
        });
        if (disabledIds.has(allocation.strategyId)) {
          await tx.portfolioStrategy.update({
            where: { id: allocation.strategyId },
            data: {
              status: StrategyStatus.DISABLED,
              disabledReason: "PERFORMANCE_LIMIT",
            },
          });
        }
      }
      await tx.portfolioRebalance.create({
        data: {
          userId,
          equity,
          reason,
          allocations: allocations as unknown as Prisma.InputJsonValue,
          disabledKeys: strategies
            .filter((item) => disabledIds.has(item.id))
            .map((item) => item.key),
        },
      });
    });
    return allocations;
  }

  async setStatus(userId: string, key: string, status: "ACTIVE" | "PAUSED") {
    const existing = await this.prisma.portfolioStrategy.findUnique({
      where: { userId_key: { userId, key } },
    });
    if (!existing) throw new NotFoundException("Portfolio strategy not found");
    if (status === "ACTIVE") {
      const active = await this.prisma.portfolioStrategy.count({
        where: { userId, status: StrategyStatus.ACTIVE },
      });
      if (
        existing.status !== StrategyStatus.ACTIVE &&
        active >= this.config.values.maxStrategies
      )
        throw new ConflictException("Maximum active strategies reached");
    }
    await this.prisma.portfolioStrategy.update({
      where: { id: existing.id },
      data: { status, disabledReason: null },
    });
    await this.rebalance(userId, "STRATEGY_STATUS_CHANGED");
  }

  async recordResult(
    userId: string,
    key: string,
    input: { symbol: string; pnl: number; returnPct: number },
  ) {
    if (![input.pnl, input.returnPct].every(Number.isFinite))
      throw new BadRequestException("Result values must be finite numbers");
    const strategy = await this.prisma.portfolioStrategy.findUnique({
      where: { userId_key: { userId, key } },
      include: { allocation: true },
    });
    if (!strategy) throw new NotFoundException("Portfolio strategy not found");
    await this.prisma.strategyTradeResult.create({
      data: { strategyId: strategy.id, ...input },
    });
    const results = await this.prisma.strategyTradeResult.findMany({
      where: { strategyId: strategy.id },
      orderBy: { closedAt: "asc" },
    });
    const returns = results.map((item) => item.returnPct);
    const mean =
      returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const deviation = Math.sqrt(
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        Math.max(1, returns.length - 1),
    );
    const initial = Math.max(
      1,
      Number(strategy.allocation?.allocatedCapital ?? 1),
    );
    let equity = initial;
    let peak = initial;
    let maxDrawdown = 0;
    for (const item of results) {
      equity += Number(item.pnl);
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(
        maxDrawdown,
        peak > 0 ? (peak - equity) / peak : 1,
      );
    }
    await this.prisma.strategyPerformance.upsert({
      where: { strategyId: strategy.id },
      update: {
        totalTrades: results.length,
        winningTrades: results.filter((item) => Number(item.pnl) > 0).length,
        winRate:
          results.filter((item) => Number(item.pnl) > 0).length /
          results.length,
        returnPct: (equity - initial) / initial,
        drawdownPct: maxDrawdown,
        sharpeRatio: deviation > 0 ? (mean / deviation) * Math.sqrt(365) : null,
        realizedPnl: results.reduce((sum, item) => sum + Number(item.pnl), 0),
      },
      create: { strategyId: strategy.id },
    });
    await this.rebalance(userId, "PERFORMANCE_UPDATE");
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
            await Promise.all(
              positions
                .filter((pos) => Number(pos.quantity) > 0)
                .map((pos) =>
                  tx.livePosition.upsert({
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
                  }),
                )
            );
            const currentPositions = await tx.livePosition.findMany({
              where: { connectionId: conn.id },
            });
            const idsToDelete = currentPositions
              .filter((cp) => !activeSymbolSides.has(`${cp.symbol}:${cp.side}`))
              .map((cp) => cp.id);
            if (idsToDelete.length > 0) {
              await tx.livePosition.deleteMany({
                where: { id: { in: idsToDelete } },
              });
            }
          });
        }),
      );
    } catch {
      // Fallback silently if exchange API is offline
    }
  }

  async dashboard(userId: string): Promise<Record<string, unknown>> {
    await this.ensureDefaults(userId);
    await this.syncActiveConnections(userId);
    const [live, strategies, riskEvents, rebalances, closedTrades] =
      await Promise.all([
        this.liveState(userId),
        this.prisma.portfolioStrategy.findMany({
          where: { userId },
          include: { allocation: true, performance: true, positions: true },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.portfolioRiskEvent.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        this.prisma.portfolioRebalance.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        this.prisma.closedTrade?.findMany({
          where: {
            userId,
            environment: { in: this.exchangeEnvironments() },
          },
          orderBy: { closedAt: "desc" },
          take: 5_000,
        }) ?? Promise.resolve([]),
      ]);
    if (
      strategies.every(
        (item) => !item.allocation || item.allocation.weight === 0,
      )
    ) {
      await this.rebalance(userId, "INITIAL_ALLOCATION");
      return this.dashboard(userId);
    }
    const equity = live.equity;
    const peakEquity = live.peakEquity;
    const positions: StrategyPositionSnapshot[] = live.positions.map(
      (position) => ({
        strategyId:
          position.strategyId ??
          `unassigned:${position.connectionId}:${position.symbol}:${position.side}`,
        symbol: position.symbol,
        side: position.side as PositionSide,
        quantity: Number(position.quantity),
        markPrice: Number(position.markPrice ?? position.entryPrice),
      }),
    );
    const grossExposure = positions.reduce(
      (sum, item) => sum + Math.abs(item.quantity * item.markPrice),
      0,
    );
    const hasTradeLedger = Boolean(this.prisma.closedTrade);
    const realizedPnl = closedTrades.reduce(
      (sum, trade) => sum + Number(trade.netPnl),
      0,
    ) + (!hasTradeLedger
      ? live.positions.reduce(
          (sum, position) => sum + Number(position.realizedPnl ?? 0),
          0,
        )
      : 0);
    const incompleteClosedTrades = closedTrades.filter(
      (trade) => !trade.sourceDataComplete,
    ).length;
    return {
      config: this.config.values,
      source: {
        mode: this.config.tradingMode,
        kind: "EXCHANGE",
        environment: this.exchangeEnvironments().join("/"),
        available: live.available,
        stale: live.stale,
        syncedAt: live.syncedAt?.toISOString() ?? null,
        connectionCount: live.connectionCount,
      },
      portfolio: {
        equity,
        peakEquity,
        pnl: realizedPnl + live.unrealizedPnl,
        realizedPnl,
        unrealizedPnl: live.unrealizedPnl,
        pnlKind: "EXCHANGE_FILL_NET_PLUS_MARK_TO_MARKET",
        closedTrades: closedTrades.length,
        incompleteClosedTrades,
        grossExposure,
        exposurePct: equity > 0 ? grossExposure / equity : 0,
        drawdownPct:
          peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity) : 0,
        failsafeActive: strategies.some(
          (item) => item.disabledReason === "PORTFOLIO_FAILSAFE",
        ),
      },
      strategies: strategies.map((item) => {
        const exchangePositions =
          live?.positions.filter(
            (position) => position.strategyId === item.id,
          ) ?? [];
        const capital = Number(item.allocation?.allocatedCapital ?? 0);
        const strategyMarkPnl = exchangePositions.reduce(
          (sum, position) =>
            sum + Number(position.unrealizedPnl) + Number(position.realizedPnl ?? 0),
          0,
        );
        const strategyTrades = closedTrades.filter(
          (trade) => trade.strategyId === item.id,
        );
        const strategyRealizedPnl = strategyTrades.reduce(
          (sum, trade) => sum + Number(trade.netPnl),
          0,
        );
        const winningTrades = strategyTrades.filter(
          (trade) => Number(trade.netPnl) > 0,
        ).length;
        return {
          id: item.id,
          key: item.key,
          name: item.name,
          type: item.type,
          kind: item.kind,
          symbols: item.symbols,
          status: item.status,
          disabledReason: item.disabledReason,
          allocation: item.allocation
            ? {
                weight: item.allocation.weight,
                allocatedCapital: capital,
              }
            : { weight: 0, allocatedCapital: 0 },
          performance: {
            source: "EXCHANGE_CLOSED_TRADE_LEDGER",
            totalTrades: strategyTrades.length,
            winningTrades,
            winRate: strategyTrades.length ? winningTrades / strategyTrades.length : null,
            returnPct: item.performance?.returnPct ?? (!hasTradeLedger && capital > 0 ? strategyMarkPnl / capital : null),
            drawdownPct: item.performance?.drawdownPct ?? null,
            sharpeRatio: item.performance?.sharpeRatio ?? null,
            realizedPnl: strategyRealizedPnl,
            unrealizedPnl: exchangePositions.reduce(
              (sum, position) => sum + Number(position.unrealizedPnl),
              0,
            ),
            updatedAt: live.syncedAt?.toISOString() ?? null,
          },
          exposure: this.exchangeExposure(exchangePositions),
        };
      }),
      unassignedExposure: this.exchangeExposure(
        live.positions.filter((position) => !position.strategyId),
      ),
      unassignedClosedTrades: closedTrades.filter((trade) => !trade.strategyId).length,
      unassignedRealizedPnl: closedTrades
        .filter((trade) => !trade.strategyId)
        .reduce((sum, trade) => sum + Number(trade.netPnl), 0),
      aggregation: aggregatePositions(positions),
      riskEvents: riskEvents.map((item) => ({
        ...item,
        requestedNotional: Number(item.requestedNotional),
        approvedNotional: Number(item.approvedNotional),
        createdAt: item.createdAt.toISOString(),
      })),
      rebalances: rebalances.map((item) => ({
        ...item,
        equity: Number(item.equity),
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  private exchangeEnvironments(): ExchangeEnvironment[] {
    return this.config.tradingMode === "LIVE"
      ? [ExchangeEnvironment.PRODUCTION]
      : [ExchangeEnvironment.DEMO, ExchangeEnvironment.TESTNET];
  }

  private exchangeExposure(
    positions: Array<{
      notional: Prisma.Decimal | null;
      quantity: Prisma.Decimal;
      markPrice: Prisma.Decimal | null;
      entryPrice: Prisma.Decimal;
    }>,
  ): number {
    return positions.reduce(
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
  }

  private async liveState(userId: string) {
    const connections = await this.prisma.exchangeConnection.findMany({
      where: { userId, isEnabled: true, isVerified: true },
      select: { id: true },
    });
    const connectionIds = connections.map((connection) => connection.id);
    const [positions, snapshots] = await Promise.all([
      this.prisma.livePosition.findMany({
        where: {
          userId,
          connectionId: { in: connectionIds },
        },
      }),
      this.prisma.liveAccountSnapshot.findMany({
        where: {
          userId,
          connectionId: { in: connectionIds },
        },
        orderBy: { syncedAt: "desc" },
        take: 5_000,
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
    const latestMap = new Map<string, (typeof freshSnapshots)[number]>();
    for (const snapshot of freshSnapshots) {
      if (!latestMap.has(snapshot.connectionId)) {
        latestMap.set(snapshot.connectionId, snapshot);
      }
    }
    const latest = Array.from(latestMap.values());
    const peaks = new Map<string, number>();
    for (const snapshot of snapshots)
      peaks.set(
        snapshot.connectionId,
        Math.max(
          peaks.get(snapshot.connectionId) ?? 0,
          Number(snapshot.totalEquity),
        ),
      );
    const syncedAt = latest.reduce<Date | null>(
      (result, snapshot) =>
        !result || snapshot.syncedAt > result ? snapshot.syncedAt : result,
      null,
    );
    return {
      available: latest.length > 0,
      stale:
        !syncedAt ||
        Date.now() - syncedAt.getTime() > this.config.liveStaleAfterMs,
      syncedAt,
      connectionCount: latest.length,
      equity: latest.reduce(
        (sum, snapshot) => sum + Number(snapshot.totalEquity),
        0,
      ),
      peakEquity: [...peaks.values()].reduce((sum, value) => sum + value, 0),
      pnl:
        latest.reduce(
          (sum, snapshot) => sum + Number(snapshot.unrealizedPnl),
          0,
        ),
      unrealizedPnl: latest.reduce(
        (sum, snapshot) => sum + Number(snapshot.unrealizedPnl),
        0,
      ),
      positions: freshPositions,
    };
  }
}
