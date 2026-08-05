import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { SessionGuard } from "../src/session/session.guard";
import type { SessionService } from "../src/session/session.service";

describe("SessionGuard", () => {
  it("attaches an authenticated session from the HttpOnly cookie", async () => {
    const token = "a".repeat(43);
    const request: {
      headers: { cookie: string };
      method: string;
      get: () => undefined;
      auth?: unknown;
    } = {
      headers: { cookie: `other=x; sid=${token}` },
      method: "GET",
      get: () => undefined,
    };
    const sessions = {
      resolve: vi
        .fn()
        .mockResolvedValue({ id: "session-id", userId: "user-id" }),
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ clearCookie: vi.fn() }),
      }),
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
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, method: "GET" }),
        getResponse: () => ({ clearCookie: vi.fn() }),
      }),
    } as unknown as ExecutionContext;
    const guard = new SessionGuard({
      resolve: vi.fn(),
    } as unknown as SessionService);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects unsafe requests without a matching CSRF token", async () => {
    const token = "a".repeat(43);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { cookie: `sid=${token}; csrf_token=cookie-token` },
          method: "POST",
          get: () => "different-header-token",
        }),
        getResponse: () => ({ clearCookie: vi.fn() }),
      }),
    } as unknown as ExecutionContext;
    const guard = new SessionGuard({
      resolve: vi.fn(),
    } as unknown as SessionService);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("does not clear cookies for fingerprint mismatches", async () => {
    const clearCookie = vi.fn();
    const token = "a".repeat(43);
    const request = {
      headers: { cookie: `sid=${token}` },
      method: "GET",
      get: () => undefined,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ clearCookie }),
      }),
    } as unknown as ExecutionContext;
    const sessions = {
      resolve: vi
        .fn()
        .mockRejectedValue(
          new UnauthorizedException("Session device fingerprint changed"),
        ),
    };
    const guard = new SessionGuard(sessions as unknown as SessionService);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(clearCookie).not.toHaveBeenCalled();
  });
});
