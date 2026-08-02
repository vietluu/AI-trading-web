import { z } from "zod";

export const LiveOrderRequestSchema = z.object({
  connectionId: z.string().uuid(),
  riskAssessmentId: z.string().uuid(),
  clientOrderId: z.string().min(8).max(36).regex(/^[A-Za-z0-9_-]+$/),
});
export type LiveOrderRequest = z.infer<typeof LiveOrderRequestSchema>;

export const LiveCloseRequestSchema = z.object({
  connectionId: z.string().uuid(),
  riskAssessmentId: z.string().uuid(),
  symbol: z.string().regex(/^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/),
  clientOrderId: z.string().min(8).max(36).regex(/^[A-Za-z0-9_-]+$/),
});
export type LiveCloseRequest = z.infer<typeof LiveCloseRequestSchema>;

export const LiveExecutionSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().nullable(),
  clientOrderId: z.string(),
  provider: z.enum(["BINANCE_FUTURES", "OKX_FUTURES"]),
  environment: z.enum(["TESTNET", "DEMO", "PRODUCTION"]),
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  size: z.number(),
  price: z.number().nullable(),
  status: z.string(),
  purpose: z.enum(["OPEN", "CLOSE", "REVERSE", "STOP_LOSS", "TAKE_PROFIT"]),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LiveExecution = z.infer<typeof LiveExecutionSchema>;
