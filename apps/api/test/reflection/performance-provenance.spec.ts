import type { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PerformanceService } from "../../src/modules/reflection/application/performance.service";
import { performanceDriftToleranceMs } from "../../src/modules/reflection/domain/performance-provenance";
import { ReflectionRepository } from "../../src/modules/reflection/infrastructure/reflection.repository";

describe("performanceDriftToleranceMs", () => {
  it("returns 60_000 for M15", () => {
    expect(performanceDriftToleranceMs("M15", 15 * 60_000)).toBe(60_000);
  });

  it("returns 60_000 for M30", () => {
    expect(performanceDriftToleranceMs("M30", 30 * 60_000)).toBe(60_000);
  });

  it("returns 120_000 for MID", () => {
    expect(performanceDriftToleranceMs("MID", 60 * 60_000)).toBe(120_000);
  });

  it("returns 120_000 for H2", () => {
    expect(performanceDriftToleranceMs("H2", 2 * 60 * 60_000)).toBe(120_000);
  });

  it("returns 120_000 for H4", () => {
    expect(performanceDriftToleranceMs("H4", 4 * 60 * 60_000)).toBe(120_000);
  });

  it("returns 300_000 for LONG", () => {
    expect(performanceDriftToleranceMs("LONG", 24 * 60 * 60_000)).toBe(300_000);
  });

  it("clamps SHORT tolerance to at least 15_000", () => {
    expect(performanceDriftToleranceMs("SHORT", 100_000)).toBe(15_000);
  });

  it("clamps SHORT tolerance to at most 60_000", () => {
    expect(performanceDriftToleranceMs("SHORT", 900_000)).toBe(60_000);
  });

  it("computes SHORT tolerance as 10% of configured duration within clamp", () => {
    expect(performanceDriftToleranceMs("SHORT", 300_000)).toBe(30_000);
  });
});

describe("performance evaluation provenance", () => {
  it("evaluates the accepted owner when its duplicate completed first", async () => {
    const now = Date.now();
    const evaluationKey = "c".repeat(64);
    const createdRecords: Array<{ runId: string }> = [];
    const repository = {
      completedRuns: () => Promise.resolve([
        {
          id: "run-b",
          userId: "11111111-1111-4111-8111-111111111111",
          symbol: "BTC-USDT",
          provider: "BINANCE_FUTURES",
          decision: "LONG",
          confidence: 80,
          evaluationKey,
          createdAt: new Date(now - 25 * 60 * 60_000),
          completedAt: new Date(now - 25 * 60 * 60_000),
          storedContext: {},
          performanceRecords: [],
        },
        {
          id: "run-a",
          userId: "11111111-1111-4111-8111-111111111111",
          symbol: "BTC-USDT",
          provider: "BINANCE_FUTURES",
          decision: "LONG",
          confidence: 80,
          evaluationKey,
          createdAt: new Date(now - 26 * 60 * 60_000),
          completedAt: new Date(now - 24 * 60 * 60_000),
          storedContext: {},
          performanceRecords: [],
        },
      ]),
      evaluationSampleClaimed: (_key: string, runId: string) =>
        Promise.resolve(runId !== "run-a"),
      candleAtOrBefore: (_provider: string, _symbol: string, at: Date) =>
        Promise.resolve({ close: new Prisma.Decimal(100), closeTime: at }),
      candleAtOrAfter: (_provider: string, _symbol: string, target: Date) =>
        Promise.resolve({ close: new Prisma.Decimal(110), closeTime: target }),
      createRecord: (record: { runId: string }) => {
        createdRecords.push(record);
        return Promise.resolve(record);
      },
    } as unknown as ReflectionRepository;
    const config = {
      get: <T>(_key: string, fallback: T) => fallback,
    } as ConfigService;

    const result = await new PerformanceService(repository, config).evaluateDue();

    expect(result.evaluated).toBe(7);
    expect([...new Set(createdRecords.map((record) => record.runId))]).toEqual([
      "run-a",
    ]);
  });

  it("reserves an evaluation sample for the earliest run before labels exist", async () => {
    const repository = new ReflectionRepository({
      pipelineRun: {
        findFirst: ({ where }: {
          where: { performanceRecords?: { some: Record<string, never> } };
        }) => Promise.resolve(
          where.performanceRecords ? null : { id: "run-1" },
        ),
      },
    } as never);

    await expect(repository.evaluationSampleClaimed(
      "a".repeat(64),
      "run-2",
    )).resolves.toBe(true);
  });

  it("allows a completed duplicate when the earlier run failed without labels", async () => {
    const repository = new ReflectionRepository({
      pipelineRun: {
        count: () => Promise.resolve(0),
        findFirst: ({ where }: {
          where: {
            status?: string;
            performanceRecords?: { some: Record<string, never> };
          };
        }) => {
          if (where.performanceRecords) return Promise.resolve(null);
          if (where.status === "COMPLETED") {
            return Promise.resolve({ id: "successful-run" });
          }
          return Promise.resolve({ id: "failed-run" });
        },
      },
    } as never);

    await expect(repository.evaluationSampleClaimed(
      "d".repeat(64),
      "successful-run",
    )).resolves.toBe(false);
  });

  it("does not label a run when its evaluation key already has performance samples", async () => {
    const createdRecords: unknown[] = [];
    const repository = {
      completedRuns: () => Promise.resolve([{
        id: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        symbol: "BTC-USDT",
        provider: "BINANCE_FUTURES",
        decision: "LONG",
        confidence: 80,
        evaluationKey: "a".repeat(64),
        completedAt: new Date(Date.now() - 25 * 60 * 60_000),
        storedContext: {},
        performanceRecords: [],
      }]),
      evaluationSampleClaimed: () => Promise.resolve(true),
      candleAtOrBefore: () => Promise.resolve({
        close: new Prisma.Decimal(100),
        closeTime: new Date(Date.now() - 25 * 60 * 60_000),
      }),
      candleAtOrAfter: (_provider: string, _symbol: string, target: Date) => Promise.resolve({
        close: new Prisma.Decimal(110),
        closeTime: target,
      }),
      createRecord: (record: unknown) => {
        createdRecords.push(record);
        return Promise.resolve(record);
      },
    } as unknown as ReflectionRepository;
    const config = {
      get: <T>(_key: string, fallback: T) => fallback,
    } as ConfigService;

    const result = await new PerformanceService(repository, config).evaluateDue();

    expect(result.evaluated).toBe(0);
    expect(createdRecords).toEqual([]);
  });
});

describe("PerformanceService.executablePerformance", () => {
  const service = new PerformanceService({} as never, {} as never);

  const lifecycleFixture = (overrides: Record<string, unknown> = {}) => ({
    status: 'FINALIZED',
    exitReason: 'STOP_LOSS',
    netR: -1,
    realizedNetPnl: -50,
    ...overrides,
  });
  const performanceFixture = (overrides: Record<string, unknown> = {}) => ({
    outcome: 'CORRECT' as const,
    returnPct: 0.45,
    ...overrides,
  });

  it('keeps a stopped trade wrong when the one-hour mark later agrees', async () => {
    const result = await service.executablePerformance({
      lifecycle: lifecycleFixture({ exitReason: 'STOP_LOSS', netR: -1 }),
      horizon: performanceFixture({ outcome: 'CORRECT', returnPct: 0.45 }),
    });
    expect(result).toMatchObject({
      source: 'TRADE_LIFECYCLE', outcome: 'WRONG', netR: -1,
    });
  });
});
