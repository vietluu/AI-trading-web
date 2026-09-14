import { describe, expect, it } from "vitest";
import { buildEvaluationKey } from "../../src/modules/pipeline/domain/evaluation-identity";
import { PipelineRepository } from "../../src/modules/pipeline/infrastructure/pipeline.repository";

describe("pipeline evaluation identity", () => {
  const scheduleInput = {
    userId: "11111111-1111-4111-8111-111111111111",
    provider: "binance_futures",
    symbol: "btc-usdt",
    timeframe: "15M",
    sourceDataCutoff: new Date("2026-09-14T01:14:59.999Z"),
    strategyKey: "ai-core",
    direction: "long",
    configurationVersion: 7,
    trigger: "SCHEDULE",
  };

  it("assigns schedule and event triggers the same normalized evaluation key", () => {
    const eventInput = {
      ...scheduleInput,
      provider: "BINANCE_FUTURES",
      symbol: "BTC-USDT",
      timeframe: "15m",
      direction: "LONG",
      trigger: "EVENT",
    };

    expect(buildEvaluationKey(scheduleInput)).toBe(buildEvaluationKey(eventInput));
    expect(buildEvaluationKey(scheduleInput)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("assigns the next closed candle a different evaluation key", () => {
    const nextCandle = new Date("2026-09-14T01:29:59.999Z");

    expect(
      buildEvaluationKey({ ...scheduleInput, sourceDataCutoff: nextCandle }),
    ).not.toBe(buildEvaluationKey(scheduleInput));
  });
});

describe("paper-signal evaluation deduplication", () => {
  const uniqueConflict = () => Object.assign(
    new Error("Unique constraint failed"),
    { code: "P2002" },
  );

  it("reuses the existing sample when another run claims the same evaluation key", async () => {
    const evaluationKey = "a".repeat(64);
    const signals = [
      { id: "existing-signal", pipelineRunId: "run-1", evaluationKey },
      { id: "duplicate-signal", pipelineRunId: "run-2", evaluationKey: null },
    ];
    const prisma = {
      pipelineRun: {
        update: ({ where, data }: { where: { id: string }; data: { evaluationKey: string } }) => Promise.resolve({
          id: where.id,
          evaluationKey: data.evaluationKey,
        }),
      },
      paperSignal: {
        findFirst: ({ where }: { where: { pipelineRunId?: string; evaluationKey?: string } }) =>
          Promise.resolve(signals.find((signal) =>
            where.pipelineRunId
              ? signal.pipelineRunId === where.pipelineRunId
              : signal.evaluationKey === where.evaluationKey,
          ) ?? null),
        update: ({ where, data }: { where: { id: string }; data: { evaluationKey: string } }) => {
          const signal = signals.find((item) => item.id === where.id)!;
          if (signals.some((item) => item.id !== signal.id && item.evaluationKey === data.evaluationKey)) {
            return Promise.reject(uniqueConflict());
          }
          signal.evaluationKey = data.evaluationKey;
          return Promise.resolve(signal);
        },
        delete: ({ where }: { where: { id: string } }) => {
          const index = signals.findIndex((signal) => signal.id === where.id);
          return Promise.resolve(signals.splice(index, 1)[0]);
        },
      },
    };
    const repository = new PipelineRepository(prisma as never);

    const result = await repository.persistEvaluationIdentity("run-2", evaluationKey);

    expect(result.sampleReused).toBe(true);
    expect(result.paperSignal?.id).toBe("existing-signal");
    expect(signals).toEqual([
      { id: "existing-signal", pipelineRunId: "run-1", evaluationKey },
    ]);
  });

  it("returns an existing paper signal when create races on evaluation identity", async () => {
    const evaluationKey = "b".repeat(64);
    const existing = {
      id: "existing-signal",
      pipelineRunId: "run-1",
      evaluationKey,
    };
    const prisma = {
      paperSignal: {
        create: () => Promise.reject(uniqueConflict()),
        findFirst: ({ where }: {
          where: { OR?: Array<{ evaluationKey?: string; pipelineRunId?: string }> };
        }) => Promise.resolve(where.OR?.some((candidate) =>
          candidate.evaluationKey === evaluationKey ||
          candidate.pipelineRunId === existing.pipelineRunId,
        ) ? existing : null),
      },
    };
    const repository = new PipelineRepository(prisma as never);

    const result = await repository.createPaperSignals([{
      id: "duplicate-signal",
      userId: "11111111-1111-4111-8111-111111111111",
      pipelineRunId: "run-2",
      evaluationKey,
      symbol: "BTC-USDT",
      provider: "BINANCE_FUTURES",
      decision: "LONG",
      confidence: 80,
      mode: "SHADOW",
      referencePrice: 100,
      outcome: "PENDING",
    }]);

    expect(result).toEqual([existing]);
  });
});
