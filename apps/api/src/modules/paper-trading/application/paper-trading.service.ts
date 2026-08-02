import { Injectable, Logger, Optional } from "@nestjs/common";
import type { DecisionOutput, RiskOutput } from "@platform/shared";
import { Prisma, type ExchangeProvider } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { PublicExchangeService } from "../../../exchange/application/public-exchange.service";
import { ExchangeProvider as DomainExchangeProvider } from "../../../exchange/domain/exchange.types";
import {
  calculateFee,
  calculatePnL,
  deterministicSlippage,
  executionPrice,
  maximumDrawdown,
  protectiveExitAtPrices,
  round,
  type OrderSide,
  type PositionSide,
} from "../domain/paper-trading";
import { PaperTradingConfigService } from "./paper-trading-config.service";
import { RiskManagementService } from "../../risk/application/risk-management.service";
import { PortfolioService } from "../../portfolio/application/portfolio.service";

type Tx = Prisma.TransactionClient;
type CloseReason =
  | "SIGNAL_REVERSAL"
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "LIQUIDATION"
  | "PORTFOLIO_FAILSAFE";

export interface ExecuteDecisionInput {
  userId: string;
  pipelineRunId: string;
  symbol: string;
  provider: ExchangeProvider;
  decision: DecisionOutput;
  /** Latest ATR in quote-currency units; normalized against the execution price. */
  volatilityAtr?: number;
  /** Portfolio strategy key. Existing callers are assigned to the AI core strategy. */
  strategyKey?: string;
}

@Injectable()
export class PaperTradingService {
  private readonly logger = new Logger(PaperTradingService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchanges: PublicExchangeService,
    private readonly config: PaperTradingConfigService,
    private readonly risk: RiskManagementService,
    @Optional() private readonly portfolio?: PortfolioService,
  ) {}

