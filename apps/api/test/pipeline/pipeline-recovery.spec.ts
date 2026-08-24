import { describe, expect, it, vi } from "vitest";
import { PipelineRecoveryService } from "../../src/modules/pipeline/application/pipeline-recovery.service";

type RecoveryUpdate = {
  where: { id: string; status: string };
  data: { status: string; errorCode: string };
};

function runWithLock<T>(
  _key: string,
  _ttl: number,
  worker: () => Promise<T>,
): Promise<T> {
  return worker();
}

describe("PipelineRecoveryService", () => {
  it("times out orphaned runs, restores retrying runs to queued, and preserves active jobs", async () => {
    const startedAt = new Date("2026-08-18T00:00:00Z");
    const updates: RecoveryUpdate[] = [];
    const prisma = {
      pipelineRun: {
        findMany: vi.fn().mockResolvedValue([
          { id: "orphan", status: "RUNNING", startedAt, createdAt: startedAt },
          { id: "retrying", status: "RUNNING", startedAt, createdAt: startedAt },
          { id: "active", status: "RUNNING", startedAt, createdAt: startedAt },
        ]),
        updateMany: vi.fn((update: RecoveryUpdate) => {
          updates.push(update);
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const queue = {
      jobState: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("delayed")
        .mockResolvedValueOnce("active"),
    };
    const taskLock = { run: vi.fn(runWithLock) };
    const service = new PipelineRecoveryService(
      prisma as never,
      queue as never,
      { staleRunAfterMs: 960_000, recoveryIntervalMs: 60_000 } as never,
      taskLock as never,
    );

    const result = await service.sweep(new Date("2026-08-18T01:00:00Z"));

    expect(result).toEqual({
      inspected: 3,
      timedOut: 1,
      requeued: 1,
      activeStale: 1,
      staleQueued: 0,
    });
    expect(updates[0]).toMatchObject({
      where: { id: "orphan", status: "RUNNING" },
      data: { status: "TIMEOUT", errorCode: "ORPHANED_PIPELINE_RUN" },
    });
    expect(updates[1]).toMatchObject({
      where: { id: "retrying", status: "RUNNING" },
      data: { status: "QUEUED", errorCode: "RETRY_PENDING" },
    });
    expect(prisma.pipelineRun.updateMany).toHaveBeenCalledTimes(2);
  });

  it("does not mutate database state when queue state cannot be verified", async () => {
    const prisma = {
      pipelineRun: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "unknown", status: "RUNNING", startedAt: new Date(0), createdAt: new Date(0) }]),
        updateMany: vi.fn(),
      },
    };
    const service = new PipelineRecoveryService(
      prisma as never,
      {
        jobState: vi.fn().mockRejectedValue(new Error("redis unavailable")),
      } as never,
      { staleRunAfterMs: 960_000, recoveryIntervalMs: 60_000 } as never,
      { run: vi.fn(runWithLock) } as never,
    );

    expect(await service.sweep()).toEqual({
      inspected: 1,
      timedOut: 0,
      requeued: 0,
      activeStale: 0,
      staleQueued: 0,
    });
    expect(prisma.pipelineRun.updateMany).not.toHaveBeenCalled();
  });

  it("times out a stale queued run whose BullMQ job no longer exists", async () => {
    const createdAt = new Date("2026-08-20T00:00:00Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new PipelineRecoveryService(
      {
        pipelineRun: {
          findMany: vi.fn().mockResolvedValue([
            { id: "queued-orphan", status: "QUEUED", startedAt: null, createdAt },
          ]),
          updateMany,
        },
      } as never,
      { jobState: vi.fn().mockResolvedValue(undefined) } as never,
      { staleRunAfterMs: 960_000, recoveryIntervalMs: 60_000 } as never,
      { run: vi.fn(runWithLock) } as never,
    );

    expect(await service.sweep(new Date("2026-08-20T01:00:00Z"))).toEqual({
      inspected: 1,
      timedOut: 1,
      requeued: 0,
      activeStale: 0,
      staleQueued: 1,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "queued-orphan", status: "QUEUED" },
      data: expect.objectContaining({
        status: "TIMEOUT",
        errorCode: "ORPHANED_QUEUED_RUN",
      }) as unknown,
    }));
  });
});
