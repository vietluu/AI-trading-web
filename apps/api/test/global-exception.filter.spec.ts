import { Logger } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobalExceptionFilter } from "../src/common/filters/global-exception.filter";

afterEach(() => vi.restoreAllMocks());

describe("GlobalExceptionFilter", () => {
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
