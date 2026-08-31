import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { ExchangeConnectionService } from "../../../exchange/application/exchange-connection.service";
import {
  assertAsymmetricSafety,
  evaluatePositionCopilot,
} from "../domain/position-copilot";
import type {
  CopilotDecision,
  CopilotTriggerEvent,
  InFlightMarketContext,
  PositionCopilotInput,
} from "../domain/position-copilot.types";
import type { TradePlan } from "../../risk/domain/trade-plan-engine";
import type { LiveOrder, LivePosition } from "@prisma/client";
import type { RequestMetadata } from "../../../common/request-context";

export interface InspectPositionResult {
  inspected: boolean;
  decision: CopilotDecision;
  actionExecuted: boolean;
  executionError?: string;
}

@Injectable()
export class PositionCopilotService {
  private readonly logger = new Logger(PositionCopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ExchangeConnectionService,
  ) {}

  /**
   * Inspects an active position, applies AI reasoning, and executes the adaptation directive.
   */
  async inspectAndExecute(params: {
    userId: string;
    connectionId: string;
    position: LivePosition;
    order: LiveOrder;
    context: InFlightMarketContext;
    triggerEvent?: CopilotTriggerEvent;
    requestContext?: RequestMetadata;
  }): Promise<InspectPositionResult> {
    const { userId, connectionId, position, order, context, requestContext = {} } = params;

    const rawPlan = order.tradePlan as Record<string, unknown> | null;
    if (!rawPlan) {
      return {
        inspected: false,
        decision: {
          action: "HOLD",
          confidence: 0,
          reason: "No active trade plan associated with order",
          urgency: "LOW",
          evaluatedAt: new Date(),
          thesisHealthScore: 50,
        },
        actionExecuted: false,
      };
    }

    const triggerEvent: CopilotTriggerEvent = params.triggerEvent ?? "SCHEDULED_POLL";
    const entryPrice = Number(position.entryPrice);
    const initialStopLoss = Number(order.initialStopLoss ?? order.stopLoss);
    const currentStopLoss = Number(order.stopLoss);
    const markPrice = context.markPrice || Number(position.markPrice ?? entryPrice);

    const input: PositionCopilotInput = {
      positionId: position.id,
      symbol: position.symbol,
      side: position.side as "LONG" | "SHORT",
      entryPrice,
      markPrice,
      quantity: Number(position.quantity),
      initialStopLoss,
      currentStopLoss,
      takeProfit: order.takeProfit ? Number(order.takeProfit) : undefined,
      highestMark: order.highestMark ? Number(order.highestMark) : undefined,
      lowestMark: order.lowestMark ? Number(order.lowestMark) : undefined,
      openedAt: order.createdAt,
      plan: rawPlan as unknown as TradePlan,
      triggerEvent,
      context,
    };

    const decision = evaluatePositionCopilot(input);

    // Enforce Ironclad Asymmetric Safety
    const safety = assertAsymmetricSafety(
      input.side,
      input.currentStopLoss,
      decision.proposedStopLoss,
    );

    if (!safety.valid) {
      this.logger.error({
        event: "copilot_safety_violation_blocked",
        positionId: position.id,
        symbol: position.symbol,
        violation: safety.violation,
      });
      decision.action = "HOLD";
      decision.safetyViolations = [safety.violation ?? "SAFETY_GUARD_VIOLATION"];
      return {
        inspected: true,
        decision,
        actionExecuted: false,
        executionError: safety.violation,
      };
    }

    let actionExecuted = false;
    let executionError: string | undefined;

    try {
      if (decision.action === "DEFENSIVE_EXIT" || decision.action === "ACCELERATE_TP") {
        this.logger.log({
          event: "copilot_exit_dispatched",
          action: decision.action,
          symbol: position.symbol,
          side: position.side,
          reason: decision.reason,
          healthScore: decision.thesisHealthScore,
        });

        await this.connections.placeOrder(
          userId,
          connectionId,
          {
            symbol: position.symbol,
            side: position.side === "LONG" ? "SELL" : "BUY",
            quantity: String(position.quantity),
            leverage: position.leverage ?? 1,
            clientOrderId: `copilot-${Date.now().toString(36)}`,
            reduceOnly: true,
          },
          requestContext,
        );

        actionExecuted = true;
      } else if (decision.action === "TIGHTEN_STOP_LOSS" && decision.proposedStopLoss !== undefined) {
        this.logger.log({
          event: "copilot_sl_tightened",
          symbol: position.symbol,
          oldStop: currentStopLoss,
          newStop: decision.proposedStopLoss,
          reason: decision.reason,
        });

        if (order.protectiveClientOrderId) {
          await this.connections.amendProtectiveOrder(
            userId,
            connectionId,
            {
              symbol: position.symbol,
              protectiveClientOrderId: order.protectiveClientOrderId,
              stopLoss: String(decision.proposedStopLoss),
              ...(order.takeProfit ? { takeProfit: String(order.takeProfit) } : {}),
              requestId: `copilot-sl-${Date.now().toString(36)}`,
            },
            requestContext,
          );
        }

        await this.prisma.liveOrder.update({
          where: { id: order.id },
          data: { stopLoss: decision.proposedStopLoss },
        });

        actionExecuted = true;
      } else if (decision.action === "DE_RISK_REDUCE") {
        const reduceQty = Number(position.quantity) * (decision.closeRatio ?? 0.5);
        if (reduceQty > 0) {
          await this.connections.placeOrder(
            userId,
            connectionId,
            {
              symbol: position.symbol,
              side: position.side === "LONG" ? "SELL" : "BUY",
              quantity: String(reduceQty),
              leverage: position.leverage ?? 1,
              clientOrderId: `copilot-derisk-${Date.now().toString(36)}`,
              reduceOnly: true,
            },
            requestContext,
          );
          actionExecuted = true;
        }
      }
    } catch (err) {
      executionError = err instanceof Error ? err.message : String(err);
      this.logger.error({
        event: "copilot_action_execution_failed",
        action: decision.action,
        symbol: position.symbol,
        error: executionError,
      });
    }

    return {
      inspected: true,
      decision,
      actionExecuted,
      executionError,
    };
  }
}
