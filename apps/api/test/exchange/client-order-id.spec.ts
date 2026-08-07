import { describe, expect, it } from "vitest";

import { normalizeClientOrderId } from "../../src/exchange/infrastructure/client-order-id";

describe("normalizeClientOrderId", () => {
  it("removes hyphens and non-alphanumeric characters before sending to an exchange", () => {
    expect(normalizeClientOrderId("p9-64035c1f550349a9a5a294f2ed-b3")).toBe(
      "p964035c1f550349a9a5a294f2edb3",
    );
  });

  it("truncates the value to the exchange-safe length", () => {
    expect(normalizeClientOrderId("abcdefghijklmnopqrstuvwxyz1234567")).toBe(
      "abcdefghijklmnopqrstuvwxyz1234567".slice(0, 30) + "67",
    );
  });

  it("returns a fallback value when the input is empty", () => {
    expect(normalizeClientOrderId("   ")).toBeUndefined();
  });
});
