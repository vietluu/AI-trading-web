import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";

export interface BudgetCheckResult {
  allowed: boolean;
  status: "OK" | "WARN" | "BLOCK" | "EMERGENCY_STOP";
  reason?: string;
  dailySpent: number;
  dailyLimit: number;
  monthlySpent: number;
  monthlyLimit: number;
}

@Injectable()
export class BudgetManagerService {
  private readonly logger = new Logger(BudgetManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  public async checkBudget(userId: string, estimatedCallCost = 0.01): Promise<BudgetCheckResult> {
    const config = await this.prisma.aIConfiguration.findUnique({
      where: { userId },
    });

    const dailyLimit = config ? Number(config.dailyBudget) : 10.0;
    const monthlyLimit = config ? Number(config.monthlyBudget) : 100.0;

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayUsage = await this.prisma.aIUsage.findUnique({
      where: { userId_date: { userId, date: todayStr } },
    });

    const dailySpent = todayUsage ? Number(todayUsage.totalCost) : 0;

    // Sum monthly usage
    const monthPrefix = todayStr.slice(0, 7);
    const monthUsages = await this.prisma.aIUsage.findMany({
      where: {
        userId,
        date: { startsWith: monthPrefix },
      },
    });
    const monthlySpent = monthUsages.reduce(
      (sum, u) => sum + Number(u.totalCost),
      0
    );

    if (dailySpent + estimatedCallCost > dailyLimit * 1.5) {
      return {
        allowed: false,
        status: "EMERGENCY_STOP",
        reason: `Emergency stop triggered: Daily cost ($${dailySpent.toFixed(2)}) severely exceeded daily limit ($${dailyLimit.toFixed(2)})`,
        dailySpent,
        dailyLimit,
        monthlySpent,
        monthlyLimit,
      };
    }

    if (dailySpent + estimatedCallCost > dailyLimit) {
      return {
        allowed: false,
        status: "BLOCK",
        reason: `Daily budget exceeded ($${dailySpent.toFixed(2)} / $${dailyLimit.toFixed(2)})`,
        dailySpent,
        dailyLimit,
        monthlySpent,
        monthlyLimit,
      };
    }

    if (monthlySpent + estimatedCallCost > monthlyLimit) {
      return {
        allowed: false,
        status: "BLOCK",
        reason: `Monthly budget exceeded ($${monthlySpent.toFixed(2)} / $${monthlyLimit.toFixed(2)})`,
        dailySpent,
        dailyLimit,
        monthlySpent,
        monthlyLimit,
      };
    }

    if (dailySpent > dailyLimit * 0.8 || monthlySpent > monthlyLimit * 0.8) {
      return {
        allowed: true,
        status: "WARN",
        reason: `Approaching budget limit (Daily: $${dailySpent.toFixed(2)}/$${dailyLimit.toFixed(2)})`,
        dailySpent,
        dailyLimit,
        monthlySpent,
        monthlyLimit,
      };
    }

    return {
      allowed: true,
      status: "OK",
      dailySpent,
      dailyLimit,
      monthlySpent,
      monthlyLimit,
    };
  }

  public async recordUsage(params: {
    userId: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }): Promise<void> {
    const todayStr = new Date().toISOString().slice(0, 10);
    const totalTokens = params.promptTokens + params.completionTokens;

    await this.prisma.aIUsage.upsert({
      where: {
        userId_date: {
          userId: params.userId,
          date: todayStr,
        },
      },
      create: {
        userId: params.userId,
        date: todayStr,
        requestCount: 1,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens,
        totalCost: params.cost,
      },
      update: {
        requestCount: { increment: 1 },
        promptTokens: { increment: params.promptTokens },
        completionTokens: { increment: params.completionTokens },
        totalTokens: { increment: totalTokens },
        totalCost: { increment: params.cost },
      },
    });
  }
}