  async execute(
    input: ExecuteDecisionInput,
  ): Promise<{ outcome: string; price: number; risk?: RiskOutput }> {
    const settings = this.config.values;
    if (!settings.enabled) return { outcome: "DISABLED", price: 0 };
    const strategy = await this.portfolio?.prepareStrategy(
      input.userId,
      input.strategyKey ?? "ai-core",
    );
    const ticker = await this.exchanges.ticker(
      input.provider as DomainExchangeProvider,
      input.symbol,
    );
    const price = Number(ticker.markPrice ?? ticker.lastPrice);
    if (!Number.isFinite(price) || price <= 0)
      throw new Error("PAPER_TRADING_INVALID_MARK_PRICE");

    const result = await this.prisma.$transaction(
      async (tx) => {
        const duplicate = await tx.paperSignal.findUnique({
          where: { pipelineRunId: input.pipelineRunId },
        });
        if (duplicate) {
          const assessment = await tx.riskAssessment.findUnique({
            where: { pipelineRunId: input.pipelineRunId },
          });
          return {
            outcome: duplicate.outcome,
            risk: assessment ? this.riskOutput(assessment) : undefined,
          };
        }
        let account = await tx.paperAccount.upsert({
          where: { userId: input.userId },
          update: {},
          create: {
            userId: input.userId,
            balance: settings.initialBalance,
            equity: settings.initialBalance,
            peakEquity: settings.initialBalance,
          },
        });
        let position = await tx.paperPosition.findUnique({
          where: {
            accountId_symbol: { accountId: account.id, symbol: input.symbol },
          },
        });
        let outcome =
          settings.mode === "SIGNAL_ONLY"
            ? "SIGNAL_RECORDED"
            : input.decision.decision === "WAIT"
              ? "WAIT"
              : "NO_CHANGE";

        if (settings.mode === "PAPER_TRADING" && position) {
          const unrealized = round(
            calculatePnL(
              position.side as PositionSide,
              Number(position.entryPrice),
              price,
              Number(position.size),
            ),
          );
          position = await tx.paperPosition.update({
            where: { id: position.id },
            data: { markPrice: price, unrealizedPnL: unrealized },
          });
          const reason = protectiveExitAtPrices(
            position.side as PositionSide,
            price,
            unrealized,
            (Number(position.entryPrice) * Number(position.size)) /
              position.leverage,
            Number(position.stopLoss),
            Number(position.takeProfit),
          );
          if (reason) {
            account = await this.close(
              tx,
              account.id,
              position,
              price,
              reason,
              input.pipelineRunId,
            );
            position = null;
            outcome = reason;
          }
        }

        account = await this.refreshAccount(tx, account.id);
        const [paperPositionsForRisk, paperLatestOpen] = await Promise.all([
          tx.paperPosition.findMany({ where: { accountId: account.id } }),
          tx.simulatedOrder.findFirst({
            where: {
              accountId: account.id,
              purpose: { in: ["OPEN", "REVERSAL_OPEN"] },
            },
            orderBy: { createdAt: "desc" },
          }),
        ]);
        let positionsForRisk: Array<{
          symbol: string;
          size: Prisma.Decimal;
          markPrice: Prisma.Decimal;
        }> = paperPositionsForRisk;
        let latestOpen: { createdAt: Date } | null = paperLatestOpen;
        let riskAccount = account;
        if (["DEMO", "LIVE"].includes(settings.mode)) {
          const environment =
            settings.mode === "LIVE"
              ? "PRODUCTION"
              : input.provider === "BINANCE_FUTURES"
                ? "TESTNET"
                : "DEMO";
          const connection = await tx.exchangeConnection.findFirst({
            where: {
              userId: input.userId,
              provider: input.provider,
              environment,
              isEnabled: true,
              isVerified: true,
            },
          });
          const [snapshot, peak, exchangePositions, exchangeOrder] = connection
            ? await Promise.all([
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
              ])
            : [null, { _max: { totalEquity: null } }, [], null];
          riskAccount = snapshot
            ? {
                ...account,
                balance: snapshot.totalEquity,
                equity: snapshot.totalEquity,
                peakEquity: peak._max.totalEquity ?? snapshot.totalEquity,
              }
            : {
                ...account,
                balance: new Prisma.Decimal(0),
                equity: new Prisma.Decimal(0),
                peakEquity: new Prisma.Decimal(0),
              };
          positionsForRisk = exchangePositions.map((position) => ({
            ...position,
            size: position.quantity,
            markPrice: position.markPrice ?? position.entryPrice,
          }));
          latestOpen = exchangeOrder;
        }
        let risk = await this.risk.assess(tx, {
          userId: input.userId,
          strategyId: strategy?.id,
          pipelineRunId: input.pipelineRunId,
          symbol: input.symbol,
          decision: input.decision,
          account: riskAccount,
          positions: positionsForRisk,
          price,
          volatility: this.decisionVolatility(
            input.decision,
            price,
            input.volatilityAtr,
          ),
          lastTradeAt: latestOpen?.createdAt,
        });
        let portfolioFailsafe = false;
        if (
          risk.approved &&
          risk.positionSize &&
          input.decision.decision !== "WAIT"
        ) {
          const portfolioRisk = await this.portfolio?.assessTrade(tx, {
            userId: input.userId,
            strategyId: strategy?.id ?? "",
            pipelineRunId: input.pipelineRunId,
            symbol: input.symbol,
            side: input.decision.decision,
            requestedNotional: risk.positionSize * price,
            equity: Number(riskAccount.equity),
            peakEquity: Number(riskAccount.peakEquity),
          });
          portfolioFailsafe = portfolioRisk?.failsafe ?? false;
          if (portfolioRisk && !portfolioRisk.approved) {
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
            portfolioRisk &&
            portfolioRisk.approvedNotional < risk.positionSize * price
          ) {
            risk = {
              ...risk,
              positionSize: round(portfolioRisk.approvedNotional / price, 12),
            };
            await tx.riskAssessment.update({
              where: { pipelineRunId: input.pipelineRunId },
              data: { positionSize: risk.positionSize },
            });
          }
        }
        if (portfolioFailsafe && position) {
          account = await this.close(
            tx,
            account.id,
            position,
            price,
            "PORTFOLIO_FAILSAFE",
            input.pipelineRunId,
          );
          position = null;
          outcome = "PORTFOLIO_FAILSAFE";
        }

        if (
          settings.mode === "PAPER_TRADING" &&
          !["WAIT"].includes(input.decision.decision) &&
          ![
            "STOP_LOSS",
            "TAKE_PROFIT",
            "LIQUIDATION",
            "PORTFOLIO_FAILSAFE",
          ].includes(outcome)
        ) {
          const desired = input.decision.decision as PositionSide;
          const requiresExecution = !position || position.side !== desired;
          if (requiresExecution && !risk.approved) {
            outcome = `RISK_REJECTED_${risk.reason ?? "UNSPECIFIED"}`;
          } else if (position && position.side !== desired) {
            account = await this.close(
              tx,
              account.id,
              position,
              price,
              "SIGNAL_REVERSAL",
              input.pipelineRunId,
            );
            position = null;
            outcome = "POSITION_REVERSED";
          }
          if (
            !position &&
            risk.approved &&
            risk.positionSize &&
            risk.leverage &&
            risk.stopLoss &&
            risk.takeProfit
          ) {
            account = await this.open(
              tx,
              account.id,
              strategy?.id,
              input.symbol,
              desired,
              price,
              input.pipelineRunId,
              outcome === "POSITION_REVERSED" ? "REVERSAL_OPEN" : "OPEN",
              {
                positionSize: risk.positionSize,
                leverage: risk.leverage,
                stopLoss: risk.stopLoss,
                takeProfit: risk.takeProfit,
              },
            );
            if (strategy)
              await this.portfolio?.recordPosition(tx, {
                strategyId: strategy.id,
                symbol: input.symbol,
                side: desired,
                quantity: risk.positionSize,
                entryPrice: price,
                markPrice: price,
              });
            outcome =
              outcome === "POSITION_REVERSED" ? outcome : "POSITION_OPENED";
          } else if (position?.side === desired) {
            outcome = "POSITION_MAINTAINED";
            if (strategy && risk.approved && risk.positionSize)
              await this.portfolio?.recordPosition(tx, {
                strategyId: strategy.id,
                symbol: input.symbol,
                side: desired,
                quantity: risk.positionSize,
                entryPrice: Number(position.entryPrice),
                markPrice: price,
              });
          }
        }

        await this.refreshAccount(tx, account.id);
        await tx.paperSignal.create({
          data: {
            userId: input.userId,
            pipelineRunId: input.pipelineRunId,
            symbol: input.symbol,
            decision: input.decision.decision,
            confidence: input.decision.confidence,
            mode: settings.mode,
            referencePrice: price,
            outcome,
          },
        });
        return { outcome, risk };
      },
      { isolationLevel: "Serializable" },
    );
    this.logger.log({
      event: "paper_decision_processed",
      runId: input.pipelineRunId,
      symbol: input.symbol,
      decision: input.decision.decision,
      outcome: result.outcome,
      riskApproved: result.risk?.approved,
    });
    return { ...result, price };
  }

