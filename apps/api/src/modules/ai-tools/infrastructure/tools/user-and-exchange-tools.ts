import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ToolDefinition } from "../../domain/contracts/tool-definition.contract";
import type { ToolExecutionContext } from "../../domain/contracts/tool-context.contract";
import { ExchangeConnectionService } from "../../../../exchange/application/exchange-connection.service";
import { AIConfigService } from "../../../ai/infrastructure/config/ai-config.service";
import { PrismaService } from "../../../../database/prisma.service";

@Injectable()
export class UserSettingsGetTool implements ToolDefinition<Record<string, unknown>, Record<string, unknown>> {
  constructor(private readonly prisma: PrismaService) {}

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
    preferredSymbols: z.array(z.string()),
    preferredTimeframes: z.array(z.string()),
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
    const setting = await this.prisma.userSetting.findUnique({ where: { userId: context.userId } });
    return {
      userId: context.userId,
      theme: setting?.theme ?? "dark",
      timezone: setting?.timezone ?? "UTC",
      defaultTimeframe: setting?.preferredTimeframes[0] ?? "",
      preferredSymbols: setting?.preferredSymbols ?? [],
      preferredTimeframes: setting?.preferredTimeframes ?? [],
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
    const conn = await this.connectionService.get(context.userId, input.connectionId);
    if (!conn) throw new Error(`Exchange connection '${input.connectionId}' not found or access denied`);
    const account = await this.connectionService.account(context.userId, input.connectionId, {});

    return {
      connectionId: conn.id,
      provider: conn.provider,
      totalWalletBalance: account.totalEquity,
      totalUnrealizedPnl: account.totalUnrealizedPnl,
      totalMarginBalance: account.totalMarginBalance,
      availableBalance: account.availableBalance,
      updatedAt: account.updatedAt.toISOString(),
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
    const balances = await this.connectionService.balances(context.userId, input.connectionId, {});
    return { balances: balances.map((balance) => ({
      provider: balance.provider,
      asset: balance.asset,
      walletBalance: balance.total,
      availableBalance: balance.available,
      locked: balance.locked,
      unrealizedPnl: balance.unrealizedPnl,
      marginBalance: balance.marginBalance,
    })) };
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
    const positions = await this.connectionService.positions(context.userId, input.connectionId, {});
    return { positions: positions.map((position) => ({
      provider: position.provider,
      symbol: position.symbol,
      side: position.side,
      positionMode: position.positionMode,
      contracts: position.quantity,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice,
      liquidationPrice: position.liquidationPrice,
      unrealizedPnl: position.unrealizedPnl,
      realizedPnl: position.realizedPnl,
      leverage: position.leverage,
      updatedAt: position.updatedAt.toISOString(),
    })) };
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
    const orders = await this.connectionService.openOrders(context.userId, input.connectionId, {});
    return { orders: orders.map((order) => ({
      provider: order.provider,
      orderId: order.exchangeOrderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      price: order.price,
      averagePrice: order.averagePrice,
      quantity: order.originalQuantity,
      executedQuantity: order.executedQuantity,
      status: order.status,
      reduceOnly: order.reduceOnly,
      updatedAt: order.updatedAt?.toISOString(),
    })) };
  }
}
