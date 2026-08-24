import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ExchangeConnection, ExchangeFill, Prisma } from "@prisma/client";
import type { ExchangeFill as ExchangeFillInput } from "../../../exchange/domain/exchange.types";
import { PrismaService } from "../../../database/prisma.service";
import { aggregateClosedTradeCycles } from "../domain/closed-trade-cycle";

const CLOSE_PURPOSES = ["CLOSE", "REVERSE", "STOP_LOSS", "TAKE_PROFIT"];
const FILL_PERSISTENCE_BATCH_SIZE = 25;

@Injectable()
export class ExchangeTradeLedgerService {
  private readonly logger = new Logger(ExchangeTradeLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    userId: string,
    connection: Pick<ExchangeConnection, "id" | "provider" | "environment">,
    fills: ExchangeFillInput[],
    options: { refreshDerived?: boolean } = {},
  ): Promise<{ fills: number; closedTrades: number }> {
    if (!fills.length) return { fills: 0, closedTrades: 0 };

    const affectedOrderIds = new Set<string>();
    const exchangeOrderIds = [...new Set(fills.map((fill) => fill.exchangeOrderId))];
    const clientOrderIds = [
      ...new Set(
        fills.flatMap((fill) =>
          fill.clientOrderId ? [fill.clientOrderId] : [],
        ),
      ),
    ];
    const liveOrders = await this.prisma.liveOrder.findMany({
      where: {
        connectionId: connection.id,
        OR: [
          { exchangeOrderId: { in: exchangeOrderIds } },
          ...(clientOrderIds.length
            ? [{ clientOrderId: { in: clientOrderIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    for (let index = 0; index < fills.length; index += FILL_PERSISTENCE_BATCH_SIZE) {
      const batch = fills.slice(index, index + FILL_PERSISTENCE_BATCH_SIZE);
      await Promise.all(
        batch.map(async (fill) => {
          const liveOrder = liveOrders.find(
            (order) =>
              order.exchangeOrderId === fill.exchangeOrderId ||
              Boolean(
                fill.clientOrderId &&
                  order.clientOrderId === fill.clientOrderId,
              ),
          );
          const isClosing = Boolean(
            fill.isClosing ||
            liveOrder?.reduceOnly ||
            (liveOrder && CLOSE_PURPOSES.includes(liveOrder.purpose)),
          );
          await this.prisma.exchangeFill.upsert({
            where: {
              connectionId_symbol_exchangeTradeId: {
                connectionId: connection.id,
                symbol: fill.symbol,
                exchangeTradeId: fill.exchangeTradeId,
              },
            },
            update: {
              strategyId: liveOrder?.strategyId,
              liveOrderId: liveOrder?.id,
              exchangeOrderId: fill.exchangeOrderId,
              clientOrderId: fill.clientOrderId,
              side: fill.side,
              positionSide: fill.positionSide,
              price: fill.price,
              quantity: fill.quantity,
              quoteQuantity: fill.quoteQuantity,
              realizedPnl: fill.realizedPnl,
              fee: fill.fee,
              feeAsset: fill.feeAsset,
              isMaker: fill.isMaker,
              isClosing,
              executedAt: fill.executedAt,
            },
            create: {
              userId,
              connectionId: connection.id,
              strategyId: liveOrder?.strategyId,
              liveOrderId: liveOrder?.id,
              provider: connection.provider,
              environment: connection.environment,
              symbol: fill.symbol,
              exchangeTradeId: fill.exchangeTradeId,
              exchangeOrderId: fill.exchangeOrderId,
              clientOrderId: fill.clientOrderId,
              side: fill.side,
              positionSide: fill.positionSide,
              price: fill.price,
              quantity: fill.quantity,
              quoteQuantity: fill.quoteQuantity,
              realizedPnl: fill.realizedPnl,
              fee: fill.fee,
              feeAsset: fill.feeAsset,
              isMaker: fill.isMaker,
              isClosing,
              executedAt: fill.executedAt,
            },
          });
          if (isClosing) affectedOrderIds.add(fill.exchangeOrderId);
        }),
      );
    }

    let closedTrades = 0;
    for (const exchangeOrderId of affectedOrderIds) {
      if (await this.rebuildClosedTrade(userId, connection, exchangeOrderId)) {
        closedTrades++;
      }
    }
    if (options.refreshDerived !== false) await this.refreshDerivedData(userId);
    return { fills: fills.length, closedTrades };
  }

  async refreshDerivedData(userId: string): Promise<void> {
    await this.refreshStrategyPerformance(userId);
    await this.refreshSelfLearningInsights(userId);
  }

  private async rebuildClosedTrade(
    userId: string,
    connection: Pick<ExchangeConnection, "id" | "provider" | "environment">,
    exchangeOrderId: string,
  ): Promise<boolean> {
    const fills = await this.prisma.exchangeFill.findMany({
      where: { connectionId: connection.id, exchangeOrderId, isClosing: true },
      orderBy: { executedAt: "asc" },
    });
    if (!fills.length) return false;

    const quantity = sum(fills, "quantity");
    if (!(quantity > 0)) return false;
    const grossPnl = sum(fills, "realizedPnl");
    const settlementAsset = fills[0]!.symbol.split("-").at(-1)?.toUpperCase();
    const feesConvertible = fills.every(
      (fill) => !fill.feeAsset || fill.feeAsset.toUpperCase() === settlementAsset,
    );
    const closingFee = feesConvertible ? sum(fills, "fee") : 0;
    const exitPrice = fills.reduce(
      (total, fill) => total + Number(fill.price) * Number(fill.quantity),
      0,
    ) / quantity;
    const derivedEntries = fills.map((fill) => {
      const fillQuantity = Number(fill.quantity);
      const exit = Number(fill.price);
      const pnl = Number(fill.realizedPnl);
      if (!(fillQuantity > 0) || !Number.isFinite(exit) || !Number.isFinite(pnl)) return null;
      return fill.side === "SELL"
        ? exit - pnl / fillQuantity
        : exit + pnl / fillQuantity;
    });
    const derivedEntryComplete = derivedEntries.every(
      (entry) => entry !== null && Number.isFinite(entry) && entry > 0,
    );
    const derivedEntryPrice = derivedEntryComplete
      ? derivedEntries.reduce<number>(
          (total, entry, index) =>
            total + Number(entry) * Number(fills[index]!.quantity),
          0,
        ) / quantity
      : null;
    const allocation = await this.entryAllocationForOrder(
      connection.id,
      fills[0]!.symbol,
      exchangeOrderId,
      settlementAsset,
    );
    const entryPrice = allocation.complete ? allocation.entryPrice : derivedEntryPrice;
    const fee = closingFee + allocation.openingFee;
    const netPnl = grossPnl + fee;
    const sourceOrder = fills.find((fill) => fill.liveOrderId)?.liveOrderId
      ? await this.prisma.liveOrder.findUnique({
          where: { id: fills.find((fill) => fill.liveOrderId)!.liveOrderId! },
        })
      : null;
    // The nearest opening order is only a timestamp fallback. Strategy
    // attribution must come from the closing order or the FIFO lots actually
    // consumed; a later opening order for the same symbol may belong to a
    // different strategy.
    const openingOrder = await this.prisma.liveOrder.findFirst({
      where: {
        userId,
        connectionId: connection.id,
        symbol: fills[0]!.symbol,
        purpose: { in: ["OPEN", "REVERSE"] },
        status: "FILLED",
        createdAt: { lte: fills[0]!.executedAt },
      },
      orderBy: { createdAt: "desc" },
    });
    const strategyId =
      sourceOrder?.strategyId ??
      allocation.strategyId ??
      fills.find((fill) => fill.strategyId)?.strategyId ??
      null;
    const closedAt = fills.at(-1)!.executedAt;
    const sourceDataComplete = allocation.complete && feesConvertible;
    const returnPct = entryPrice && entryPrice > 0
      ? netPnl / (entryPrice * quantity)
      : null;

    const trade = await this.prisma.closedTrade.upsert({
      where: { connectionId_exchangeOrderId: { connectionId: connection.id, exchangeOrderId } },
      update: {
        strategyId,
        side: fills[0]!.side,
        positionSide: fills[0]!.positionSide,
        quantity,
        entryPrice,
        exitPrice,
        grossPnl,
        fee,
        netPnl,
        returnPct,
        closeReason: sourceOrder?.purpose ?? "EXCHANGE_FILL",
        sourceDataComplete,
        openedAt: allocation.openedAt ?? openingOrder?.createdAt,
        closedAt,
      },
      create: {
        userId,
        connectionId: connection.id,
        strategyId,
        provider: connection.provider,
        environment: connection.environment,
        symbol: fills[0]!.symbol,
        exchangeOrderId,
        side: fills[0]!.side,
        positionSide: fills[0]!.positionSide,
        quantity,
        entryPrice,
        exitPrice,
        grossPnl,
        fee,
        netPnl,
        returnPct,
        closeReason: sourceOrder?.purpose ?? "EXCHANGE_FILL",
        sourceDataComplete,
        openedAt: allocation.openedAt ?? openingOrder?.createdAt,
        closedAt,
      },
    });
    await this.archiveTrade(trade, fills);
    return true;
  }

  private async entryAllocationForOrder(
    connectionId: string,
    symbol: string,
    targetOrderId: string,
    settlementAsset?: string,
  ): Promise<{
    complete: boolean;
    entryPrice: number | null;
    openingFee: number;
    openedAt: Date | null;
    strategyId: string | null;
  }> {
    const history = await this.prisma.exchangeFill.findMany({
      where: { connectionId, symbol },
      orderBy: { executedAt: "asc" },
    });
    type Lot = {
      quantity: number;
      price: number;
      fee: number;
      feeConvertible: boolean;
      openedAt: Date;
      strategyId: string | null;
    };
    const lots: Record<"LONG" | "SHORT", Lot[]> = { LONG: [], SHORT: [] };
    let matchedQuantity = 0;
    let entryNotional = 0;
    let openingFee = 0;
    let complete = true;
    let openedAtMs: number | undefined;
    const consumedStrategyIds = new Set<string | null>();

    for (const fill of history) {
      const quantity = Number(fill.quantity);
      if (!(quantity > 0)) continue;
      const explicitSide = fill.positionSide === "LONG" || fill.positionSide === "SHORT"
        ? fill.positionSide
        : null;
      if (!fill.isClosing) {
        const position = explicitSide ?? (fill.side === "BUY" ? "LONG" : "SHORT");
        lots[position].push({
          quantity,
          price: Number(fill.price),
          fee: Number(fill.fee),
          feeConvertible: !fill.feeAsset || fill.feeAsset.toUpperCase() === settlementAsset,
          openedAt: fill.executedAt,
          strategyId: fill.strategyId,
        });
        continue;
      }

      const position = explicitSide ?? (fill.side === "SELL" ? "LONG" : "SHORT");
      let remaining = quantity;
      while (remaining > 1e-12 && lots[position].length) {
        const lot = lots[position][0]!;
        const before = lot.quantity;
        const consumed = Math.min(remaining, before);
        const allocatedFee = before > 0 ? lot.fee * (consumed / before) : 0;
        if (fill.exchangeOrderId === targetOrderId) {
          matchedQuantity += consumed;
          entryNotional += lot.price * consumed;
          openingFee += lot.feeConvertible ? allocatedFee : 0;
          complete = complete && lot.feeConvertible;
          openedAtMs = Math.min(openedAtMs ?? Number.POSITIVE_INFINITY, lot.openedAt.getTime());
          consumedStrategyIds.add(lot.strategyId);
        }
        lot.quantity -= consumed;
        lot.fee -= allocatedFee;
        remaining -= consumed;
        if (lot.quantity <= 1e-12) lots[position].shift();
      }
      if (fill.exchangeOrderId === targetOrderId && remaining > 1e-9) complete = false;
    }
    const targetQuantity = history
      .filter((fill) => fill.exchangeOrderId === targetOrderId && fill.isClosing)
      .reduce((total, fill) => total + Number(fill.quantity), 0);
    complete = complete && targetQuantity > 0 && Math.abs(matchedQuantity - targetQuantity) <= Math.max(1e-9, targetQuantity * 1e-8);
    return {
      complete,
      entryPrice: matchedQuantity > 0 ? entryNotional / matchedQuantity : null,
      openingFee,
      openedAt: openedAtMs === undefined ? null : new Date(openedAtMs),
      strategyId: consumedStrategyIds.size === 1
        ? [...consumedStrategyIds][0] ?? null
        : null,
    };
  }

  private async refreshStrategyPerformance(userId: string): Promise<void> {
    const strategies = await this.prisma.portfolioStrategy.findMany({ where: { userId } });
    for (const strategy of strategies) {
      const trades = await this.prisma.closedTrade.findMany({
        where: { strategyId: strategy.id },
        orderBy: { closedAt: "asc" },
      });
      const cycles = aggregateClosedTradeCycles(trades);
      const total = cycles.length;
      const wins = cycles.filter((trade) => trade.netPnl > 0).length;
      const returns = cycles.flatMap((trade) => trade.returnPct === null ? [] : [trade.returnPct]);
      const realizedPnl = cycles.reduce((sumValue, trade) => sumValue + trade.netPnl, 0);
      let equity = 1;
      let peak = 1;
      let maxDrawdown = 0;
      for (const value of returns) {
        equity *= 1 + value;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 1);
      }
      const mean = returns.length
        ? returns.reduce((sumValue, value) => sumValue + value, 0) / returns.length
        : 0;
      const deviation = returns.length > 1
        ? Math.sqrt(returns.reduce((sumValue, value) => sumValue + (value - mean) ** 2, 0) / (returns.length - 1))
        : 0;
      await this.prisma.strategyPerformance.upsert({
        where: { strategyId: strategy.id },
        update: {
          totalTrades: total,
          winningTrades: wins,
          winRate: total ? wins / total : 0,
          returnPct: equity - 1,
          drawdownPct: maxDrawdown,
          sharpeRatio: deviation > 0 ? (mean / deviation) * Math.sqrt(365) : null,
          realizedPnl,
        },
        create: { strategyId: strategy.id },
      });
    }
  }

  private async refreshSelfLearningInsights(userId: string): Promise<void> {
    const trades = await this.prisma.closedTrade.findMany({
      where: { userId },
      orderBy: { closedAt: "asc" },
    });
    const cycles = aggregateClosedTradeCycles(trades);
    const bySymbol = new Map<string, typeof cycles>();
    for (const trade of cycles) {
      const rows = bySymbol.get(trade.symbol) ?? [];
      rows.push(trade);
      bySymbol.set(trade.symbol, rows);
    }
    const insights = [...bySymbol.entries()]
      .filter(([, rows]) => rows.length >= 2)
      .map(([symbol, rows]) => {
        const wins = rows.filter((trade) => trade.netPnl > 0).length;
        const netPnl = rows.reduce((sumValue, trade) => sumValue + trade.netPnl, 0);
        const winRate = wins / rows.length;
        const winning = netPnl > 0 && winRate >= 0.5;
        return {
          userId,
          insightType: winning ? "WINNING_PATTERN" : "LOSING_PATTERN",
          tradeSymbol: symbol,
          summary: `${symbol} has ${rows.length} verified exchange trades, ${(winRate * 100).toFixed(1)}% win rate and ${netPnl.toFixed(4)} net PnL.`,
          evidenceJson: {
            source: "EXCHANGE_CLOSED_TRADE_LEDGER",
            tradeIds: rows.flatMap((trade) => trade.tradeIds),
            totalTrades: rows.length,
            completeTrades: rows.filter((trade) => trade.sourceDataComplete).length,
            wins,
            winRate,
            netPnl,
          },
          recommendation: winning
            ? "Preserve this symbol's current rules until a larger verified sample supports a controlled change."
            : "Review entry timing, stop placement and fees for this symbol before increasing allocation.",
        };
      });
    await this.prisma.$transaction([
      this.prisma.selfLearningInsight.deleteMany({ where: { userId } }),
      ...(insights.length
        ? [this.prisma.selfLearningInsight.createMany({ data: insights })]
        : []),
    ]);
  }

  private async archiveTrade(trade: {
    id: string; userId: string; symbol: string; exchangeOrderId: string;
    grossPnl: Prisma.Decimal; fee: Prisma.Decimal; netPnl: Prisma.Decimal;
    returnPct: number | null; entryPrice: Prisma.Decimal | null;
    exitPrice: Prisma.Decimal; quantity: Prisma.Decimal; closedAt: Date;
    sourceDataComplete: boolean;
  }, fills: ExchangeFill[]): Promise<void> {
    const reproducibleHash = createHash("sha256")
      .update(`${trade.userId}:${trade.id}:${trade.exchangeOrderId}`)
      .digest("hex");
    const content = {
      source: "EXCHANGE_FILL",
      closedTradeId: trade.id,
      exchangeOrderId: trade.exchangeOrderId,
      symbol: trade.symbol,
      entryPrice: trade.entryPrice ? Number(trade.entryPrice) : null,
      exitPrice: Number(trade.exitPrice),
      quantity: Number(trade.quantity),
      grossPnl: Number(trade.grossPnl),
      fee: Number(trade.fee),
      netPnl: Number(trade.netPnl),
      returnPct: trade.returnPct,
      sourceDataComplete: trade.sourceDataComplete,
      exchangeTradeIds: fills.map((fill) => fill.exchangeTradeId),
      closedAt: trade.closedAt.toISOString(),
    };
    await this.prisma.knowledgeArchive.upsert({
      where: { userId_reproducibleHash: { userId: trade.userId, reproducibleHash } },
      update: {
        summary: `${trade.symbol}: net PnL ${Number(trade.netPnl).toFixed(4)} from verified exchange fills.`,
        contentJson: content,
      },
      create: {
        userId: trade.userId,
        title: `Closed trade ${trade.symbol} · ${trade.closedAt.toISOString()}`,
        category: "DECISION_HISTORY",
        summary: `${trade.symbol}: net PnL ${Number(trade.netPnl).toFixed(4)} from verified exchange fills.`,
        contentJson: content,
        reproducibleHash,
      },
    });
  }
}

function sum(rows: ExchangeFill[], field: "quantity" | "realizedPnl" | "fee"): number {
  return rows.reduce((total, row) => total + Number(row[field]), 0);
}
