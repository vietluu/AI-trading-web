import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../src/audit/audit.service";
import type { SettingsRepository } from "../src/settings/settings.repository";
import { SettingsService } from "../src/settings/settings.service";

describe("SettingsService", () => {
  it("returns decimal values as transport-safe strings and audits updates", async () => {
    const setting = {
      id: "setting-id",
      userId: "user-id",
      theme: "dark",
      timezone: "UTC",
      preferredExchange: "BINANCE",
      preferredSymbols: ["BTCUSDT"],
      preferredTimeframes: ["1h"],
      aiDailyBudget: new Prisma.Decimal(5),
      paperTradingBalance: new Prisma.Decimal(10000),
      defaultLeverage: 2,
      riskPreference: "CONSERVATIVE",
      maxRiskPerTrade: new Prisma.Decimal(0.02),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const repository = {
      getOrCreate: vi.fn().mockResolvedValue(setting),
      update: vi.fn().mockResolvedValue(setting),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new SettingsService(
      repository as unknown as SettingsRepository,
      audit as unknown as AuditService,
    );
    const result = await service.update("user-id", { theme: "dark" }, {});
    expect(result.aiDailyBudget).toBe("5");
    expect(result.maxRiskPerTrade).toBe(0.02);
    expect(audit.record).toHaveBeenCalledWith(
      "SETTINGS_UPDATE",
      "user-id",
      {},
      { fields: ["theme"] },
    );
  });
});
