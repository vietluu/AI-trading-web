import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { GlobalExceptionFilter } from "../src/common/filters/global-exception.filter";

describe("GlobalExceptionFilter", () => {
  it("returns a safe 400 response for invalid Zod input", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "POST", originalUrl: "/ai/research/backtest" }),
        getResponse: () => ({ status, json }),
      }),
    };
    const invalidInput = z.object({ symbol: z.string().regex(/^[A-Z]+-[A-Z]+$/) }).safeParse({
      symbol: "not-a-pair",
    });
    if (invalidInput.success) throw new Error("Expected invalid fixture");

    new GlobalExceptionFilter().catch(invalidInput.error, host as never);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledOnce();
    const body = z.object({
      statusCode: z.number(),
      path: z.string(),
      error: z.string(),
      message: z.string(),
    }).parse(json.mock.calls[0]?.[0]);
    expect(body).toMatchObject({
      statusCode: 400,
      path: "/ai/research/backtest",
      error: "ValidationError",
    });
    expect(body.message).toContain("symbol");
  });
});
