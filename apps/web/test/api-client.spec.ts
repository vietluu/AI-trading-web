import { afterEach, describe, expect, it, vi } from "vitest";

import { z } from "zod";

import { apiRequest, apiRequestValidated } from "../src/lib/api-client";

const originalCookieDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "cookie",
);

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCookieDescriptor) {
    Object.defineProperty(document, "cookie", originalCookieDescriptor);
  }
});

describe("apiRequest", () => {
  it("always sends browser-managed credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/auth/me");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("rejects an invalid API response at the frontend boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 42 }), { status: 200 }),
        ),
    );
    await expect(
      apiRequestValidated("/auth/me", z.object({ id: z.string().uuid() })),
    ).rejects.toThrow();
  });

  it("uses a same-origin relative URL when no backend base URL is configured", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");

    const { apiRequest: apiRequestWithoutBaseUrl } = await import(
      "../src/lib/api-client",
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequestWithoutBaseUrl("/api/health");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("adds the double-submit CSRF token to mutation requests", async () => {
    const originalCookie = document.cookie;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      value: "csrf_token=test-csrf-token",
    });
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);
      await apiRequest("/auth/logout", { method: "POST" });
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(new Headers(request.headers).get("X-CSRF-Token")).toBe(
        "test-csrf-token",
      );
    } finally {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        value: originalCookie,
      });
    }
  });
});
