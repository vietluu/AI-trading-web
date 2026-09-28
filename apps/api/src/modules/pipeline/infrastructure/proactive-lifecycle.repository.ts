import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type ExecutionPlanVersion,
  type ThesisReview as PersistedThesisReview,
  type TradeThesis as PersistedTradeThesis,
} from '@prisma/client';
import type {
  AnticipatoryMarketSnapshot,
  DecisionOutput,
  ThesisReview,
  ThesisValidationResult,
  TradeThesis,
} from '@platform/shared';
import { PrismaService } from '../../../database/prisma.service';

export interface PersistProactiveThesisInput {
  userId: string;
  opportunityId: string;
  snapshotId?: string;
  thesis: TradeThesis;
  snapshot: AnticipatoryMarketSnapshot;
  configurationHash: string;
  modelProvider?: string;
  model?: string;
  promptVersion: number;
}

export interface PersistedProactiveThesis {
  thesisId: string;
  reused: boolean;
}

export interface PersistProactiveReviewInput {
  thesisId: string;
  review: ThesisReview;
  appliedThesis: TradeThesis;
  validation: ThesisValidationResult;
  sourceDataCutoff: Date;
  configurationHash: string;
  modelProvider?: string;
  model?: string;
  promptVersion: number;
  schemaVersion: number;
  calculationVersion: number;
}

export interface PersistExecutionPlanInput {
  thesisId: string;
  reviewedThesis: TradeThesis;
  validation: ThesisValidationResult;
  baseline: DecisionOutput;
  sourceDataCutoff: Date;
  configurationHash: string;
  modelProvider?: string;
  model?: string;
  promptVersion: number;
  schemaVersion: number;
  calculationVersion: number;
}

@Injectable()
export class ProactiveLifecycleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async persistThesis(input: PersistProactiveThesisInput): Promise<PersistedProactiveThesis> {
    return this.prisma.$transaction(async (tx) => {
      const data = thesisCreateData(input);
      let persisted: PersistedTradeThesis;
      let reused = false;

      try {
        persisted = await tx.tradeThesis.create({ data });
      } catch (error) {
        if (!isPrismaUniqueConflict(error)) throw error;
        const existing = await tx.tradeThesis.findUnique({
          where: {
            symbol_provider_timeframe_thesisVersion_sourceDataCutoff: {
              symbol: data.symbol,
              provider: data.provider,
              timeframe: data.timeframe,
              thesisVersion: input.thesis.thesisVersion,
              sourceDataCutoff: data.sourceDataCutoff,
            },
          },
        });
        if (!existing || !sameImmutableThesis(existing, data)) {
          throw new Error('PROACTIVE_THESIS_IDENTITY_CONFLICT');
        }
        persisted = existing;
        reused = true;
      }

      const transition = await tx.opportunityTransition.findFirst({
        where: {
          opportunityId: input.opportunityId,
          toState: 'WATCHING',
          sourceDataCutoff: data.sourceDataCutoff,
        },
        select: { id: true, thesisId: true },
      });
      if (!transition) throw new Error('PROACTIVE_WATCHING_TRANSITION_REQUIRED');

      const linked = await tx.opportunityTransition.updateMany({
        where: {
          id: transition.id,
          OR: [{ thesisId: null }, { thesisId: persisted.id }],
        },
        data: { thesisId: persisted.id },
      });
      if (linked.count !== 1) {
        const current = await tx.opportunityTransition.findFirst({
          where: { id: transition.id },
          select: { thesisId: true },
        });
        if (!current) throw new Error('PROACTIVE_WATCHING_TRANSITION_REQUIRED');
        if (current.thesisId !== persisted.id) {
          throw new Error('PROACTIVE_TRANSITION_THESIS_CONFLICT');
        }
      }

      return { thesisId: persisted.id, reused };
    });
  }

  async persistReview(input: PersistProactiveReviewInput): Promise<{ reviewId: string; reused: boolean }> {
    const data = reviewCreateData(input);
    const identity = {
      thesisId_configurationHash: {
        thesisId: input.thesisId,
        configurationHash: input.configurationHash,
      },
    };
    const existing = await this.prisma.thesisReview.findUnique({ where: identity });
    if (existing) return reuseReview(existing, data);

    try {
      const created = await this.prisma.thesisReview.create({ data });
      return { reviewId: created.id, reused: false };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const raced = await this.prisma.thesisReview.findUnique({ where: identity });
      if (!raced) throw error;
      return reuseReview(raced, data);
    }
  }

  async persistExecutionPlan(input: PersistExecutionPlanInput): Promise<{ planId: string; reused: boolean }> {
    if (
      !input.validation.valid ||
      !['PROBE_READY', 'CONFIRMED'].includes(input.reviewedThesis.state) ||
      !['LONG', 'SHORT'].includes(input.reviewedThesis.direction)
    ) {
      throw new Error('PROACTIVE_EXECUTION_PLAN_NOT_ELIGIBLE');
    }

    const data = planCreateData(input);
    const identity = { thesisId_version: { thesisId: input.thesisId, version: 1 } };
    const existing = await this.prisma.executionPlanVersion.findUnique({ where: identity });
    if (existing) return reusePlan(existing, data);

    try {
      const created = await this.prisma.executionPlanVersion.create({ data });
      return { planId: created.id, reused: false };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const raced = await this.prisma.executionPlanVersion.findUnique({ where: identity });
      if (!raced) throw error;
      return reusePlan(raced, data);
    }
  }
}

