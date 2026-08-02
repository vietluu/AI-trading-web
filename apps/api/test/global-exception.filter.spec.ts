import { Logger } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobalExceptionFilter } from "../src/common/filters/global-exception.filter";
import {
  AgentError,
  AgentErrorCode,
} from "../src/modules/agents/domain/errors/agent-errors";

afterEach(() => vi.restoreAllMocks());

describe("GlobalExceptionFilter", () => {
  it("maps agent quota failures to HTTP 429 with a safe error code", () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "POST", originalUrl: "/api/agents/NEWS_ANALYST/runs" }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(
      new AgentError(
        AgentErrorCode.AGENT_QUOTA_EXCEEDED,
        "Execution denied: User quota check failed: Exceeded hourly quota of 100",
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        code: "AGENT_QUOTA_EXCEEDED",
        error: "AGENT_QUOTA_EXCEEDED",
      }),
    );
  });

  it("does not expose unexpected exception details to the client", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "GET", originalUrl: "/api/private" }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(
      new Error("database password appeared in an internal exception"),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "An unexpected error occurred",
        error: "InternalServerError",
      }),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain("database password");
  });
});
