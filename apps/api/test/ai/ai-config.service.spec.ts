import { describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { AIConfigService } from "../../src/modules/ai/infrastructure/config/ai-config.service";
import type { PrismaService } from "../../src/database/prisma.service";

const existingConfig = {
  id: "config-1",
  userId: "user-1",
  preferredProvider: "GEMINI" as const,
  preferredModel: "gemini-3.1-flash-lite",
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 30_000,
  dailyBudget: 10,
  monthlyBudget: 100,
  tokenBudget: 0,
  requestBudget: 5_000,
  fallbackEnabled: false,
  fallbackProviders: [],
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

describe("AIConfigService", () => {
  it("preserves an explicit Gemini-only configuration", async () => {
    const update = vi.fn();
    const service = new AIConfigService(
      {
        aIConfiguration: {
          findUnique: vi.fn().mockResolvedValue(existingConfig),
          update,
        },
      } as unknown as PrismaService,
      { get: vi.fn() } as unknown as ConfigService,
    );

    await expect(service.getOrCreateConfig("user-1")).resolves.toBe(
      existingConfig,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("creates new users in Gemini-only mode by default", async () => {
    const create = vi
      .fn()
      .mockImplementation(({ data }) => Promise.resolve(data));
    const service = new AIConfigService(
      {
        aIConfiguration: {
          findUnique: vi.fn().mockResolvedValue(null),
          create,
        },
      } as unknown as PrismaService,
      {
        get: vi.fn((key: string) =>
          key === "DEFAULT_PROVIDER" ? "GEMINI" : undefined,
        ),
      } as unknown as ConfigService,
    );

    const created = await service.getOrCreateConfig("user-1");

    expect(created).toMatchObject({
      preferredProvider: "GEMINI",
      fallbackEnabled: false,
      fallbackProviders: [],
    });
  });
});