function reviewCreateData(input: PersistProactiveReviewInput): Prisma.ThesisReviewUncheckedCreateInput {
  return {
    thesisId: input.thesisId,
    action: input.review.action,
    sizeFactor: input.review.sizeFactor,
    reasonCodes: input.review.reasonCodes as Prisma.InputJsonValue,
    evidenceRefs: input.review.evidenceRefs as Prisma.InputJsonValue,
    rationale: input.review.rationale,
    sourceDataCutoff: input.sourceDataCutoff,
    modelProvider: input.modelProvider,
    model: input.model,
    promptVersion: input.promptVersion,
    configurationHash: input.configurationHash,
    schemaVersion: input.schemaVersion,
    calculationVersion: input.calculationVersion,
    reviewJson: {
      review: input.review,
      appliedThesis: input.appliedThesis,
      validation: input.validation,
    } as Prisma.InputJsonValue,
  };
}

function planCreateData(input: PersistExecutionPlanInput): Prisma.ExecutionPlanVersionUncheckedCreateInput {
  return {
    thesisId: input.thesisId,
    version: 1,
    status: 'DRAFT',
    planJson: {
      reviewedThesis: input.reviewedThesis,
      validation: input.validation,
      baselineIdentity: {
        decision: input.baseline.decision,
        confidence: input.baseline.confidence,
        generatedAt: input.baseline.generatedAt,
      },
    } as Prisma.InputJsonValue,
    sourceDataCutoff: input.sourceDataCutoff,
    modelProvider: input.modelProvider,
    model: input.model,
    promptVersion: input.promptVersion,
    configurationHash: input.configurationHash,
    schemaVersion: input.schemaVersion,
    calculationVersion: input.calculationVersion,
  };
}

function reuseReview(
  existing: PersistedThesisReview,
  expected: Prisma.ThesisReviewUncheckedCreateInput,
): { reviewId: string; reused: true } {
  const fields = [
    'thesisId', 'action', 'sizeFactor', 'reasonCodes', 'evidenceRefs', 'rationale',
    'sourceDataCutoff', 'modelProvider', 'model', 'promptVersion', 'configurationHash',
    'schemaVersion', 'calculationVersion', 'reviewJson',
  ] as const;
  if (canonicalize(pick(existing, fields)) !== canonicalize(pick(expected, fields))) {
    throw new Error('PROACTIVE_REVIEW_IDENTITY_CONFLICT');
  }
  return { reviewId: existing.id, reused: true };
}

