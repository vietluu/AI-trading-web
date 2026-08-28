import { describe, expect, it, vi, beforeEach } from "vitest";
import { BudgetManagerService } from "../../src/modules/ai/infrastructure/budget/budget-manager.service";
import type { PrismaService } from "../../src/database/prisma.service";

describe("AI Budget Manager & Spend Caps ($10/day, $100/month)", () => {
  let budgetManager: BudgetManagerService;
  let prismaMock: {
    aIConfiguration: { findUnique: ReturnType<typeof vi.fn> };
    aIUsage: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prismaMock = {
      aIConfiguration: {
        findUnique: vi.fn().mockResolvedValue(null), // Defaults to 10.0 daily, 100.0 monthly
      },
      aIUsage: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: "usage-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    budgetManager = new BudgetManagerService(prismaMock as unknown as PrismaService);
  });

  it("allows execution when daily and monthly spend are within default limits ($10/day, $100/mo)", async () => {
    const result = await budgetManager.checkBudget("user-1", 0.05);

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("OK");
    expect(result.dailyLimit).toBe(10.0);
    expect(result.monthlyLimit).toBe(100.0);
  });

  it("blocks execution when daily spend exceeds $10.00", async () => {
    prismaMock.aIUsage.findUnique.mockResolvedValueOnce({
      totalCost: 10.05,
      requestCount: 50,
      totalTokens: 50000,
    });

    const result = await budgetManager.checkBudget("user-1", 0.05);

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("BLOCK");
    expect(result.reason).toContain("Daily budget exceeded");
  });

  it("blocks execution when monthly spend exceeds $100.00", async () => {
    prismaMock.aIUsage.findUnique.mockResolvedValueOnce({
      totalCost: 5.0,
      requestCount: 20,
      totalTokens: 20000,
    });
    prismaMock.aIUsage.findMany.mockResolvedValueOnce([
      { totalCost: 50.0 },
      { totalCost: 51.0 },
    ]);

    const result = await budgetManager.checkBudget("user-1", 0.05);

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("BLOCK");
    expect(result.reason).toContain("Monthly budget exceeded");
  });

  it("triggers EMERGENCY_STOP when daily spend severely exceeds limit (> 150%)", async () => {
    prismaMock.aIUsage.findUnique.mockResolvedValueOnce({
      totalCost: 16.0,
      requestCount: 100,
      totalTokens: 100000,
    });

    const result = await budgetManager.checkBudget("user-1", 0.05);

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("EMERGENCY_STOP");
    expect(result.reason).toContain("Emergency stop triggered");
  });
});
