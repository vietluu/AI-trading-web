import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";

export interface ToolLoopCheckResult {
  allowed: boolean;
  decision: "ALLOW" | "WARN" | "STOP";
  reason?: string;
}

@Injectable()
export class ToolLoopGuard {
  private readonly logger = new Logger(ToolLoopGuard.name);

  public calculateFingerprint(toolName: string, args: unknown): string {
    const raw = `${toolName}:${JSON.stringify(args || {})}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  public evaluateLoop(params: {
    toolName: string;
    args: unknown;
    history: Array<{ toolName: string; args: unknown }>;
    currentRound: number;
    maxRounds?: number;
    identicalCallLimit?: number;
  }): ToolLoopCheckResult {
    const maxRounds = params.maxRounds || 5;
    const identicalCallLimit = params.identicalCallLimit || 2;

    // 1. Check max rounds
    if (params.currentRound > maxRounds) {
      return {
        allowed: false,
        decision: "STOP",
        reason: `Maximum tool call rounds exceeded (${params.currentRound} > ${maxRounds})`,
      };
    }

    // 2. Check identical invocation repeat count
    const targetFingerprint = this.calculateFingerprint(params.toolName, params.args);
    let identicalCount = 0;

    for (const item of params.history) {
      const fp = this.calculateFingerprint(item.toolName, item.args);
      if (fp === targetFingerprint) {
        identicalCount++;
      }
    }

    if (identicalCount >= identicalCallLimit) {
      return {
        allowed: false,
        decision: "STOP",
        reason: `Identical tool call '${params.toolName}' repeated ${identicalCount + 1} times (limit: ${identicalCallLimit})`,
      };
    }

    // 3. Warn if total calls in history is high (> 8)
    if (params.history.length >= 8) {
      return {
        allowed: true,
        decision: "WARN",
        reason: "Approaching request tool call limit",
      };
    }

    return { allowed: true, decision: "ALLOW" };
  }
}