function reusePlan(
  existing: ExecutionPlanVersion,
  expected: Prisma.ExecutionPlanVersionUncheckedCreateInput,
): { planId: string; reused: true } {
  const fields = [
    'thesisId', 'version', 'status', 'planJson', 'sourceDataCutoff', 'modelProvider',
    'model', 'promptVersion', 'configurationHash', 'schemaVersion', 'calculationVersion',
  ] as const;
  if (canonicalize(pick(existing, fields)) !== canonicalize(pick(expected, fields))) {
    throw new Error('PROACTIVE_EXECUTION_PLAN_IDENTITY_CONFLICT');
  }
  return { planId: existing.id, reused: true };
}

function thesisCreateData(input: PersistProactiveThesisInput): Prisma.TradeThesisUncheckedCreateInput {
  const { thesis, snapshot } = input;
  return {
    userId: input.userId,
    opportunityId: input.opportunityId,
    snapshotId: input.snapshotId,
    symbol: snapshot.symbol,
    provider: snapshot.provider,
    timeframe: snapshot.timeframe,
    thesisVersion: thesis.thesisVersion,
    decisionSource: thesis.decisionSource,
    state: thesis.state,
    direction: thesis.direction,
    regime: thesis.regime,
    setup: thesis.setup,
    transitionProbability: thesis.transitionProbability,
    entryZone: jsonOrNull(thesis.entryZone),
    trigger: thesis.trigger as Prisma.InputJsonValue,
    invalidation: jsonOrNull(thesis.invalidation),
    stopLoss: decimalOrNull(thesis.stopLoss),
    targets: thesis.targets as Prisma.InputJsonValue,
    expectedNetR: decimalOrNull(thesis.expectedNetR),
    maximumChaseDistanceAtr: decimalOrNull(thesis.maximumChaseDistanceAtr),
    confidence: thesis.confidence,
    evidenceFor: thesis.evidenceFor as Prisma.InputJsonValue,
    evidenceAgainst: thesis.evidenceAgainst as Prisma.InputJsonValue,
    missingEvidence: thesis.missingEvidence as Prisma.InputJsonValue,
    sourceDataCutoff: new Date(snapshot.sourceDataCutoff),
    schemaVersion: snapshot.schemaVersion,
    calculationVersion: snapshot.calculationVersion,
    modelProvider: input.modelProvider,
    model: input.model,
    promptVersion: input.promptVersion,
    configurationHash: input.configurationHash,
    thesisJson: thesis as Prisma.InputJsonValue,
    expiresAt: new Date(thesis.expiresAt),
  };
}

const IMMUTABLE_THESIS_FIELDS = [
  'userId', 'opportunityId', 'snapshotId', 'symbol', 'provider', 'timeframe',
  'thesisVersion', 'decisionSource', 'state', 'direction', 'regime', 'setup',
  'transitionProbability', 'entryZone', 'trigger', 'invalidation', 'stopLoss',
  'targets', 'expectedNetR', 'maximumChaseDistanceAtr', 'confidence',
  'evidenceFor', 'evidenceAgainst', 'missingEvidence', 'sourceDataCutoff',
  'schemaVersion', 'calculationVersion', 'modelProvider', 'model', 'promptVersion',
  'configurationHash', 'thesisJson', 'expiresAt',
] as const;

function sameImmutableThesis(
  existing: PersistedTradeThesis,
  expected: Prisma.TradeThesisUncheckedCreateInput,
): boolean {
  return canonicalize(pick(existing, IMMUTABLE_THESIS_FIELDS)) ===
    canonicalize(pick(expected, IMMUTABLE_THESIS_FIELDS));
}

function pick(source: object, keys: readonly string[]): Record<string, unknown> {
  const record = source as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, record[key] ?? null]));
}

function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Date) return item.toISOString();
    if (Prisma.Decimal.isDecimal(item)) return item.toString();
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return item;
  });
}

function jsonOrNull(value: object | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function decimalOrNull(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}

function isPrismaUniqueConflict(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
