import { z } from "zod";

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string(),
  emailVerified: z.boolean(),
  totpEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const sessionViewSchema = z.object({
  id: z.string().uuid(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  lastActivity: z.string().datetime(),
  rememberMe: z.boolean(),
  current: z.boolean(),
});
export const credentialViewSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(["OPENAI", "BINANCE", "OKX", "NEWS_API", "CUSTOM"]),
  label: z.string().nullable(),
  status: z.string(),
  maskedKey: z.string().regex(/^••••.{4}$/u),
  lastVerified: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const settingsViewSchema = z.object({
  theme: z.enum(["dark", "light", "system"]),
  timezone: z.string(),
  preferredExchange: z.enum(["BINANCE", "OKX"]).nullable(),
  preferredSymbols: z.array(z.string()),
  preferredTimeframes: z.array(z.string()),
  aiDailyBudget: z.string(),
  defaultLeverage: z.number().int(),
  riskPreference: z.enum(["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]),
  maxRiskPerTrade: z.number().min(0.001).max(0.02),
  updatedAt: z.string().datetime(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
export type SessionView = z.infer<typeof sessionViewSchema>;
export type CredentialView = z.infer<typeof credentialViewSchema>;
export type SettingsView = z.infer<typeof settingsViewSchema>;
