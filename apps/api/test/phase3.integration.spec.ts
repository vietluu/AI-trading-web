import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

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
  if (cookie) {
    headers.set("Cookie", cookie);
    const csrf = cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1];
    if (
      csrf &&
      !["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase())
    ) {
      headers.set("X-CSRF-Token", csrf);
    }
  }
  return fetch(`${apiBaseUrl}${path}`, { ...init, headers });
}

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

async function register(
  label: string,
): Promise<{ cookie: string; password: string }> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const password = "Strong-Passphrase1!";
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `${label}-${suffix}@example.com`,
      username: `${label}_${suffix}`.slice(0, 32),
      password,
    }),
  });
  expect(response.status).toBe(201);
  return { cookie: cookies(response), password };
}

describe.skipIf(!runIntegration)("Phase 3 HTTP integration", () => {
  it("encrypts credentials and enforces connection ownership", async () => {
    const owner = await register("exchange_owner");
    const other = await register("exchange_other");
    const create = await request(
      "/exchange-connections",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "BINANCE_FUTURES",
          environment: "TESTNET",
          displayName: "Integration Binance",
          apiKey: "integration-api-key-abcd",
          apiSecret: "integration-api-secret",
        }),
      },
      owner.cookie,
    );
    expect(create.status).toBe(201);
    const connection = (await create.json()) as {
      id: string;
      maskedApiKey: string;
      apiKey?: string;
      apiSecret?: string;
    };
    expect(connection.maskedApiKey).toBe("****abcd");
    expect(connection).not.toHaveProperty("apiKey");
    expect(connection).not.toHaveProperty("apiSecret");

    expect(
      (
        await request(
          `/exchange-connections/${connection.id}`,
          {},
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/exchange-connections/${connection.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ displayName: "Hijacked" }),
          },
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/exchange-connections/${connection.id}`,
          { method: "DELETE" },
          other.cookie,
        )
      ).status,
    ).toBe(404);

    const prisma = new PrismaClient();
    try {
      const stored = await prisma.exchangeConnection.findUnique({
        where: { id: connection.id },
        include: { credential: true },
      });
      expect(stored?.credential.encryptedData).not.toContain(
        "integration-api-key-abcd",
      );
      expect(stored?.credential.encryptedData).not.toContain(
        "integration-api-secret",
      );
    } finally {
      await prisma.$disconnect();
    }

    expect(
      (
        await request(
          `/exchange-connections/${connection.id}/disable`,
          { method: "POST" },
          owner.cookie,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await request(
          `/exchange-connections/${connection.id}/account`,
          {},
          owner.cookie,
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await request(
          "/auth/reauthenticate",
          {
            method: "POST",
            body: JSON.stringify({ password: owner.password }),
          },
          owner.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/exchange-connections/${connection.id}`,
          { method: "DELETE" },
          owner.cookie,
        )
      ).status,
    ).toBe(204);
  }, 30_000);

  it("rejects malformed providers, environments, and unauthenticated access", async () => {
    expect((await request("/exchange-connections")).status).toBe(401);
    const owner = await register("exchange_validation");
    const invalidProvider = await request(
      "/exchange-connections",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "BINANCE",
          environment: "TESTNET",
          apiKey: "valid-key",
          apiSecret: "valid-secret",
        }),
      },
      owner.cookie,
    );
    expect(invalidProvider.status).toBe(400);
    const invalidEnvironment = await request(
      "/exchange-connections",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "OKX_FUTURES",
          environment: "TESTNET",
          apiKey: "valid-key",
          apiSecret: "valid-secret",
          passphrase: "valid-passphrase",
        }),
      },
      owner.cookie,
    );
    expect(invalidEnvironment.status).toBe(400);
  }, 30_000);
});
