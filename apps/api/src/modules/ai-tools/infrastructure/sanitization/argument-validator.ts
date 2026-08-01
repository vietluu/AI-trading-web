import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";

@Injectable()
export class ToolArgumentValidator {
  private readonly logger = new Logger(ToolArgumentValidator.name);

  public validateAndParse<TInput>(
    tool: ToolDefinition<TInput, unknown>,
    rawArgs: unknown
  ): { success: boolean; data?: TInput; error?: string } {
    let parsedObject: unknown = rawArgs;

    if (typeof rawArgs === "string") {
      try {
        parsedObject = JSON.parse(rawArgs);
      } catch {
        return { success: false, error: "Failed to parse tool arguments JSON string" };
      }
    }

    if (!parsedObject || typeof parsedObject !== "object") {
      return { success: false, error: "Tool arguments must be a non-null object" };
    }

    // Check prototype pollution & illegal keys
    const keys = Object.keys(parsedObject);
    if (keys.includes("__proto__") || keys.includes("constructor") || keys.includes("prototype")) {
      return { success: false, error: "Illegal prototype-pollution property detected in arguments" };
    }

    // Security check: Never accept userId or credentials passed directly by the AI model!
    if (keys.includes("userId") || keys.includes("user_id") || keys.includes("apiKey") || keys.includes("apiSecret")) {
      return {
        success: false,
        error: "Security violation: LLM cannot supply userId or exchange credentials in tool arguments",
      };
    }

    try {
      const validatedData = tool.inputSchema.parse(parsedObject);
      return { success: true, data: validatedData };
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return { success: false, error: `Argument validation failed: ${issues}` };
      }
      return { success: false, error: `Argument validation failed: ${String(err)}` };
    }
  }
}
