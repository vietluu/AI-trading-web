import { Injectable } from '@nestjs/common';
import type { AnticipatoryMarketSnapshot } from '@platform/shared';
import type { Opportunity, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../../database/prisma.service';
import type {
  ExchangeInterval,
  ExchangeProvider,
} from '../../../exchange/domain/exchange.types';
import { AnticipatorySnapshotService } from '../../agents/application/services/anticipatory-snapshot.service';
import {
  OPPORTUNITY_WATCHER_POLICY,
  transitionOpportunity,
  type OpportunityDirection,
  type OpportunityObservationState,
  type OpportunitySetup,
  type OpportunityTransitionReasonCode,
} from '../domain/opportunity-state-machine';

const TERMINAL_STATES = ['INVALIDATED', 'EXPIRED', 'TOO_LATE'] as const;

export interface ObserveOpportunityInput {
  userId: string;
  provider: ExchangeProvider;
  symbol: string;
  timeframe: ExchangeInterval;
  sourceDataCutoff: Date;
  now?: Date;
}

export type ObserveOpportunityResult =
  | {
      snapshotId: string;
      opportunityId: null;
      state: null;
      duplicate: false;
      reasonCode: 'NO_SETUP';
    }
  | {
      snapshotId: string;
      opportunityId: string;
      state: OpportunityObservationState['state'];
      duplicate: boolean;
      reasonCode: OpportunityTransitionReasonCode;
    };

function key(parts: Array<string | number>): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function inferSetup(
  snapshot: AnticipatoryMarketSnapshot,
): OpportunitySetup | undefined {
  if (
    snapshot.structure.coverage === 'AVAILABLE' &&
    snapshot.structure.liquiditySweep.coverage === 'AVAILABLE' &&
    snapshot.structure.liquiditySweep.detected
  ) return 'LIQUIDITY_SWEEP_REVERSAL';

  if (
    snapshot.volatility.coverage === 'AVAILABLE' &&
    snapshot.volatility.squeezeState === 'SQUEEZING'
  ) return 'SQUEEZE_PROBE';

  if (
    snapshot.structure.coverage === 'AVAILABLE' &&
    snapshot.structure.distanceToNearestBoundaryAtr <=
      OPPORTUNITY_WATCHER_POLICY.maximumWatchDistanceAtr
  ) return 'RANGE_REVERSAL';

  return undefined;
}

function inferDirection(
  snapshot: AnticipatoryMarketSnapshot,
): OpportunityDirection {
  if (
    snapshot.structure.coverage === 'AVAILABLE' &&
    snapshot.structure.liquiditySweep.coverage === 'AVAILABLE' &&
    snapshot.structure.liquiditySweep.detected
  ) {
    return snapshot.structure.liquiditySweep.direction === 'BULLISH_SWEEP'
      ? 'LONG'
      : 'SHORT';
  }

  if (
    snapshot.derivatives.coverage === 'AVAILABLE' &&
    snapshot.derivatives.derivativesImbalance.coverage === 'AVAILABLE'
  ) {
    if (
      snapshot.derivatives.derivativesImbalance.squeezeDirection ===
      'SHORT_SQUEEZE'
    ) return 'LONG';
    if (
      snapshot.derivatives.derivativesImbalance.squeezeDirection ===
      'LONG_SQUEEZE'
    ) return 'SHORT';
  }

  if (snapshot.momentum.coverage === 'AVAILABLE') {
    if (snapshot.momentum.macd.histogram > 0) return 'LONG';
    if (snapshot.momentum.macd.histogram < 0) return 'SHORT';
  }
  return 'WAIT';
}

function invalidationPrice(
  snapshot: AnticipatoryMarketSnapshot,
  direction: OpportunityDirection,
): number | null {
  if (
    direction === 'WAIT' ||
    snapshot.structure.coverage !== 'AVAILABLE'
  ) return null;

  const candidates = snapshot.structure.invalidationCandidates
    .filter((candidate) => candidate.direction === direction)
    .map((candidate) => candidate.price);
  if (candidates.length === 0) return null;

  const execution = snapshot.execution;
  if (execution.coverage !== 'AVAILABLE') return candidates[0]!;
  return candidates.sort(
    (left, right) =>
      Math.abs(left - execution.currentPrice) -
      Math.abs(right - execution.currentPrice),
  )[0]!;
}

function observationState(opportunity: Opportunity): OpportunityObservationState {
  return {
    state: opportunity.state,
    setup: opportunity.setup as OpportunitySetup,
    direction: opportunity.direction as OpportunityDirection,
    invalidationPrice:
      opportunity.invalidationPrice === null
        ? null
        : Number(opportunity.invalidationPrice),
    expiresAt: opportunity.expiresAt,
    lastObservedCutoff: opportunity.lastObservedCutoff,
  };
}

@Injectable()
export class OpportunityWatcherService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotService: AnticipatorySnapshotService,
  ) {}

  public async observe(
    input: ObserveOpportunityInput,
  ): Promise<ObserveOpportunityResult> {
    const expectedCutoff = new Date(input.sourceDataCutoff);
    if (!Number.isFinite(expectedCutoff.getTime())) {
      throw new Error('sourceDataCutoff must be a valid timestamp');
    }
    const snapshot = await this.snapshotService.build({
      userId: input.userId,
      provider: input.provider,
      symbol: input.symbol,
      timeframe: input.timeframe,
      sourceDataCutoff: expectedCutoff,
    });
    const actualCutoff = new Date(snapshot.sourceDataCutoff);
    if (actualCutoff.getTime() !== expectedCutoff.getTime()) {
      throw new Error('snapshot cutoff must match the observed closed candle');
    }
    const snapshotRow = await this.prisma.anticipatoryMarketSnapshot.findUniqueOrThrow({
      where: {
        provider_symbol_timeframe_sourceDataCutoff: {
          provider: input.provider,
          symbol: input.symbol,
          timeframe: input.timeframe,
          sourceDataCutoff: actualCutoff,
        },
      },
      select: { id: true },
    });
    const setup = inferSetup(snapshot);
    if (setup === undefined) {
      return {
        snapshotId: snapshotRow.id,
        opportunityId: null,
        state: null,
        duplicate: false,
        reasonCode: 'NO_SETUP',
      };
    }

    return this.prisma.$transaction(async (transaction) => {
      const opportunity = await this.findOrCreateOpportunity(
        transaction,
        input,
        snapshot,
        setup,
        actualCutoff,
      );
      const transition = transitionOpportunity(
        observationState(opportunity),
        snapshot,
        input.now ?? new Date(),
      );
      if (transition.reasonCode === 'DUPLICATE_CANDLE_CUTOFF') {
        return {
          snapshotId: snapshotRow.id,
          opportunityId: opportunity.id,
          state: opportunity.state,
          duplicate: true,
          reasonCode: transition.reasonCode,
        };
      }

      if (transition.changed) {
        const transitionKey = key([
          opportunity.id,
          opportunity.setup,
          transition.fromState,
          transition.toState,
          transition.sourceDataCutoff.toISOString(),
        ]);
        await transaction.opportunityTransition.upsert({
          where: { idempotencyKey: transitionKey },
          update: {},
          create: {
            opportunityId: opportunity.id,
            snapshotId: snapshotRow.id,
            fromState: transition.fromState,
            toState: transition.toState,
            reasonCode: transition.reasonCode,
            sourceDataCutoff: transition.sourceDataCutoff,
            idempotencyKey: transitionKey,
          },
        });
      }
      const updated = await transaction.opportunity.update({
        where: { id: opportunity.id },
        data: {
          state: transition.toState,
          lastObservedCutoff: transition.sourceDataCutoff,
        },
      });
      return {
        snapshotId: snapshotRow.id,
        opportunityId: updated.id,
        state: updated.state,
        duplicate: false,
        reasonCode: transition.reasonCode,
      };
    });
  }

  private async findOrCreateOpportunity(
    transaction: Prisma.TransactionClient,
    input: ObserveOpportunityInput,
    snapshot: AnticipatoryMarketSnapshot,
    setup: OpportunitySetup,
    cutoff: Date,
  ): Promise<Opportunity> {
    const latest = await transaction.opportunity.findFirst({
      where: {
        userId: input.userId,
        provider: input.provider,
        symbol: input.symbol,
        timeframe: input.timeframe,
        setup,
      },
      orderBy: { thesisVersion: 'desc' },
    });
    if (
      latest !== null &&
      !TERMINAL_STATES.includes(latest.state as (typeof TERMINAL_STATES)[number])
    ) return latest;

    const thesisVersion = (latest?.thesisVersion ?? 0) + 1;
    const direction = inferDirection(snapshot);
    const opportunityKey = key([
      input.userId,
      input.provider,
      input.symbol,
      input.timeframe,
      setup,
      thesisVersion,
      cutoff.toISOString(),
    ]);
    return transaction.opportunity.upsert({
      where: { idempotencyKey: opportunityKey },
      update: {},
      create: {
        userId: input.userId,
        provider: input.provider,
        symbol: input.symbol,
        timeframe: input.timeframe,
        setup,
        direction,
        thesisVersion,
        idempotencyKey: opportunityKey,
        state: 'OBSERVING',
        invalidationPrice: invalidationPrice(snapshot, direction),
        expiresAt: new Date(
          cutoff.getTime() + OPPORTUNITY_WATCHER_POLICY.opportunityTtlMs,
        ),
      },
    });
  }
}
