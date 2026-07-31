import { describe, expect, it } from "vitest";

const runE2e = process.env.RUN_E2E_TESTS === "true";
const apiBaseUrl = process.env.E2E_API_URL ?? "http://localhost:3001/api";

describe.skipIf(!runE2e)("Phase 3 connection-management e2e", () => {
  it("registers, creates Binance testnet and OKX demo connections, and lists them", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const password = "Strong-Passphrase1!";
    const register = await fetch(`${apiBaseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `phase3-e2e-${suffix}@example.com`,
        username: `phase3_e2e_${suffix}`.slice(0, 32),
        password,
      }),
    });
    expect(register.status).toBe(201);
    const cookie = register.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const csrf = cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? "";
    const headers = {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
    };
    for (const payload of [
      {
        provider: "BINANCE_FUTURES",
        environment: "TESTNET",
        apiKey: "e2e-binance-key",
        apiSecret: "e2e-binance-secret",
      },
      {
        provider: "OKX_FUTURES",
        environment: "DEMO",
        apiKey: "e2e-okx-key",
        apiSecret: "e2e-okx-secret",
        passphrase: "e2e-passphrase",
      },
    ]) {
      const response = await fetch(`${apiBaseUrl}/exchange-connections`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(201);
    }
    const list = await fetch(`${apiBaseUrl}/exchange-connections`, {
      headers: { Cookie: cookie },
    });
    expect(list.status).toBe(200);
    const connections = (await list.json()) as Array<Record<string, unknown>>;
    expect(connections).toHaveLength(2);
    expect(JSON.stringify(connections)).not.toContain("e2e-binance-secret");
    expect(JSON.stringify(connections)).not.toContain("e2e-okx-secret");
  }, 30_000);
});
