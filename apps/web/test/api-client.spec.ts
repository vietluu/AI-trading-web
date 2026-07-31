import { afterEach, describe, expect, it, vi } from "vitest";

import { z } from "zod";

import { apiRequest, apiRequestValidated } from "../src/lib/api-client";

afterEach(() => vi.unstubAllGlobals());

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
});
