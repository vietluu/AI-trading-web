import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export type TradeLifecycleEventType =
  | 'PROBE'
  | 'ADD'
  | 'PARTIAL'
  | 'STOP_TIGHTEN'
  | 'FINAL_CLOSE'
  | 'FUNDING'
  | 'FEE';

export interface TradeLifecycleEvent {
  thesisId: string;
  orderId?: string;
  symbol?: string;
  provider?: string;
  timeframe?: string;
  direction?: 'LONG' | 'SHORT';
  type: TradeLifecycleEventType;
  price?: number;
  quantity?: number;
  signedFee?: number;
  fee?: number;
  signedFunding?: number;
  funding?: number;
  stopLoss?: number;
  realizedPnl?: number;
  grossPnl?: number;
  initialRisk?: number;
  timestamp: Date;
  sourceDataCutoff?: Date;
  configurationHash?: string;
  metadata?: Record<string, unknown>;
}

export type TradeLifecycleStatus = 'OPEN' | 'FINALIZED' | 'CANCELLED';

export interface TradeLifecycleOutcome {
  id?: string;
  thesisId: string;
  symbol: string;
  provider: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  setup?: string;
  regime?: string;
  status: TradeLifecycleStatus;
  sourceDataCutoff: Date;
  openedAt: Date;
  closedAt: Date | null;
  totalEnteredQuantity: number;
  totalExitedQuantity: number;
  averageEntryPrice: number;
  averageExitPrice: number | null;
  realizedGrossPnl: number;
  signedFees: number;
  signedFunding: number;
  realizedNetPnl: number;
  initialRisk: number | null;
  netR: number | null;
  mfe?: number | null;
  mae?: number | null;
  finalStopLoss?: number | null;
  exitReason?: string;
  schemaVersion: number;
  calculationVersion: number;
  configurationHash: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export class TradeLifecycleFinalizedError extends Error {
  constructor(
    message = 'FINALIZED_LIFECYCLE_OUTCOME_IMMUTABLE: Cannot mutate finalized trade lifecycle outcome',
  ) {
    super(message);
    this.name = 'TradeLifecycleFinalizedError';
  }
}

function roundDecimals(val: number, decimals = 8): number {
  return Number(Math.round(Number(`${val}e${decimals}`)) + `e-${decimals}`);
}

/**
 * Aggregates all execution and cashflow events for a single TradeThesis into
 * an immutable TradeLifecycleOutcome record.
 */
export function aggregateLifecycle(
  events: TradeLifecycleEvent[] | { thesisId?: string; events: TradeLifecycleEvent[] },
): TradeLifecycleOutcome {
  const eventList = Array.isArray(events) ? events : events.events;
  if (!eventList || eventList.length === 0) {
    throw new Error('TRADE_LIFECYCLE_EMPTY_EVENTS: No events provided for lifecycle aggregation');
  }

  const sortedEvents = [...eventList].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const firstEvent = sortedEvents[0];
  if (!firstEvent) {
    throw new Error('TRADE_LIFECYCLE_EMPTY_EVENTS: No events provided for lifecycle aggregation');
  }
  const thesisId = firstEvent.thesisId;
  const symbol = sortedEvents.find((e) => e.symbol)?.symbol ?? 'UNKNOWN';
  const provider = sortedEvents.find((e) => e.provider)?.provider ?? 'UNKNOWN';
  const timeframe = sortedEvents.find((e) => e.timeframe)?.timeframe ?? '15m';
  const direction = sortedEvents.find((e) => e.direction)?.direction ?? 'LONG';
  const configurationHash =
    sortedEvents.find((e) => e.configurationHash)?.configurationHash ?? '00000000';
  const sourceDataCutoff =
    sortedEvents.find((e) => e.sourceDataCutoff)?.sourceDataCutoff ?? firstEvent.timestamp;

  let totalEnteredQuantity = 0;
  let totalExitedQuantity = 0;
  let currentPositionQty = 0;
  let entryNotional = 0;
  let exitNotional = 0;
  let averageEntryPrice = 0;
  let realizedGrossPnl = 0;
  let signedFees = 0;
  let signedFunding = 0;
  let initialStopLoss: number | null = null;
  let finalStopLoss: number | null = null;
  let initialRisk: number | null = null;
  let status: TradeLifecycleStatus = 'OPEN';
  let openedAt: Date = new Date(firstEvent.timestamp);
  let closedAt: Date | null = null;
  let exitReason: string | undefined;

  for (const event of sortedEvents) {
    const eventTime = new Date(event.timestamp);

    // Accumulate signed fees
    if (event.signedFee !== undefined) {
      signedFees += event.signedFee;
    } else if (event.fee !== undefined) {
      signedFees -= Math.abs(event.fee);
    }

    // Accumulate signed funding
    if (event.signedFunding !== undefined) {
      signedFunding += event.signedFunding;
    } else if (event.funding !== undefined) {
      signedFunding += event.funding;
    }

    // Stop loss updates
    if (event.stopLoss !== undefined) {
      finalStopLoss = event.stopLoss;
      if (initialStopLoss === null) {
        initialStopLoss = event.stopLoss;
      }
    }

    if (event.initialRisk !== undefined && initialRisk === null) {
      initialRisk = event.initialRisk;
    }

    // Execution entry handling (Probe, Add)
    if (event.type === 'PROBE' || event.type === 'ADD') {
      const qty = event.quantity ?? 0;
      const price = event.price ?? 0;

      if (event.type === 'PROBE') {
        openedAt = eventTime;
        if (event.stopLoss !== undefined && initialRisk === null) {
          initialRisk = Math.abs(price - event.stopLoss) * qty;
        }
      }

      entryNotional += qty * price;
      totalEnteredQuantity += qty;
      currentPositionQty += qty;
      if (totalEnteredQuantity > 0) {
        averageEntryPrice = entryNotional / totalEnteredQuantity;
      }
    }

    // Stop tightening
    if (event.type === 'STOP_TIGHTEN') {
      if (event.stopLoss !== undefined) {
        finalStopLoss = event.stopLoss;
      }
    }

    // Execution exit handling (Partial, Final Close)
    if (event.type === 'PARTIAL' || event.type === 'FINAL_CLOSE') {
      const qty = event.quantity ?? 0;
      const price = event.price ?? 0;

      exitNotional += qty * price;
      totalExitedQuantity += qty;
      currentPositionQty = Math.max(0, currentPositionQty - qty);

      let pnl = 0;
      if (event.realizedPnl !== undefined) {
        pnl = event.realizedPnl;
      } else if (event.grossPnl !== undefined) {
        pnl = event.grossPnl;
      } else if (direction === 'SHORT') {
        pnl = (averageEntryPrice - price) * qty;
      } else {
        pnl = (price - averageEntryPrice) * qty;
      }

      realizedGrossPnl += pnl;

      if (event.type === 'FINAL_CLOSE' || currentPositionQty <= 1e-8) {
        status = 'FINALIZED';
        closedAt = eventTime;
        exitReason = event.type === 'FINAL_CLOSE' ? 'FINAL_CLOSE' : 'FULL_EXIT';
      }
    }
  }

  if (initialRisk === null && initialStopLoss !== null && averageEntryPrice > 0 && totalEnteredQuantity > 0) {
    initialRisk = Math.abs(averageEntryPrice - initialStopLoss) * totalEnteredQuantity;
  }

  const averageExitPrice =
    totalExitedQuantity > 0 ? roundDecimals(exitNotional / totalExitedQuantity) : null;

  const roundedGrossPnl = roundDecimals(realizedGrossPnl);
  const roundedSignedFees = roundDecimals(signedFees);
  const roundedSignedFunding = roundDecimals(signedFunding);
  const realizedNetPnl = roundDecimals(roundedGrossPnl + roundedSignedFees + roundedSignedFunding);

  let netR: number | null = null;
  if (initialRisk !== null && initialRisk > 0) {
    netR = roundDecimals(realizedNetPnl / initialRisk);
  }

  return {
    thesisId,
    symbol,
    provider,
    timeframe,
    direction,
    status,
    sourceDataCutoff: new Date(sourceDataCutoff),
    openedAt,
    closedAt,
    totalEnteredQuantity: roundDecimals(totalEnteredQuantity),
    totalExitedQuantity: roundDecimals(totalExitedQuantity),
    averageEntryPrice: roundDecimals(averageEntryPrice),
    averageExitPrice,
    realizedGrossPnl: roundedGrossPnl,
    signedFees: roundedSignedFees,
    signedFunding: roundedSignedFunding,
    realizedNetPnl,
    initialRisk: initialRisk !== null ? roundDecimals(initialRisk) : null,
    netR,
    finalStopLoss: finalStopLoss !== null ? roundDecimals(finalStopLoss) : null,
    exitReason,
    schemaVersion: 1,
    calculationVersion: 1,
    configurationHash,
  };
}

/**
 * Aggregates a heterogeneous list of events partitioned by thesisId,
 * producing one TradeLifecycleOutcome per thesis.
 */
export function aggregateLifecyclesByThesis(
  events: TradeLifecycleEvent[],
): TradeLifecycleOutcome[] {
  const groups = new Map<string, TradeLifecycleEvent[]>();
  for (const event of events) {
    const list = groups.get(event.thesisId);
    if (!list) {
      groups.set(event.thesisId, [event]);
    } else {
      list.push(event);
    }
  }

  const outcomes: TradeLifecycleOutcome[] = [];
  for (const thesisEvents of groups.values()) {
    outcomes.push(aggregateLifecycle(thesisEvents));
  }
  return outcomes;
}

function toOutcomeDomain(row: {
  id: string;
  thesisId: string;
  symbol: string;
  provider: string;
  timeframe: string;
  direction: string;
  setup: string | null;
  regime: string | null;
  status: string;
  sourceDataCutoff: Date;
  openedAt: Date;
  closedAt: Date | null;
  totalEnteredQuantity: Prisma.Decimal | number;
  totalExitedQuantity: Prisma.Decimal | number;
  averageEntryPrice: Prisma.Decimal | number;
  averageExitPrice: Prisma.Decimal | number | null;
  realizedGrossPnl: Prisma.Decimal | number;
  signedFees: Prisma.Decimal | number;
  signedFunding: Prisma.Decimal | number;
  realizedNetPnl: Prisma.Decimal | number;
  initialRisk: Prisma.Decimal | number | null;
  netR: Prisma.Decimal | number | null;
  mfe: Prisma.Decimal | number | null;
  mae: Prisma.Decimal | number | null;
  finalStopLoss: Prisma.Decimal | number | null;
  exitReason: string | null;
  schemaVersion: number;
  calculationVersion: number;
  configurationHash: string;
  metadata?: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): TradeLifecycleOutcome {
  return {
    id: row.id,
    thesisId: row.thesisId,
    symbol: row.symbol,
    provider: row.provider,
    timeframe: row.timeframe,
    direction: row.direction as 'LONG' | 'SHORT',
    setup: row.setup ?? undefined,
    regime: row.regime ?? undefined,
    status: row.status as TradeLifecycleStatus,
    sourceDataCutoff: row.sourceDataCutoff,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    totalEnteredQuantity: Number(row.totalEnteredQuantity),
    totalExitedQuantity: Number(row.totalExitedQuantity),
    averageEntryPrice: Number(row.averageEntryPrice),
    averageExitPrice: row.averageExitPrice != null ? Number(row.averageExitPrice) : null,
    realizedGrossPnl: Number(row.realizedGrossPnl),
    signedFees: Number(row.signedFees),
    signedFunding: Number(row.signedFunding),
    realizedNetPnl: Number(row.realizedNetPnl),
    initialRisk: row.initialRisk != null ? Number(row.initialRisk) : null,
    netR: row.netR != null ? Number(row.netR) : null,
    mfe: row.mfe != null ? Number(row.mfe) : null,
    mae: row.mae != null ? Number(row.mae) : null,
    finalStopLoss: row.finalStopLoss != null ? Number(row.finalStopLoss) : null,
    exitReason: row.exitReason ?? undefined,
    schemaVersion: row.schemaVersion,
    calculationVersion: row.calculationVersion,
    configurationHash: row.configurationHash,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Append-only / immutable repository for trade lifecycle records.
 * Enforces that once an outcome is marked FINALIZED, no further mutations are allowed.
 */
@Injectable()
export class TradeLifecycleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recordOutcome(outcome: TradeLifecycleOutcome): Promise<TradeLifecycleOutcome> {
    const existing = await this.prisma.tradeLifecycleOutcome.findUnique({
      where: { thesisId: outcome.thesisId },
    });

    if (existing && existing.status === 'FINALIZED') {
      throw new TradeLifecycleFinalizedError(
        `FINALIZED_LIFECYCLE_OUTCOME_IMMUTABLE: Cannot mutate finalized trade lifecycle outcome for thesis ${outcome.thesisId}`,
      );
    }

    if (existing) {
      const updated = await this.prisma.tradeLifecycleOutcome.update({
        where: { thesisId: outcome.thesisId },
        data: {
          status: outcome.status,
          closedAt: outcome.closedAt,
          totalEnteredQuantity: outcome.totalEnteredQuantity,
          totalExitedQuantity: outcome.totalExitedQuantity,
          averageEntryPrice: outcome.averageEntryPrice,
          averageExitPrice: outcome.averageExitPrice,
          realizedGrossPnl: outcome.realizedGrossPnl,
          signedFees: outcome.signedFees,
          signedFunding: outcome.signedFunding,
          realizedNetPnl: outcome.realizedNetPnl,
          initialRisk: outcome.initialRisk,
          netR: outcome.netR,
          mfe: outcome.mfe,
          mae: outcome.mae,
          finalStopLoss: outcome.finalStopLoss,
          exitReason: outcome.exitReason,
          schemaVersion: outcome.schemaVersion,
          calculationVersion: outcome.calculationVersion,
          configurationHash: outcome.configurationHash,
          metadata: outcome.metadata as Prisma.InputJsonValue,
        },
      });
      return toOutcomeDomain(updated);
    }

    const created = await this.prisma.tradeLifecycleOutcome.create({
      data: {
        thesisId: outcome.thesisId,
        symbol: outcome.symbol,
        provider: outcome.provider,
        timeframe: outcome.timeframe,
        direction: outcome.direction,
        setup: outcome.setup,
        regime: outcome.regime,
        status: outcome.status,
        sourceDataCutoff: outcome.sourceDataCutoff,
        openedAt: outcome.openedAt,
        closedAt: outcome.closedAt,
        totalEnteredQuantity: outcome.totalEnteredQuantity,
        totalExitedQuantity: outcome.totalExitedQuantity,
        averageEntryPrice: outcome.averageEntryPrice,
        averageExitPrice: outcome.averageExitPrice,
        realizedGrossPnl: outcome.realizedGrossPnl,
        signedFees: outcome.signedFees,
        signedFunding: outcome.signedFunding,
        realizedNetPnl: outcome.realizedNetPnl,
        initialRisk: outcome.initialRisk,
        netR: outcome.netR,
        mfe: outcome.mfe,
        mae: outcome.mae,
        finalStopLoss: outcome.finalStopLoss,
        exitReason: outcome.exitReason,
        schemaVersion: outcome.schemaVersion,
        calculationVersion: outcome.calculationVersion,
        configurationHash: outcome.configurationHash,
        metadata: outcome.metadata as Prisma.InputJsonValue,
      },
    });
    return toOutcomeDomain(created);
  }

  async getOutcome(thesisId: string): Promise<TradeLifecycleOutcome | null> {
    const row = await this.prisma.tradeLifecycleOutcome.findUnique({
      where: { thesisId },
    });
    return row ? toOutcomeDomain(row) : null;
  }
}
