import { z } from "zod";

export const exchangeProviderSchema = z.enum([
  "BINANCE_FUTURES",
  "OKX_FUTURES",
]);
export const exchangeEnvironmentSchema = z.enum([
  "TESTNET",
  "DEMO",
  "PRODUCTION",
]);
const dateTimeSchema = z.string().datetime().or(z.date());

export const exchangeConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: exchangeProviderSchema,
  environment: exchangeEnvironmentSchema,
  displayName: z.string().nullable(),
  isEnabled: z.boolean(),
  isVerified: z.boolean(),
  verifiedAt: dateTimeSchema.nullable(),
  permissions: z.unknown().nullable(),
  maskedApiKey: z.string(),
  secretConfigured: z.literal(true),
  passphraseConfigured: z.boolean(),
  lastErrorCode: z.string().nullable(),
  lastErrorAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const exchangeAccountSummarySchema = z.object({
  provider: exchangeProviderSchema,
  totalEquity: z.string(),
  availableBalance: z.string(),
  totalUnrealizedPnl: z.string(),
  totalMarginBalance: z.string(),
  canTrade: z.boolean(),
  updatedAt: dateTimeSchema,
});

export const exchangeBalanceSchema = z.object({
  provider: exchangeProviderSchema,
  asset: z.string(),
  total: z.string(),
  available: z.string(),
  locked: z.string().optional(),
  unrealizedPnl: z.string().optional(),
  marginBalance: z.string().optional(),
});

export const exchangePositionSchema = z.object({
  provider: exchangeProviderSchema,
  symbol: z.string(),
  side: z.enum(["LONG", "SHORT", "BOTH"]),
  positionMode: z.enum(["ONE_WAY", "HEDGE"]),
  quantity: z.string(),
  entryPrice: z.string(),
  markPrice: z.string().optional(),
  liquidationPrice: z.string().optional(),
  leverage: z.string().optional(),
  marginType: z.enum(["CROSS", "ISOLATED"]).optional(),
  margin: z.string().optional(),
  unrealizedPnl: z.string(),
  realizedPnl: z.string().optional(),
  notional: z.string().optional(),
  updatedAt: dateTimeSchema,
});

export const exchangeOrderSchema = z.object({
  provider: exchangeProviderSchema,
  symbol: z.string(),
  exchangeOrderId: z.string(),
  clientOrderId: z.string().optional(),
  side: z.enum(["BUY", "SELL"]),
  type: z.string(),
  status: z.string(),
  timeInForce: z.string().optional(),
  price: z.string().optional(),
  stopPrice: z.string().optional(),
  averagePrice: z.string().optional(),
  originalQuantity: z.string(),
  executedQuantity: z.string(),
  reduceOnly: z.boolean().optional(),
  positionSide: z.enum(["LONG", "SHORT", "BOTH"]).optional(),
  createdAt: dateTimeSchema.optional(),
  updatedAt: dateTimeSchema.optional(),
});

export const exchangeConnectionTestSchema = z.object({
  success: z.boolean(),
  provider: exchangeProviderSchema,
  environment: exchangeEnvironmentSchema,
  permissions: z
    .object({
      accountRead: z.boolean(),
      balanceRead: z.boolean(),
      positionRead: z.boolean(),
      orderRead: z.boolean(),
      trading: z.boolean().optional(),
      withdrawal: z.boolean().optional(),
    })
    .optional(),
  accountIdentifierMasked: z.string().optional(),
  serverTime: dateTimeSchema.optional(),
  latencyMs: z.number().nonnegative().optional(),
  errorCode: z.string().optional(),
  message: z.string().optional(),
});

export type ExchangeConnection = z.infer<typeof exchangeConnectionSchema>;
export type ExchangeAccountSummary = z.infer<
  typeof exchangeAccountSummarySchema
>;
export type ExchangeBalance = z.infer<typeof exchangeBalanceSchema>;
export type ExchangePosition = z.infer<typeof exchangePositionSchema>;
export type ExchangeOrder = z.infer<typeof exchangeOrderSchema>;
export type ExchangeConnectionTest = z.infer<
  typeof exchangeConnectionTestSchema
>;
