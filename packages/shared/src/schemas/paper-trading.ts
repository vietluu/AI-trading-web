import { z } from "zod";

export const TradingModeSchema = z.enum(["SIGNAL_ONLY", "PAPER_TRADING"]);
export type TradingMode = z.infer<typeof TradingModeSchema>;
export const PositionSideSchema = z.enum(["LONG", "SHORT"]);
export const OrderSideSchema = z.enum(["BUY", "SELL"]);

export const PaperAccountSchema = z.object({
  id: z.string().uuid(),
  balance: z.number(),
  equity: z.number(),
  marginUsed: z.number(),
  createdAt: z.string().datetime(),
});
export type PaperAccount = z.infer<typeof PaperAccountSchema>;

export const PaperPositionSchema = z.object({
  symbol: z.string(),
  side: PositionSideSchema,
  size: z.number(),
  entryPrice: z.number(),
  markPrice: z.number(),
  leverage: z.number().int(),
  unrealizedPnL: z.number(),
  realizedPnL: z.number(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  openedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaperPosition = z.infer<typeof PaperPositionSchema>;

export const SimulatedOrderSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string(),
  side: OrderSideSchema,
  type: z.literal("MARKET"),
  quantity: z.number(),
  executedPrice: z.number(),
  slippagePct: z.number(),
  fee: z.number(),
  status: z.literal("FILLED"),
  createdAt: z.string().datetime(),
});
export type SimulatedOrder = z.infer<typeof SimulatedOrderSchema>;

export const PaperTradeSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string(),
  side: PositionSideSchema,
  entryPrice: z.number(),
  exitPrice: z.number(),
  size: z.number(),
  pnl: z.number(),
  fee: z.number(),
  returnPct: z.number(),
  closeReason: z.string(),
  durationMs: z.number(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime(),
});
export type PaperTrade = z.infer<typeof PaperTradeSchema>;

export const PaperMetricsSchema = z.object({
  totalTrades: z.number().int(),
  winRate: z.number(),
  averageReturn: z.number(),
  maxDrawdown: z.number(),
  profitFactor: z.number().nullable(),
  totalPnl: z.number(),
});
export type PaperMetrics = z.infer<typeof PaperMetricsSchema>;
