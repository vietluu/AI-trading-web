import { describe, expect, it } from "vitest";
import { ToolPolicyEngine } from "../../src/modules/ai-tools/infrastructure/policies/tool-policy.engine";
import { MarketTickerGetTool } from "../../src/modules/ai-tools/infrastructure/tools/market-tools";
import type { ToolExecutionContext } from "../../src/modules/ai-tools/domain/contracts/tool-context.contract";

describe("ToolPolicyEngine", () => {
  const policyEngine = new ToolPolicyEngine();
  const tickerTool = new MarketTickerGetTool();

  it("should ALLOW execution when requirements and capabilities match context", () => {
    const context: ToolExecutionContext = {
      invocationId: "inv-1",
      traceId: "tr-1",
      correlationId: "cr-1",
      requestedAt: new Date(),
      deadlineAt: new Date(Date.now() + 5000),
      source: "AI_PROVIDER",
      capabilities: ["READ_MARKET_DATA"],
      safeMetadata: {},
    };

    const decision = policyEngine.evaluate(tickerTool, context);
    expect(decision.status).toBe("ALLOW");
    expect(decision.reasons.length).toBe(0);
  });

  it("should DENY execution when missing required capability", () => {
    const context: ToolExecutionContext = {
      invocationId: "inv-1",
      traceId: "tr-1",
      correlationId: "cr-1",
      requestedAt: new Date(),
      deadlineAt: new Date(Date.now() + 5000),
      source: "AI_PROVIDER",
      capabilities: [], // Missing READ_MARKET_DATA
      safeMetadata: {},
    };

    const decision = policyEngine.evaluate(tickerTool, context);
    expect(decision.status).toBe("DENY");
    expect(decision.reasons[0]).toContain("missing required capability");
  });
});
