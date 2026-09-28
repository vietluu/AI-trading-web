import { describe, expect, it } from 'vitest';
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
} = {}) {
  let storedThesis: Record<string, unknown> | undefined;
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
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.createConflict) throw Object.assign(new Error('unique'), { code: 'P2002' });
        storedThesis = { id: 'thesis-1', ...data };
        return storedThesis;
      },
      findUnique: async () => options.existingThesis ?? null,
    },
    opportunityTransition: {
      findFirst: async () => storedTransition,
      updateMany: async ({ where, data }: {
        where: { id: string; OR: Array<{ thesisId: string | null }> };
        data: { thesisId: string };
      }) => {
        if (!storedTransition || storedTransition.id !== where.id) return { count: 0 };
        const linkAllowed = where.OR.some((condition) => condition.thesisId === storedTransition.thesisId);
        if (!linkAllowed) return { count: 0 };
        storedTransition.thesisId = data.thesisId;
        return { count: 1 };
      },
    },
  };
  const prisma = { $transaction: (operation: (client: typeof tx) => unknown) => operation(tx) };

  return {
    repository: new ProactiveLifecycleRepository(prisma as never),
    getStoredThesis: () => storedThesis,
    storedTransition,
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
