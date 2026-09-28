import { describe, expect, it } from 'vitest';
import type { DecisionOutput, ThesisReview, ThesisValidationResult, TradeThesis } from '@platform/shared';
import { createBaseSnapshot, createValidLongThesis } from '../helpers/thesis-fixture';
import { ProactiveLifecycleRepository } from '../../src/modules/pipeline/infrastructure/proactive-lifecycle.repository';

const cutoff = new Date('2026-09-09T12:00:00.000Z');

function createInput() {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    opportunityId: '00000000-0000-4000-8000-000000000002',
    snapshotId: '00000000-0000-4000-8000-000000000003',
    thesis: createValidLongThesis(),
    snapshot: createBaseSnapshot(),
    configurationHash: 'config-v1',
    modelProvider: 'OPENAI',
    model: 'gpt-test',
    promptVersion: 3,
  };
}

function createHarness(options: {
  existingThesis?: Record<string, unknown>;
  transition?: Record<string, unknown> | null;
  createConflict?: boolean;
  existingReview?: Record<string, unknown>;
  reviewCreateConflict?: boolean;
  existingPlan?: Record<string, unknown>;
  planCreateConflict?: boolean;
} = {}) {
  let storedThesis: Record<string, unknown> | undefined;
  let storedReview: Record<string, unknown> | undefined;
  let storedPlan: Record<string, unknown> | undefined;
  const storedTransition: Record<string, unknown> | null = options.transition === undefined
    ? {
        id: 'transition-1',
        opportunityId: createInput().opportunityId,
        toState: 'WATCHING',
        sourceDataCutoff: cutoff,
        thesisId: null,
      }
    : options.transition;

  const tx = {
    tradeThesis: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        if (options.createConflict) return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
        storedThesis = { id: 'thesis-1', ...data };
        return Promise.resolve(storedThesis);
      },
      findUnique: () => Promise.resolve(options.existingThesis ?? null),
    },
    opportunityTransition: {
      findFirst: () => Promise.resolve(storedTransition),
      updateMany: ({ where, data }: {
        where: { id: string; OR: Array<{ thesisId: string | null }> };
        data: { thesisId: string };
      }) => {
        if (!storedTransition || storedTransition.id !== where.id) return Promise.resolve({ count: 0 });
        const linkAllowed = where.OR.some((condition) => condition.thesisId === storedTransition.thesisId);
        if (!linkAllowed) return Promise.resolve({ count: 0 });
        storedTransition.thesisId = data.thesisId;
        return Promise.resolve({ count: 1 });
      },
    },
    thesisReview: {
      findUnique: () => Promise.resolve(options.existingReview ?? storedReview ?? null),
      create: ({ data }: { data: Record<string, unknown> }) => {
        if (options.reviewCreateConflict) return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
        storedReview = { id: 'review-1', ...data };
        return Promise.resolve(storedReview);
      },
    },
    executionPlanVersion: {
      findUnique: () => Promise.resolve(options.existingPlan ?? storedPlan ?? null),
      create: ({ data }: { data: Record<string, unknown> }) => {
        if (options.planCreateConflict) return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
        storedPlan = { id: 'plan-1', ...data };
        return Promise.resolve(storedPlan);
      },
    },
  };
  const prisma = {
    $transaction: (operation: (client: typeof tx) => unknown) => operation(tx),
    thesisReview: tx.thesisReview,
    executionPlanVersion: tx.executionPlanVersion,
  };

  return {
    repository: new ProactiveLifecycleRepository(prisma as never),
    getStoredThesis: () => storedThesis,
    getStoredReview: () => storedReview,
    getStoredPlan: () => storedPlan,
    storedTransition,
  };
}

const review: ThesisReview = {
  action: 'APPROVE',
  reasonCodes: [],
  evidenceRefs: [],
  rationale: 'Risk geometry and evidence are acceptable',
};
const validation: ThesisValidationResult = {
  valid: true,
  status: 'VALID',
  reasonCodes: [],
  reasons: [],
};

function createReviewInput() {
  return {
    thesisId: 'thesis-1',
    review,
    appliedThesis: createValidLongThesis(),
    validation,
    sourceDataCutoff: cutoff,
    configurationHash: 'config-v1',
    modelProvider: 'OPENAI',
    model: 'gpt-test',
    promptVersion: 4,
    schemaVersion: 1,
    calculationVersion: 1,
  };
}

function createPlanInput(thesis: TradeThesis = createValidLongThesis()) {
  return {
    thesisId: 'thesis-1',
    reviewedThesis: thesis,
    validation,
    baseline: {
      decision: 'BUY',
      confidence: 82,
      generatedAt: '2026-09-09T12:00:00.000Z',
    } as unknown as DecisionOutput,
    sourceDataCutoff: cutoff,
    configurationHash: 'config-v1',
    modelProvider: 'OPENAI',
    model: 'gpt-test',
    promptVersion: 4,
    schemaVersion: 1,
    calculationVersion: 1,
  };
}

