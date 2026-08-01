import { Injectable, Logger } from "@nestjs/common";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";

export interface ToolPolicyDecision {
  status: "ALLOW" | "DENY";
  reasons: string[];
  appliedPolicyVersion: number;
  evaluatedAt: Date;
}

@Injectable()
export class ToolPolicyEngine {
  private readonly logger = new Logger(ToolPolicyEngine.name);
  private readonly currentPolicyVersion = 1;

  public evaluate(tool: ToolDefinition, context: ToolExecutionContext): ToolPolicyDecision {
    const reasons: string[] = [];

    // 1. Tool Status Check
    if (tool.status !== "ACTIVE" && tool.status !== "EXPERIMENTAL") {
      reasons.push(`Tool '${tool.name}' is ${tool.status}`);
    }

    // 2. Authentication & User Scoped Context Check
    if (tool.requiresAuthentication && !context.userId) {
      reasons.push(`Tool '${tool.name}' requires an authenticated user context`);
    }

    if (tool.userScoped && !context.userId) {
      reasons.push(`Tool '${tool.name}' is user-scoped but no userId was present in server context`);
    }

    // 3. Side-Effect Level Check (Phase 6.2: Default Deny all write side effects!)
    if (tool.sideEffect === "USER_STATE_WRITE" || tool.sideEffect === "FINANCIAL_WRITE" || tool.sideEffect === "SYSTEM_WRITE") {
      reasons.push(`Tool '${tool.name}' has prohibited side effect level '${tool.sideEffect}' in Phase 6.2`);
    }

    // 4. Capabilities Check (Requested capabilities ⊆ Context capabilities)
    for (const cap of tool.requiredCapabilities) {
      if (!context.capabilities.includes(cap)) {
        reasons.push(`Caller context is missing required capability '${cap}' for tool '${tool.name}'`);
      }
    }

    // 5. Allowed Agent Types
    if (tool.allowedAgentTypes.length > 0 && context.agentType) {
      if (!tool.allowedAgentTypes.includes(context.agentType) && !tool.allowedAgentTypes.includes("*")) {
        reasons.push(`Agent type '${context.agentType}' is not authorized to invoke tool '${tool.name}'`);
      }
    }

    const isAllowed = reasons.length === 0;
    return {
      status: isAllowed ? "ALLOW" : "DENY",
      reasons,
      appliedPolicyVersion: this.currentPolicyVersion,
      evaluatedAt: new Date(),
    };
  }
}
