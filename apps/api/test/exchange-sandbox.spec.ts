import { describe, it } from "vitest";

const runSandbox = process.env.RUN_EXCHANGE_SANDBOX_TESTS === "true";

describe.skipIf(!runSandbox)("manual exchange sandbox", () => {
  it.todo("authenticates dedicated Binance testnet read-only credentials");
  it.todo("authenticates dedicated OKX demo read-only credentials");
});
