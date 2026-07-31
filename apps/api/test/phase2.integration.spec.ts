import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";
const apiBaseUrl =
  process.env.INTEGRATION_API_URL ?? "http://localhost:3001/api";

async function request(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });
}

describe.skipIf(!runIntegration)("Phase 2 HTTP integration", () => {
  it("covers authentication, session rotation, settings, and credential CRUD", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `integration-${suffix}@example.com`;
    const username = `integration_${suffix}`.slice(0, 32);
    const password = "integration-password-one";

    const register = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password }),
    });
    expect(register.status).toBe(201);
    let cookie = register.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^sid=/);

    const me = await request("/auth/me", {}, cookie);
    expect(me.status).toBe(200);
    const currentUser = (await me.json()) as {
      id: string;
      passwordHash?: string;
    };
    expect(currentUser).not.toHaveProperty("passwordHash");

    const refresh = await request("/auth/refresh", { method: "POST" }, cookie);
    expect(refresh.status).toBe(204);
    const rotatedCookie = refresh.headers.get("set-cookie")?.split(";")[0];
    expect(rotatedCookie).toMatch(/^sid=/);
    expect(rotatedCookie).not.toBe(cookie);
    cookie = rotatedCookie;

    const settings = await request(
      "/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          theme: "dark",
          timezone: "Asia/Ho_Chi_Minh",
          defaultLeverage: 2,
        }),
      },
      cookie,
    );
    expect(settings.status).toBe(200);

    const createCredential = await request(
      "/credentials",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "OPENAI",
          apiKey: "integration-secret-abcd",
        }),
      },
      cookie,
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as {
      id: string;
      maskedKey: string;
      apiKey?: string;
    };
    expect(credential.maskedKey).toBe("••••abcd");
    expect(credential.apiKey).toBeUndefined();

    expect(
      (
        await request(
          `/credentials/${credential.id}`,
          {
            method: "PUT",
            body: JSON.stringify({ apiKey: "updated-secret-efgh" }),
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/credentials/${credential.id}/test`,
          { method: "POST" },
          cookie,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await request(
          `/credentials/${credential.id}`,
          { method: "DELETE" },
          cookie,
        )
      ).status,
    ).toBe(204);

    expect(
      (await request("/auth/logout", { method: "POST" }, cookie)).status,
    ).toBe(204);
    expect((await request("/auth/me", {}, cookie)).status).toBe(401);

    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier: email, password }),
    });
    expect(login.status).toBe(200);
    const loginCookie = login.headers.get("set-cookie")?.split(";")[0];
    const prisma = new PrismaClient();
    try {
      await prisma.session.updateMany({
        where: { userId: currentUser.id },
        data: { expiresAt: new Date(0) },
      });
    } finally {
      await prisma.$disconnect();
    }
    expect((await request("/auth/me", {}, loginCookie)).status).toBe(401);
  }, 30_000);
});
