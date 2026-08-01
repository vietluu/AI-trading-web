import { Injectable } from "@nestjs/common";
import type { CanonicalToolSchema } from "../../domain/contracts/provider-schema.contract";

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

@Injectable()
export class GeminiToolSchemaMapper {
  public toProviderName(canonicalName: string): string {
    return canonicalName.replace(/\./g, "_");
  }

  public toCanonicalName(providerName: string): string {
    return providerName.replace(/_/g, ".");
  }

  public mapSchema(canonical: CanonicalToolSchema): GeminiFunctionDeclaration {
    return {
      name: this.toProviderName(canonical.name),
      description: canonical.description,
      parameters: canonical.inputJsonSchema as unknown as Record<string, unknown>,
    };
  }
}
