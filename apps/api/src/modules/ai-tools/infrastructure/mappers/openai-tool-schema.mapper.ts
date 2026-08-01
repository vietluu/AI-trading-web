import { Injectable } from "@nestjs/common";
import type { CanonicalToolSchema } from "../../domain/contracts/provider-schema.contract";

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

@Injectable()
export class OpenAIToolSchemaMapper {
  public toProviderName(canonicalName: string): string {
    // OpenAI function names must be [a-zA-Z0-9_-]
    return canonicalName.replace(/\./g, "_");
  }

  public toCanonicalName(providerName: string): string {
    return providerName.replace(/_/g, ".");
  }

  public mapSchema(canonical: CanonicalToolSchema): OpenAIToolDefinition {
    return {
      type: "function",
      function: {
        name: this.toProviderName(canonical.name),
        description: canonical.description,
        parameters: canonical.inputJsonSchema as unknown as Record<string, unknown>,
        strict: canonical.strict,
      },
    };
  }
}
