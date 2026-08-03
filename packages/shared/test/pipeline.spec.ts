import { describe, expect, it } from "vitest";

import { PipelineScheduleInputSchema } from "../src/schemas/pipeline.js";

const schedule = {
  pipelineId: "FULL_ANALYSIS_DECISION",
  symbols: ["BTC-USDT"],
  provider: "BINANCE_FUTURES",
  mode: "INTERVAL",
  enabled: true,
  timezone: "Asia/Ho_Chi_Minh",
};

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
