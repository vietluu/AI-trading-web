import { Injectable } from "@nestjs/common";
import { ToolRegistryService } from "../infrastructure/registry/tool-registry.service";
import type { ToolHealthDto } from "@platform/shared";

@Injectable()
export class ToolHealthService {
  constructor(private readonly registry: ToolRegistryService) {}

  public getHealthStatus(): ToolHealthDto[] {
    return this.registry.getHealth();
  }

  public getCategories(): string[] {
    return [
      "MARKET_DATA",
      "TECHNICAL_INDICATOR",
      "NEWS",
      "SENTIMENT",
      "MACRO",
      "SOCIAL",
      "EXCHANGE_ACCOUNT_READ",
      "USER_SETTINGS",
      "AI_MEMORY",
      "SYSTEM",
      "FUTURE_ON_CHAIN",
      "FUTURE_EXECUTION",
    ];
  }

  public getCapabilities(): string[] {
    return [
      "READ_MARKET_DATA",
      "READ_INDICATORS",
      "READ_NEWS",
      "READ_SENTIMENT",
      "READ_MACRO",
      "READ_SOCIAL",
      "READ_ONCHAIN_DATA",
      "READ_USER_SETTINGS",
      "READ_USER_EXCHANGE_ACCOUNT",
      "READ_AI_MEMORY",
      "READ_AI_HISTORY",
      "VIEW_SYSTEM_HEALTH",
    ];
  }
}