  async dashboard(userId: string) {
    const settings = this.config.values;
    const account = await this.prisma.paperAccount.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        balance: settings.initialBalance,
        equity: settings.initialBalance,
        peakEquity: settings.initialBalance,
      },
    });
    const [positions, orders, trades, signals] = await Promise.all([
      this.prisma.paperPosition.findMany({
        where: { accountId: account.id },
        orderBy: { openedAt: "desc" },
      }),
      this.prisma.simulatedOrder.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.paperTrade.findMany({
        where: { accountId: account.id },
        orderBy: { closedAt: "desc" },
        take: 500,
      }),
      this.prisma.paperSignal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const netResults = trades.map(
      (trade) => Number(trade.pnl) - Number(trade.fee),
    );
    const grossProfit = netResults
      .filter((value) => value > 0)
      .reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(
      netResults
        .filter((value) => value < 0)
        .reduce((sum, value) => sum + value, 0),
    );
    const equityCurve = [...trades]
      .reverse()
      .reduce<Array<{ at: string; equity: number }>>(
        (curve, trade) => {
          const previous = curve.at(-1)?.equity ?? settings.initialBalance;
          curve.push({
            at: trade.closedAt.toISOString(),
            equity: round(previous + Number(trade.pnl) - Number(trade.fee)),
          });
          return curve;
        },
        [
          {
            at: account.createdAt.toISOString(),
            equity: settings.initialBalance,
          },
        ],
      );
    return {
      mode: settings.mode,
      account: this.accountView(account),
      positions: positions.map((row) => ({
        symbol: row.symbol,
        side: row.side,
        size: Number(row.size),
        entryPrice: Number(row.entryPrice),
        markPrice: Number(row.markPrice),
        leverage: row.leverage,
        stopLoss: Number(row.stopLoss),
        takeProfit: Number(row.takeProfit),
        unrealizedPnL: Number(row.unrealizedPnL),
        realizedPnL: Number(row.realizedPnL),
        openedAt: row.openedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      orders: orders.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        side: row.side,
        type: row.type,
        quantity: Number(row.quantity),
        executedPrice: Number(row.executedPrice),
        slippagePct: Number(row.slippagePct),
        fee: Number(row.fee),
        status: row.status,
        purpose: row.purpose,
        createdAt: row.createdAt.toISOString(),
      })),
      trades: trades.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        side: row.side,
        entryPrice: Number(row.entryPrice),
        exitPrice: Number(row.exitPrice),
        size: Number(row.size),
        pnl: Number(row.pnl),
        fee: Number(row.fee),
        returnPct: Number(row.returnPct),
        closeReason: row.closeReason,
        durationMs: Number(row.durationMs),
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt.toISOString(),
      })),
      signals: signals.map((row) => ({
        ...row,
        referencePrice: Number(row.referencePrice),
        createdAt: row.createdAt.toISOString(),
      })),
      metrics: {
        totalTrades: trades.length,
        winRate: trades.length
          ? round(
              (netResults.filter((value) => value > 0).length / trades.length) *
                100,
              2,
            )
          : 0,
        averageReturn: trades.length
          ? round(
              trades.reduce((sum, trade) => sum + Number(trade.returnPct), 0) /
                trades.length,
              4,
            )
          : 0,
        maxDrawdown: maximumDrawdown(equityCurve.map((point) => point.equity)),
        profitFactor: grossLoss
          ? round(grossProfit / grossLoss, 4)
          : grossProfit > 0
            ? null
            : 0,
        totalPnl: round(Number(account.balance) - settings.initialBalance),
      },
      equityCurve,
    };
  }

  private async open(
    tx: Tx,
    accountId: string,
    strategyId: string | undefined,
    symbol: string,
    side: PositionSide,
    referencePrice: number,
    runId: string,
    purpose: string,
    risk: Required<
      Pick<RiskOutput, "positionSize" | "leverage" | "stopLoss" | "takeProfit">
    >,
  ) {
    const settings = this.config.values;
    const account = await tx.paperAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    const quantity = round(risk.positionSize, 12);
    const orderSide: OrderSide = side === "LONG" ? "BUY" : "SELL";
    const slippage = deterministicSlippage(
      `${runId}:${purpose}:${orderSide}`,
      settings.slippageMin,
      settings.slippageMax,
    );
    const filled = round(executionPrice(referencePrice, orderSide, slippage));
    const fee = round(calculateFee(filled, quantity, settings.feeRate));
    const margin = round((filled * quantity) / risk.leverage);
    if (quantity <= 0 || Number(account.balance) < fee + margin)
      throw new Error("PAPER_TRADING_INSUFFICIENT_BALANCE");
    await tx.simulatedOrder.create({
      data: {
        accountId,
        pipelineRunId: runId,
        symbol,
        side: orderSide,
        quantity,
        referencePrice,
        executedPrice: filled,
        slippagePct: slippage,
        fee,
        purpose,
      },
    });
    await tx.paperPosition.create({
      data: {
        accountId,
        strategyId,
        symbol,
        side,
        size: quantity,
        entryPrice: filled,
        markPrice: referencePrice,
        leverage: risk.leverage,
        stopLoss: risk.stopLoss,
        takeProfit: risk.takeProfit,
        unrealizedPnL: calculatePnL(side, filled, referencePrice, quantity),
        entryFee: fee,
      },
    });
    return tx.paperAccount.update({
      where: { id: accountId },
      data: { balance: { decrement: fee }, marginUsed: { increment: margin } },
    });
  }

  private async close(
    tx: Tx,
    accountId: string,
    position: {
      id: string;
      strategyId?: string | null;
      symbol: string;
      side: string;
      size: Prisma.Decimal;
      entryPrice: Prisma.Decimal;
      entryFee: Prisma.Decimal;
      leverage: number;
      openedAt: Date;
    },
    referencePrice: number,
    reason: CloseReason,
    runId: string,
  ) {
    const settings = this.config.values;
    const side: OrderSide = position.side === "LONG" ? "SELL" : "BUY";
    const slippage = deterministicSlippage(
      `${runId}:CLOSE:${reason}:${side}`,
      settings.slippageMin,
      settings.slippageMax,
    );
    const filled = round(executionPrice(referencePrice, side, slippage));
    const quantity = Number(position.size);
    const exitFee = round(calculateFee(filled, quantity, settings.feeRate));
    const pnl = round(
      calculatePnL(
        position.side as PositionSide,
        Number(position.entryPrice),
        filled,
        quantity,
      ),
    );
    const totalFee = round(Number(position.entryFee) + exitFee);
    const margin = round(
      (Number(position.entryPrice) * quantity) / position.leverage,
    );
    await tx.simulatedOrder.create({
      data: {
        accountId,
        pipelineRunId: runId,
        symbol: position.symbol,
        side,
        quantity,
        referencePrice,
        executedPrice: filled,
        slippagePct: slippage,
        fee: exitFee,
        purpose: reason,
      },
    });
    await tx.paperTrade.create({
      data: {
        accountId,
        symbol: position.symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice: filled,
        size: position.size,
        pnl,
        fee: totalFee,
        returnPct: round(
          (pnl / (Number(position.entryPrice) * quantity)) * 100,
        ),
        closeReason: reason,
        durationMs: BigInt(Date.now() - position.openedAt.getTime()),
        openedAt: position.openedAt,
      },
    });
    if (position.strategyId)
      await this.portfolio?.recordTradeResult(
        tx,
        position.strategyId,
        position.symbol,
        pnl - totalFee,
        (pnl - totalFee) / (Number(position.entryPrice) * quantity),
      );
    if (position.strategyId)
      await this.portfolio?.closePosition(
        tx,
        position.strategyId,
        position.symbol,
      );
    await tx.paperPosition.delete({ where: { id: position.id } });
    return tx.paperAccount.update({
      where: { id: accountId },
      data: {
        balance: { increment: round(pnl - exitFee) },
        marginUsed: { decrement: margin },
      },
    });
  }

  private async refreshAccount(tx: Tx, accountId: string) {
    const [account, positions] = await Promise.all([
      tx.paperAccount.findUniqueOrThrow({ where: { id: accountId } }),
      tx.paperPosition.findMany({ where: { accountId } }),
    ]);
    const margin = round(
      positions.reduce(
        (sum, row) =>
          sum + (Number(row.entryPrice) * Number(row.size)) / row.leverage,
        0,
      ),
    );
    const equity = round(
      Number(account.balance) +
        positions.reduce((sum, row) => sum + Number(row.unrealizedPnL), 0),
    );
    return tx.paperAccount.update({
      where: { id: accountId },
      data: {
        marginUsed: margin,
        equity,
        peakEquity: Math.max(Number(account.peakEquity), equity),
      },
    });
  }

  private accountView(account: {
    id: string;
    balance: Prisma.Decimal;
    equity: Prisma.Decimal;
    marginUsed: Prisma.Decimal;
    createdAt: Date;
  }) {
    return {
      id: account.id,
      balance: Number(account.balance),
      equity: Number(account.equity),
      marginUsed: Number(account.marginUsed),
      createdAt: account.createdAt.toISOString(),
    };
  }

  private decisionVolatility(
    decision: DecisionOutput,
    price: number,
    atr?: number,
  ): number {
    const observed =
      atr !== undefined && Number.isFinite(atr) && atr >= 0
        ? atr / price
        : undefined;
    const regimeFloor =
      decision.regime?.type === "HIGH_VOLATILITY"
        ? 0.05
        : decision.regime?.type === "TRENDING"
          ? 0.025
          : 0.015;
    return observed === undefined
      ? regimeFloor
      : Math.max(observed, regimeFloor);
  }

  private riskOutput(row: {
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
