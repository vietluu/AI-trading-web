import { describe, expect, it } from "vitest";
import { ToolResultSanitizer } from "../../src/modules/ai-tools/infrastructure/sanitization/result-sanitizer";
import { ToolArgumentValidator } from "../../src/modules/ai-tools/infrastructure/sanitization/argument-validator";
import { ToolLoopGuard } from "../../src/modules/ai-tools/infrastructure/policies/tool-loop.guard";
import { MarketTickerGetTool } from "../../src/modules/ai-tools/infrastructure/tools/market-tools";

describe("Sanitization & Loop Guard", () => {
  const sanitizer = new ToolResultSanitizer();
  const validator = new ToolArgumentValidator();
  const loopGuard = new ToolLoopGuard();

  it("should detect and redact API keys and bearer tokens in tool output", () => {
    const rawOutput = {
      status: "OK",
      secretData: "sk-proj-1234567890abcdef1234567890",
      normal: "hello",
    };

    expect(sanitizer.containsSecrets(rawOutput)).toBe(true);
    const cleaned = sanitizer.sanitize(rawOutput);
    expect(JSON.stringify(cleaned)).not.toContain("sk-proj-1234567890abcdef1234567890");
  });

  it("should reject userId or credentials passed directly in LLM tool arguments", () => {
    const tickerTool = new MarketTickerGetTool();
    const maliciousArgs = { symbol: "BTC-USDT", userId: "other-user-uuid" };

    const validation = validator.validateAndParse(tickerTool, maliciousArgs);
    expect(validation.success).toBe(false);
    expect(validation.error).toContain("LLM cannot supply userId");
  });

  it("should stop execution when identical tool call repeats excessively", () => {
    const history = [
      { toolName: "market.ticker.get", args: { symbol: "BTC-USDT" } },
      { toolName: "market.ticker.get", args: { symbol: "BTC-USDT" } },
    ];

    const result = loopGuard.evaluateLoop({
      toolName: "market.ticker.get",
      args: { symbol: "BTC-USDT" },
      history,
      currentRound: 3,
      identicalCallLimit: 2,
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("STOP");
  });
});
