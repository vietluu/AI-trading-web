import { describe, expect, it } from "vitest";

import { FusionRunInputSchema } from "../src/schemas/agents.js";
import {
  ExecutionContextSchema,
  PipelineScheduleInputSchema,
  StoredPipelineContextSchema,
} from "../src/schemas/pipeline.js";

const schedule = {
  pipelineId: "FULL_ANALYSIS_DECISION",
  symbols: ["BTC-USDT"],
  provider: "BINANCE_FUTURES",
  mode: "INTERVAL",
  enabled: true,
  timezone: "Asia/Ho_Chi_Minh",
};

describe("FusionRunInputSchema", () => {
  it("accepts additional supported symbols beyond BTC and ETH", () => {
    expect(FusionRunInputSchema.safeParse({
      symbol: "SOL-USDT",
      provider: "BINANCE_FUTURES",
      interval: "15m",
      lookbackCandles: 150,
      lookbackHours: 6,
      maxItems: 20,
    }).success).toBe(true);
  });
});

describe("PipelineScheduleInputSchema", () => {
  it("rejects schedules faster than five minutes", () => {
    expect(
      PipelineScheduleInputSchema.safeParse({ ...schedule, intervalMs: 60_000 })
        .success,
    ).toBe(false);
  });

  it("accepts a five-minute schedule and caps the hourly fan-out", () => {
    const result = PipelineScheduleInputSchema.parse({
      ...schedule,
      intervalMs: 300_000,
    });
    expect(result.intervalMs).toBe(300_000);
    expect(result.maxRunsPerHour).toBe(60);
  });
});

describe("ExecutionContextSchema", () => {
  const context = {
    regime: "RANGING",
    setup: "RANGE_REVERSION",
    action: "ENTER",
    riskTier: "NORMAL",
    sourceDataCutoff: "2026-09-12T22:59:59.999Z",
    usesClosedPrimaryCandle: true,
    triggerConfirmed: true,
    priceLocation: {
      rangePercentile: 0.8,
      distanceFromSupportAtr: 1.5,
      distanceFromResistanceAtr: 0.25,
    },
  };

  it("accepts the canonical execution context persisted by pipeline runs", () => {
    expect(ExecutionContextSchema.parse(context)).toEqual(context);
  });

  it("keeps historical stored contexts valid when execution context is absent", () => {
    expect(StoredPipelineContextSchema.parse({ analyses: {} })).toEqual({
      analyses: {},
    });
  });
});