describe('ProactiveLifecycleRepository.persistThesis', () => {
  it('persists a WAIT thesis with complete provenance and links its WATCHING transition', async () => {
    const input = createInput();
    input.thesis = {
      ...input.thesis,
      state: 'WAIT',
      direction: 'WAIT',
      entryZone: null,
      trigger: [],
      invalidation: null,
      stopLoss: null,
      targets: [],
      expectedNetR: null,
    };
    const harness = createHarness();

    await expect(harness.repository.persistThesis(input)).resolves.toEqual({
      thesisId: 'thesis-1',
      reused: false,
    });
    expect(harness.getStoredThesis()).toMatchObject({
      opportunityId: input.opportunityId,
      snapshotId: input.snapshotId,
      direction: 'WAIT',
      state: 'WAIT',
      sourceDataCutoff: cutoff,
      configurationHash: 'config-v1',
      modelProvider: 'OPENAI',
      model: 'gpt-test',
      promptVersion: 3,
      thesisJson: input.thesis,
    });
    expect(harness.storedTransition?.thesisId).toBe('thesis-1');
  });

  it('reuses an identical thesis after a unique conflict', async () => {
    const input = createInput();
    const initial = createHarness();
    await initial.repository.persistThesis(input);
    const existing = initial.getStoredThesis();
    const retry = createHarness({ existingThesis: existing, createConflict: true });

    await expect(retry.repository.persistThesis(input)).resolves.toEqual({
      thesisId: 'thesis-1',
      reused: true,
    });
  });

  it('rejects a duplicate identity whose immutable payload differs', async () => {
    const input = createInput();
    const initial = createHarness();
    await initial.repository.persistThesis(input);
    const existing = { ...initial.getStoredThesis(), confidence: 1 };
    const retry = createHarness({ existingThesis: existing, createConflict: true });

    await expect(retry.repository.persistThesis(input)).rejects.toThrow(
      'PROACTIVE_THESIS_IDENTITY_CONFLICT',
    );
  });

  it('fails closed when no matching WATCHING transition can be linked', async () => {
    const harness = createHarness({ transition: null });

    await expect(harness.repository.persistThesis(createInput())).rejects.toThrow(
      'PROACTIVE_WATCHING_TRANSITION_REQUIRED',
    );
  });

  it('never overwrites a transition linked to a different thesis', async () => {
    const harness = createHarness({
      transition: {
        id: 'transition-1',
        opportunityId: createInput().opportunityId,
        toState: 'WATCHING',
        sourceDataCutoff: cutoff,
        thesisId: 'thesis-other',
      },
    });

    await expect(harness.repository.persistThesis(createInput())).rejects.toThrow(
      'PROACTIVE_TRANSITION_THESIS_CONFLICT',
    );
    expect(harness.storedTransition?.thesisId).toBe('thesis-other');
  });
});

describe('ProactiveLifecycleRepository review and plan persistence', () => {
  it('persists a critic review linked to the relational thesis ID', async () => {
    const harness = createHarness();

    await expect(harness.repository.persistReview(createReviewInput())).resolves.toEqual({
      reviewId: 'review-1',
      reused: false,
    });
    expect(harness.getStoredReview()).toMatchObject({
      thesisId: 'thesis-1',
      action: 'APPROVE',
      configurationHash: 'config-v1',
      reviewJson: { review, appliedThesis: createValidLongThesis(), validation },
    });
  });

  it('reuses only an identical review for the thesis and configuration', async () => {
    const input = createReviewInput();
    const initial = createHarness();
    await initial.repository.persistReview(input);
    const existing = initial.getStoredReview();
    const retry = createHarness({ existingReview: existing });
    await expect(retry.repository.persistReview(input)).resolves.toEqual({ reviewId: 'review-1', reused: true });

    const conflict = createHarness({ existingReview: { ...existing, rationale: 'different' } });
    await expect(conflict.repository.persistReview(input)).rejects.toThrow(
      'PROACTIVE_REVIEW_IDENTITY_CONFLICT',
    );
  });

  it('creates one DRAFT plan containing the reviewed thesis and baseline identity', async () => {
    const harness = createHarness();

    await expect(harness.repository.persistExecutionPlan(createPlanInput())).resolves.toEqual({
      planId: 'plan-1',
      reused: false,
    });
    expect(harness.getStoredPlan()).toMatchObject({
      thesisId: 'thesis-1',
      version: 1,
      status: 'DRAFT',
      planJson: {
        reviewedThesis: createValidLongThesis(),
        validation,
        baselineIdentity: {
          decision: 'BUY',
          confidence: 82,
          generatedAt: '2026-09-09T12:00:00.000Z',
        },
      },
    });
  });

  it.each(['WAIT', 'WATCHING', 'TOO_LATE'] as const)(
    'rejects a non-executable %s thesis before plan persistence',
    async (state) => {
      const thesis: TradeThesis = {
        ...createValidLongThesis(),
        state,
        ...(state === 'WAIT' ? { direction: 'WAIT' as const } : {}),
      };
      const harness = createHarness();

      await expect(harness.repository.persistExecutionPlan(createPlanInput(thesis))).rejects.toThrow(
        'PROACTIVE_EXECUTION_PLAN_NOT_ELIGIBLE',
      );
      expect(harness.getStoredPlan()).toBeUndefined();
    },
  );
});
