import type { HealthResponse } from "@platform/shared";
import { describe, expect, it, vi } from "vitest";

import { HealthController } from "../src/health/health.controller";
import type { HealthService } from "../src/health/health.service";

describe("HealthController", () => {
  it("returns the health service result", async () => {
    const expected: HealthResponse = {
      status: "ok",
      timestamp: "2026-07-31T00:00:00.000Z",
      services: {
        database: { status: "up", latencyMs: 2 },
        redis: { status: "up", latencyMs: 1 },
      },
    };
    const getHealth = vi.fn<() => Promise<HealthResponse>>();
    getHealth.mockResolvedValue(expected);
    const healthService = { getHealth } as unknown as HealthService;
    const controller = new HealthController(healthService);

    await expect(controller.getHealth()).resolves.toEqual(expected);
    expect(getHealth).toHaveBeenCalledOnce();
  });
});
