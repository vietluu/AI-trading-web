import { describe, expect, it } from "vitest";

import { FusionRunInputSchema } from "../src/schemas/agents.js";
import {
  PipelineRunResultSchema,
  PipelineScheduleInputSchema,
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

describe("PipelineRunResultSchema", () => {
  it("parses both legacy results and canonical gate provenance", () => {
    expect(PipelineRunResultSchema.parse({ decision: "WAIT" })).toEqual({
      decision: "WAIT",
    });
    expect(PipelineRunResultSchema.parse({
      decision: "WAIT",
      gates: [{
        stage: "QUANT",
        disposition: "BLOCK",
        reasonCodes: ["QUANT_ASSUMPTION_MISMATCH"],
        selectedBlockingReason: "QUANT_ASSUMPTION_MISMATCH",
      }],
      blockingGate: {
        stage: "QUANT",
        reason: "QUANT_ASSUMPTION_MISMATCH",
      },
    })).toMatchObject({
      blockingGate: {
        stage: "QUANT",
        reason: "QUANT_ASSUMPTION_MISMATCH",
      },
    });
  });
});
