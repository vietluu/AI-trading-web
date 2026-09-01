import { describe, expect, it, vi } from "vitest";
import { BudgetManagerService } from "../src/modules/ai/infrastructure/budget/budget-manager.service";
import type { PrismaService } from "../src/database/prisma.service";

const makePrisma = (tokenBudget: number, totalTokens: number) => ({
  aIConfiguration: {
    findUnique: vi.fn().mockResolvedValue({
      dailyBudget: 100,
      monthlyBudget: 1000,
      requestBudget: 5000,
      tokenBudget,
    }),
  },
  aIUsage: {
    findUnique: vi.fn().mockResolvedValue({ totalCost: 0.1, requestCount: 5, totalTokens }),
    findMany: vi.fn().mockResolvedValue([{ totalCost: 0.1 }]),
  },
});

describe("BudgetManagerService token limit", () => {
  it("should WARN at 80% token usage", async () => {
    const svc = new BudgetManagerService(makePrisma(10000, 8500) as unknown as PrismaService);
    const result = await svc.checkBudget("u1");
    expect(result.status).toBe("WARN");
    expect(result.allowed).toBe(true);
  });

  it("should BLOCK when token usage >= limit", async () => {
    const svc = new BudgetManagerService(makePrisma(10000, 10000) as unknown as PrismaService);
    const result = await svc.checkBudget("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("BLOCK");
  });

  it("should allow when tokenBudget=0 (disabled)", async () => {
    const svc = new BudgetManagerService(makePrisma(0, 999999) as unknown as PrismaService);
    const result = await svc.checkBudget("u1");
    expect(result.allowed).toBe(true);
  });
});
