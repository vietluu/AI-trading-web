import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineService } from '../../src/modules/pipeline/application/pipeline.service';
import { PipelineRunnerService } from '../../src/modules/pipeline/application/pipeline-runner.service';
import { PipelineRepository } from '../../src/modules/pipeline/infrastructure/pipeline.repository';
import { PipelineQueueService, type PipelineJob } from '../../src/modules/pipeline/infrastructure/pipeline-queue.service';

type Row = Record<string, unknown>;
type PipelineRunRow = Row & {
  id: string;
  status: string;
  proactiveDeliveryToken: string | null;
  proactiveExecutionClaimedAt: Date | null;
  proactiveDeliveryState: string | null;
  proactiveDeliveryLeaseExpiresAt: Date | null;
  proactiveThesisKey?: string;
};
type PipelineRunCreateArgs = { data: Omit<PipelineRunRow, 'status' | 'proactiveDeliveryToken' | 'proactiveExecutionClaimedAt' | 'proactiveDeliveryState' | 'proactiveDeliveryLeaseExpiresAt'> & Partial<PipelineRunRow> };
type PipelineRunWhereArgs = { where: Row };
type PipelineRunUpdateManyArgs = { where: Row; data: Partial<PipelineRunRow> };
type PipelineRunUpdateArgs = { where: { id: string }; data: Partial<PipelineRunRow> };
type PipelineStepCreateManyArgs = { data: Array<{ runId: string; stepId: string }> };

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value) || !value.every(isRow)) {
    throw new Error('Expected row array');
  }
  return value;
}

function comparable(value: unknown): number | string | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

// Only the database/Redis boundaries are replaced. Exercise the actual repository
// predicates, scheduler, queue options, and runner against shared durable state.
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return asRows(value).some((item) => matches(row, item));
    if (key === 'AND') return asRows(value).every((item) => matches(row, item));
    if (isRow(value) && !(value instanceof Date)) {
      const current = row[key];
      const lte = comparable(value.lte);
      if (lte !== undefined) {
        const actual = comparable(current);
        return actual !== undefined && actual <= lte;
      }
      const gt = comparable(value.gt);
      if (gt !== undefined) {
        const actual = comparable(current);
        return actual !== undefined && actual > gt;
      }
      if (Array.isArray(value.in)) return value.in.includes(current);
      if ('not' in value) return current !== value.not;
      throw new Error(`Unsupported test predicate: ${key}`);
    }
    return row[key] === value;
  });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const input = {
  userId: 'user-1',
  request: {
    pipelineId: 'proactive-thesis', symbol: 'BTC-USDT', provider: 'BINANCE_FUTURES',
    params: { opportunityId: 'opp-1', snapshotId: 'snapshot-1', sourceDataCutoff: '2026-09-21T00:00:00.000Z' },
  },
};

