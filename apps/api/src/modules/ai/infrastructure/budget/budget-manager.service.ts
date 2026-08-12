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
  requestCount: number;
  requestLimit: number;
  tokenCount: number;
  tokenLimit: number;
}

@Injectable()
export class BudgetManagerService {
  private readonly logger = new Logger(BudgetManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  public async checkBudget(userId?: string, estimatedCallCost = 0.01): Promise<BudgetCheckResult> {
    const targetUserId = userId || 'system';
    const config = await this.prisma.aIConfiguration.findUnique({
      where: { userId: targetUserId },
    });

    const dailyLimit = config ? Number(config.dailyBudget) : 10.0;
    const monthlyLimit = config ? Number(config.monthlyBudget) : 100.0;
    const requestLimit = config?.requestBudget ?? 1000;
    const tokenLimit = config?.tokenBudget ?? 10_000_000;

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayUsage = await this.prisma.aIUsage.findUnique({
      where: { userId_date: { userId: targetUserId, date: todayStr } },
    });

    const dailySpent = todayUsage ? Number(todayUsage.totalCost) : 0;
    const requestCount = todayUsage?.requestCount ?? 0;
    const tokenCount = todayUsage?.totalTokens ?? 0;

    // Sum monthly usage
    const monthPrefix = todayStr.slice(0, 7);
    const monthUsages = await this.prisma.aIUsage.findMany({
      where: {
        userId: targetUserId,
        date: { startsWith: monthPrefix },
      },
    });
    const monthlySpent = monthUsages.reduce(
      (sum, u) => sum + Number(u.totalCost),
      0
    );

    const common = {
      dailySpent,
      dailyLimit,
      monthlySpent,
      monthlyLimit,
      requestCount,
      requestLimit,
      tokenCount,
      tokenLimit,
    };

    if (requestCount >= requestLimit) {
      return {
        allowed: false,
        status: "BLOCK",
        reason: `Daily AI request budget exceeded (${requestCount} / ${requestLimit})`,
        ...common,
      };
    }

    if (tokenCount >= tokenLimit) {
      return {
        allowed: false,
        status: "BLOCK",
        reason: `Daily AI token budget exceeded (${tokenCount} / ${tokenLimit})`,
        ...common,
      };
    }

    if (dailySpent + estimatedCallCost > dailyLimit * 1.5) {
      return {
        allowed: false,
        status: "EMERGENCY_STOP",
        reason: `Emergency stop triggered: Daily cost ($${dailySpent.toFixed(2)}) severely exceeded daily limit ($${dailyLimit.toFixed(2)})`,
        ...common,
      };
    }

    if (dailySpent + estimatedCallCost > dailyLimit) {
      return {
        allowed: false,
        status: "BLOCK",
        reason: `Daily budget exceeded ($${dailySpent.toFixed(2)} / $${dailyLimit.toFixed(2)})`,
        ...common,
      };
    }

    if (monthlySpent + estimatedCallCost > monthlyLimit) {
      return {
        allowed: false,
        status: "BLOCK",
        reason: `Monthly budget exceeded ($${monthlySpent.toFixed(2)} / $${monthlyLimit.toFixed(2)})`,
        ...common,
      };
    }

    if (dailySpent > dailyLimit * 0.8 || monthlySpent > monthlyLimit * 0.8) {
      return {
        allowed: true,
        status: "WARN",
        reason: `Approaching budget limit (Daily: $${dailySpent.toFixed(2)}/$${dailyLimit.toFixed(2)})`,
        ...common,
      };
    }

    return {
      allowed: true,
      status: "OK",
      ...common,
    };
  }

  /** Atomically reserves one real provider attempt before it is sent. */
  public async reserveRequest(userId?: string): Promise<void> {
    const targetUserId = userId || 'system';
    const config = await this.prisma.aIConfiguration.findUnique({
      where: { userId: targetUserId },
      select: { requestBudget: true },
    });
    const requestLimit = config?.requestBudget ?? 1000;
    if (requestLimit <= 0) {
      throw Object.assign(
        new Error(`AI Request blocked by request budget policy: 0 / ${requestLimit}`),
        { code: "AI_REQUEST_BUDGET_EXCEEDED", providerRequestSent: false },
      );
    }

    const date = new Date().toISOString().slice(0, 10);
    const usage = await this.prisma.aIUsage.upsert({
      where: { userId_date: { userId: targetUserId, date } },
      create: { userId: targetUserId, date },
      update: {},
      select: { id: true },
    });
    const reserved = await this.prisma.aIUsage.updateMany({
      where: { id: usage.id, requestCount: { lt: requestLimit } },
      data: { requestCount: { increment: 1 } },
    });
    if (reserved.count !== 1) {
      throw Object.assign(
        new Error(`AI Request blocked by request budget policy: daily limit ${requestLimit} reached`),
        { code: "AI_REQUEST_BUDGET_EXCEEDED", providerRequestSent: false },
      );
    }
  }

  public async recordUsage(params: {
    userId?: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }): Promise<void> {
    const targetUserId = params.userId || 'system';
    const todayStr = new Date().toISOString().slice(0, 10);
    const totalTokens = params.promptTokens + params.completionTokens;

    await this.prisma.aIUsage.upsert({
      where: {
        userId_date: {
          userId: targetUserId,
          date: todayStr,
        },
      },
      create: {
        userId: targetUserId,
        date: todayStr,
        requestCount: 1,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens,
        totalCost: params.cost,
      },
      update: {
        promptTokens: { increment: params.promptTokens },
        completionTokens: { increment: params.completionTokens },
        totalTokens: { increment: totalTokens },
        totalCost: { increment: params.cost },
      },
    });
  }
}
