import { Injectable } from "@nestjs/common";
import type { CanonicalToolSchema } from "../../domain/contracts/provider-schema.contract";

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

@Injectable()
export class AnthropicToolSchemaMapper {
  public toProviderName(canonicalName: string): string {
    return canonicalName.replace(/\./g, "_");
  }

  public toCanonicalName(providerName: string): string {
    return providerName.replace(/_/g, ".");
  }

  public mapSchema(canonical: CanonicalToolSchema): AnthropicToolDefinition {
    return {
      name: this.toProviderName(canonical.name),
      description: canonical.description,
      input_schema: canonical.inputJsonSchema as unknown as Record<string, unknown>,
    };
  }
}
