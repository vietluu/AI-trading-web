import { Injectable } from "@nestjs/common";

@Injectable()
export class PromptRenderer {
  public render(templateStr: string, variables: Record<string, unknown>): string {
    let result = templateStr;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      const valStr =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value ?? "");
      result = result.replace(placeholder, valStr);
    }
    return result;
  }

  public assembleFullPrompt(params: {
    system?: string;
    developer?: string;
    context?: string;
    user: string;
    examples?: Array<{ input: string; output: string }>;
    history?: Array<{ role: string; content: string }>;
    tools?: Array<{ name: string; description: string }>;
  }): string {
    const parts: string[] = [];

    if (params.system) {
      parts.push(`[SYSTEM]\n${params.system}`);
    }
    if (params.developer) {
      parts.push(`[DEVELOPER INSTRUCTIONS]\n${params.developer}`);
    }
    if (params.tools && params.tools.length > 0) {
      const toolsStr = params.tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
      parts.push(`[AVAILABLE TOOLS]\n${toolsStr}`);
    }
    if (params.examples && params.examples.length > 0) {
      const exStr = params.examples
        .map((ex, i) => `Example ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`)
        .join("\n\n");
      parts.push(`[EXAMPLES]\n${exStr}`);
    }
    if (params.history && params.history.length > 0) {
      const histStr = params.history
        .map((h) => `${h.role.toUpperCase()}: ${h.content}`)
        .join("\n");
      parts.push(`[CONVERSATION HISTORY]\n${histStr}`);
    }
    if (params.context) {
      parts.push(`[CONTEXT DATA]\n${params.context}`);
    }
    parts.push(`[USER REQUEST]\n${params.user}`);

    return parts.join("\n\n");
  }
}
