import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { SessionGuard } from "../src/session/session.guard";
import type { SessionService } from "../src/session/session.service";

describe("SessionGuard", () => {
  it("attaches an authenticated session from the HttpOnly cookie", async () => {
    const token = "a".repeat(43);
    const request: { headers: { cookie: string }; auth?: unknown } = {
      headers: { cookie: `other=x; sid=${token}` },
    };
    const sessions = {
      resolve: vi
        .fn()
        .mockResolvedValue({ id: "session-id", userId: "user-id" }),
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(
      new SessionGuard(sessions as unknown as SessionService).canActivate(
        context,
      ),
    ).resolves.toBe(true);
    expect(request.auth).toEqual({
      userId: "user-id",
      sessionRecordId: "session-id",
      sessionToken: token,
    });
  });

  it("rejects requests without a session cookie", async () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;
    const guard = new SessionGuard({
      resolve: vi.fn(),
    } as unknown as SessionService);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