function fixture() {
  const rows = new Map<string, PipelineRunRow>();
  const steps = new Set<string>();
  const prisma = {
    pipelineRun: {
      create: vi.fn(({ data }: PipelineRunCreateArgs) => {
        if ([...rows.values()].some((row) => row.proactiveThesisKey === data.proactiveThesisKey)) {
          throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        }
        const row: PipelineRunRow = {
          status: 'QUEUED', proactiveDeliveryToken: null, proactiveExecutionClaimedAt: null,
          proactiveDeliveryState: null, proactiveDeliveryLeaseExpiresAt: null, ...data,
        };
        rows.set(row.id, row);
        return Promise.resolve({ ...row });
      }),
      findUnique: vi.fn(({ where }: PipelineRunWhereArgs) => {
        const row = [...rows.values()].find((item) => matches(item, where));
        return Promise.resolve(row ? { ...row } : null);
      }),
      updateMany: vi.fn(({ where, data }: PipelineRunUpdateManyArgs) => {
        const selected = [...rows.values()].filter((row) => matches(row, where));
        selected.forEach((row) => Object.assign(row, data));
        return Promise.resolve({ count: selected.length });
      }),
      update: vi.fn(({ where, data }: PipelineRunUpdateArgs) => {
        const row = rows.get(where.id);
        if (!row) throw new Error(`Unknown row ${where.id}`);
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      }),
      count: vi.fn(() => Promise.resolve(0)),
      findFirst: vi.fn(() => Promise.resolve(null)),
    },
    pipelineStepRun: {
      createMany: vi.fn(({ data }: PipelineStepCreateManyArgs) => {
        data.forEach((step) => steps.add(`${step.runId}:${step.stepId}`));
        return Promise.resolve({ count: data.length });
      }),
      updateMany: vi.fn(() => Promise.resolve({ count: steps.size })),
    },
    portfolioStrategy: { findMany: vi.fn(() => Promise.resolve([])) },
  };
  const repository = new PipelineRepository(prisma as never);
  const queue = { enqueue: vi.fn(() => undefined) };
  const service = () => new PipelineService(repository, queue as never, {
    enabled: true, maxRunsPerHour: 120, cooldownMs: 60_000,
  } as never);
  const cancellation = { isCancelled: vi.fn(() => false) };
  const runner = () => new PipelineRunnerService(
    {} as never, {} as never, repository, cancellation as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return { rows, steps, prisma, repository, queue, service, cancellation, runner };
}

describe('durable proactive delivery ownership', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T00:00:00.000Z')); vi.stubEnv('PROACTIVE_AI_MODE', 'OBSERVE'); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('starts the lease after slow pre-insert quota work', async () => {
    const f = fixture();
    f.prisma.pipelineRun.count.mockImplementationOnce(() => {
      vi.setSystemTime(new Date('2026-09-21T00:02:00.000Z'));
      return 0;
    });
    await f.service().scheduleProactiveThesis(input);
    const [{ data: inserted }] = f.prisma.pipelineRun.create.mock.calls[0] as [PipelineRunCreateArgs];
    expect(inserted.proactiveDeliveryLeaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('retries a rate-limited proactive request without acknowledging nonexistent delivery', async () => {
    const f = fixture();
    f.prisma.pipelineRun.count.mockResolvedValueOnce(120);
    await expect(f.service().scheduleProactiveThesis(input)).rejects.toThrow('PROACTIVE_THESIS_MAX_RUNS_PER_HOUR');
    expect(f.rows.size).toBe(0);
    expect(f.queue.enqueue).not.toHaveBeenCalled();
    expect((await f.service().scheduleProactiveThesis(input)).status).toBe('SCHEDULED');
    expect(f.rows.size).toBe(1);
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it.each(['steps', 'enqueue'])('renews ownership while %s takes longer than the lease', async (stage) => {
    const f = fixture();
    const gate = deferred();
    if (stage === 'steps') f.prisma.pipelineStepRun.createMany.mockImplementationOnce(async () => { await gate.promise; return { count: 0 }; });
    else f.queue.enqueue.mockImplementationOnce(async () => { await gate.promise; return undefined; });
    const first = f.service().scheduleProactiveThesis(input);
    await vi.advanceTimersByTimeAsync(70_000);
    const second = await f.service().scheduleProactiveThesis(input);
    gate.resolve();
    await first;
    expect(second).toEqual({
      status: 'FAILED', runId: [...f.rows.keys()][0], reason: 'PROACTIVE_THESIS_DELIVERY_IN_PROGRESS',
    });
    expect(f.rows.size).toBe(1);
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)('fences a suspended sender after reclaim when its steps %s', async (outcome) => {
    const f = fixture();
    const gate = deferred();
    f.prisma.pipelineStepRun.createMany.mockImplementationOnce(async () => { await gate.promise; return { count: 0 }; });
    const first = f.service().scheduleProactiveThesis(input).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(0);
    // A suspended process cannot heartbeat. A different process takes its lease.
    vi.setSystemTime(new Date('2026-09-21T00:02:00.000Z'));
    expect((await f.service().scheduleProactiveThesis(input)).status).toBe('SCHEDULED');
    if (outcome === 'resolve') gate.resolve();
    else gate.reject(new Error('old sender failed'));
    const result = await first;
    expect(result).toBeInstanceOf(Error);
    expect([...f.rows.values()][0]!.proactiveDeliveryState).toBe('DELIVERED');
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale token for renewal and both finalization outcomes', async () => {
    const f = fixture();
    f.rows.set('run-1', {
      id: 'run-1', proactiveDeliveryState: 'DELIVERING', proactiveDeliveryToken: 'new-owner',
      proactiveDeliveryLeaseExpiresAt: new Date(Date.now() + 60_000),
    });
    expect(await f.repository.renewProactiveThesisDelivery('run-1', 'old-owner', new Date(), new Date(Date.now() + 60_000))).toEqual({ count: 0 });
    for (const state of ['DELIVERED', 'FAILED'] as const) {
      expect(await f.repository.finalizeProactiveThesisDelivery('run-1', 'old-owner', state, new Date())).toEqual({ count: 0 });
    }
    expect(f.rows.get('run-1')!.proactiveDeliveryToken).toBe('new-owner');
    expect(f.rows.get('run-1')!.proactiveDeliveryState).toBe('DELIVERING');
  });

  it('bounds proactive queue retention after completion and failure', async () => {
    const queue = { add: vi.fn(() => undefined) };
    const adapter = new PipelineQueueService(queue as never);
    await adapter.enqueue({ ...input.request, runId: 'run-1', userId: input.userId, trigger: 'SCHEDULE', createdAt: new Date().toISOString() } as PipelineJob);
    expect(queue.add).toHaveBeenCalledWith('execute', expect.anything(), expect.objectContaining({
      jobId: 'run-1', removeOnComplete: 500, removeOnFail: 1000,
    }));
  });

  it('recognizes execution after queue acceptance and a lost delivery acknowledgement', async () => {
    const f = fixture();
    const updateMany = f.prisma.pipelineRun.updateMany.getMockImplementation()!;
    f.prisma.pipelineRun.updateMany.mockImplementation((args: PipelineRunUpdateManyArgs) => {
      if (args.data.proactiveDeliveryState === 'DELIVERED') throw new Error('acknowledgement lost');
      return updateMany(args);
    });
    // Model the same DB failure against the old, unconditional implementation.
    const update = f.prisma.pipelineRun.update.getMockImplementation()!;
    f.prisma.pipelineRun.update.mockImplementation((args: PipelineRunUpdateArgs) => {
      if (args.data.proactiveDeliveryState === 'DELIVERED') throw new Error('acknowledgement lost');
      return update(args);
    });
    f.queue.enqueue.mockImplementation(async (job: PipelineJob) => { await f.runner().run(job); });
    await expect(f.service().scheduleProactiveThesis(input)).rejects.toThrow('acknowledgement lost');
    f.prisma.pipelineRun.updateMany.mockImplementation(updateMany);
    f.prisma.pipelineRun.update.mockImplementation(update);
    // Redis may have lost/pruned the accepted job. The database remembers execution.
    const result = await f.service().scheduleProactiveThesis(input);
    expect(result.status).toBe('DUPLICATE');
    expect(f.rows.size).toBe(1);
    expect(f.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(f.prisma.pipelineStepRun.updateMany).toHaveBeenCalledTimes(1);
  });

  it('executes and finalizes once across concurrent worker delivery and later re-addition', async () => {
    const f = fixture();
    await f.service().scheduleProactiveThesis(input);
    const job = f.queue.enqueue.mock.calls[0]![0];
    const gate = deferred();
    f.cancellation.isCancelled.mockImplementationOnce(async () => { await gate.promise; return false; });
    const first = f.runner().run(job);
    await vi.advanceTimersByTimeAsync(0);
    await f.runner().run(job);
    gate.resolve();
    await first;
    await f.runner().run(job);
    expect(f.cancellation.isCancelled).toHaveBeenCalledTimes(1);
    expect(f.prisma.pipelineStepRun.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(['COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED', 'TIMEOUT'])('never restarts a legacy terminal %s run', async (status) => {
    const f = fixture();
    await f.service().scheduleProactiveThesis(input);
    const job = f.queue.enqueue.mock.calls[0]![0];
    f.rows.get(job.runId)!.status = status;
    await f.runner().run(job);
    expect(f.rows.get(job.runId)!.status).toBe(status);
    expect(f.cancellation.isCancelled).not.toHaveBeenCalled();
  });
});
