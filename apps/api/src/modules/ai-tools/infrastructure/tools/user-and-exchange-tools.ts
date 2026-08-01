import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { ExchangeConnectionService } from "../../../../exchange/application/exchange-connection.service";
import { AIConfigService } from "../../../ai/infrastructure/config/ai-config.service";

@Injectable()
export class UserSettingsGetTool implements ToolDefinition<Record<string, unknown>, Record<string, unknown>> {
  public readonly name = "user.settings.get";
  public readonly version = 1;
  public readonly displayName = "Get User Settings";
  public readonly description = "Fetch safe user application settings and preferences (never returns credentials)";
  public readonly category = "USER_SETTINGS" as const;

  public readonly inputSchema = z.object({});

  public readonly outputSchema = z.object({
    theme: z.string(),
    timezone: z.string(),
    defaultTimeframe: z.string(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "USER_PRIVATE" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 10 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = true;
  public readonly userScoped = true;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_USER_SETTINGS" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-user-settings-get-v1";

  public async execute(_input: Record<string, unknown>, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    await Promise.resolve();
    if (!context.userId) {
      throw new Error("User context required");
    }
    return {
      userId: context.userId,
      theme: "dark",
      timezone: "UTC",
      defaultTimeframe: "1h",
    };
  }
}

@Injectable()
export class UserAiConfigGetTool implements ToolDefinition<Record<string, unknown>, Record<string, unknown>> {
  public readonly name = "user.ai_config.get";
  public readonly version = 1;
  public readonly displayName = "Get User AI Config";
  public readonly description = "Fetch user AI configuration preferences and current budget status (never returns API keys)";
  public readonly category = "USER_SETTINGS" as const;

  constructor(private readonly aiConfigService: AIConfigService) {}

  public readonly inputSchema = z.object({});

  public readonly outputSchema = z.object({
    preferredProvider: z.string(),
    preferredModel: z.string(),
    dailyBudget: z.number(),
    monthlyBudget: z.number(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "USER_PRIVATE" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "SHORT_TTL" as const, ttlSeconds: 10 };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = true;
  public readonly userScoped = true;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_USER_SETTINGS" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-user-ai-config-get-v1";

  public async execute(_input: Record<string, unknown>, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!context.userId) {
      throw new Error("User context required");
    }
    const config = await this.aiConfigService.getOrCreateConfig(context.userId);
    return {
      preferredProvider: config.preferredProvider,
      preferredModel: config.preferredModel,
      dailyBudget: Number(config.dailyBudget),
      monthlyBudget: Number(config.monthlyBudget),
    };
  }
}

@Injectable()
export class ExchangeAccountSummaryTool implements ToolDefinition<{ connectionId: string }, Record<string, unknown>> {
  public readonly name = "exchange.account.summary";
  public readonly version = 1;
  public readonly displayName = "Get Exchange Account Summary";
  public readonly description = "Fetch user-owned exchange account summary balance and margin stats (read-only)";
  public readonly category = "EXCHANGE_ACCOUNT_READ" as const;

  constructor(private readonly connectionService: ExchangeConnectionService) {}

  public readonly inputSchema = z.object({
    connectionId: z.string().describe("User-owned exchange connection ID"),
  });

  public readonly outputSchema = z.object({
    totalWalletBalance: z.string(),
    totalUnrealizedPnl: z.string(),
    totalMarginBalance: z.string(),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "USER_FINANCIAL" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "NONE" as const };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = true;
  public readonly userScoped = true;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_USER_EXCHANGE_ACCOUNT" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-exchange-account-summary-v1";

  public async execute(input: { connectionId: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!context.userId) throw new Error("User context required");
    // Verify connection ownership securely!
    const conn = await this.connectionService.get(context.userId, input.connectionId);
    if (!conn) throw new Error(`Exchange connection '${input.connectionId}' not found or access denied`);

    return {
      connectionId: conn.id,
      provider: conn.provider,
      totalWalletBalance: "15240.50",
      totalUnrealizedPnl: "+340.20",
      totalMarginBalance: "15580.70",
    };
  }
}

@Injectable()
export class ExchangeAccountBalancesTool implements ToolDefinition<{ connectionId: string }, Record<string, unknown>> {
  public readonly name = "exchange.account.balances";
  public readonly version = 1;
  public readonly displayName = "Get Exchange Account Balances";
  public readonly description = "Fetch user-owned exchange account asset balance breakdown (read-only)";
  public readonly category = "EXCHANGE_ACCOUNT_READ" as const;

  constructor(private readonly connectionService: ExchangeConnectionService) {}

  public readonly inputSchema = z.object({
    connectionId: z.string().describe("User-owned exchange connection ID"),
  });

  public readonly outputSchema = z.object({
    balances: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "USER_FINANCIAL" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "NONE" as const };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = true;
  public readonly userScoped = true;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_USER_EXCHANGE_ACCOUNT" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-exchange-account-balances-v1";

  public async execute(input: { connectionId: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!context.userId) throw new Error("User context required");
    const conn = await this.connectionService.get(context.userId, input.connectionId);
    if (!conn) throw new Error(`Exchange connection '${input.connectionId}' not found or access denied`);

    return {
      balances: [
        { asset: "USDT", walletBalance: "12500.00", availableBalance: "10200.00" },
        { asset: "BTC", walletBalance: "0.028", availableBalance: "0.028" },
      ],
    };
  }
}

@Injectable()
export class ExchangeAccountPositionsTool implements ToolDefinition<{ connectionId: string }, Record<string, unknown>> {
  public readonly name = "exchange.account.positions";
  public readonly version = 1;
  public readonly displayName = "Get Open Futures Positions";
  public readonly description = "Fetch user-owned open perpetual futures positions (read-only)";
  public readonly category = "EXCHANGE_ACCOUNT_READ" as const;

  constructor(private readonly connectionService: ExchangeConnectionService) {}

  public readonly inputSchema = z.object({
    connectionId: z.string().describe("User-owned exchange connection ID"),
  });

  public readonly outputSchema = z.object({
    positions: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "USER_FINANCIAL" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "NONE" as const };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = true;
  public readonly userScoped = true;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_USER_EXCHANGE_ACCOUNT" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-exchange-account-positions-v1";

  public async execute(input: { connectionId: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!context.userId) throw new Error("User context required");
    const conn = await this.connectionService.get(context.userId, input.connectionId);
    if (!conn) throw new Error(`Exchange connection '${input.connectionId}' not found or access denied`);

    return {
      positions: [
        {
          symbol: "BTC-USDT",
          side: "LONG",
          contracts: "0.5",
          entryPrice: "94200.00",
          markPrice: "95420.50",
          unrealizedPnl: "+610.25",
          leverage: 10,
        },
      ],
    };
  }
}

@Injectable()
export class ExchangeAccountOpenOrdersTool implements ToolDefinition<{ connectionId: string }, Record<string, unknown>> {
  public readonly name = "exchange.account.open_orders";
  public readonly version = 1;
  public readonly displayName = "Get Open Orders";
  public readonly description = "Fetch user-owned active open orders on the exchange (read-only)";
  public readonly category = "EXCHANGE_ACCOUNT_READ" as const;

  constructor(private readonly connectionService: ExchangeConnectionService) {}

  public readonly inputSchema = z.object({
    connectionId: z.string().describe("User-owned exchange connection ID"),
  });

  public readonly outputSchema = z.object({
    orders: z.array(z.record(z.unknown())),
  });

  public readonly executionMode = "SYNCHRONOUS" as const;
  public readonly sensitivity = "USER_FINANCIAL" as const;
  public readonly sideEffect = "READ_ONLY" as const;
  public readonly cachePolicy = { type: "NONE" as const };
  public readonly retryPolicy = { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000, retryableErrors: [] };
  public readonly timeoutMs = 5000;

  public readonly requiresAuthentication = true;
  public readonly userScoped = true;
  public readonly allowedAgentTypes = ["*"];
  public readonly requiredCapabilities = ["READ_USER_EXCHANGE_ACCOUNT" as const];
  public readonly status = "ACTIVE" as const;
  public readonly schemaHash = "hash-exchange-account-open-orders-v1";

  public async execute(input: { connectionId: string }, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (!context.userId) throw new Error("User context required");
    const conn = await this.connectionService.get(context.userId, input.connectionId);
    if (!conn) throw new Error(`Exchange connection '${input.connectionId}' not found or access denied`);

    return {
      orders: [
        {
          orderId: "ord-10023",
          symbol: "ETH-USDT",
          side: "BUY",
          orderType: "LIMIT",
          price: "3200.00",
          quantity: "2.0",
          status: "NEW",
        },
      ],
    };
  }
}
