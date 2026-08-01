import { Injectable } from "@nestjs/common";
import type { CanonicalToolSchema } from "../../domain/contracts/provider-schema.contract";

export interface OllamaToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

@Injectable()
export class OllamaToolSchemaMapper {
  public toProviderName(canonicalName: string): string {
    return canonicalName.replace(/\./g, "_");
  }

  public toCanonicalName(providerName: string): string {
    return providerName.replace(/_/g, ".");
  }

  public mapSchema(canonical: CanonicalToolSchema): OllamaToolDefinition {
    return {
      type: "function",
      function: {
        name: this.toProviderName(canonical.name),
        description: canonical.description,
        parameters: canonical.inputJsonSchema as unknown as Record<string, unknown>,
      },
    };
  }
}
