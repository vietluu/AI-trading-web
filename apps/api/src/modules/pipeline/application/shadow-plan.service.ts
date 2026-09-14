import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '@prisma/client';
import { evaluateShadowPlan, type ShadowCandle } from '../domain/shadow-fill-engine';

export interface CreateShadowPlanInput {
  evaluationKey: string;
  symbol: string;
  provider: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  setup: string;
  cohortKey: string;
  entryPrice: number;
  stopLoss: number;
  targets: Array<{ price: number; fraction: number }>;
  expiresAt: string | Date;
  sourceDataCutoff: string | Date;
  feeBps: number;
  slippageBps: number;
  fundingBps: number;
  configurationHash: string;
  quantity?: number;
  riskFraction?: number;
  status?: string;
}

export interface FinalizeShadowPlanInput {
  id?: string;
  evaluationKey?: string;
  status: 'FILLED' | 'EXPIRED' | 'STOPPED' | 'TARGET_REACHED' | 'CANCELLED';
  grossPnl: number;
  netPnl: number;
  netR: number;
  mfe: number;
  mae: number;
  durationCandles: number;
  terminalReason: string;
  isComplete: boolean;
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class ShadowPlanService {
  private readonly logger = new Logger(ShadowPlanService.name);

  constructor(private readonly prisma: PrismaService) {}

  public async createPlan(input: CreateShadowPlanInput) {
    this.validatePlanInput(input);

    try {
      return await this.prisma.shadowExecutionPlan.create({
        data: {
          evaluationKey: input.evaluationKey,
          symbol: input.symbol,
          provider: input.provider,
          timeframe: input.timeframe,
          direction: input.direction,
          setup: input.setup,
          cohortKey: input.cohortKey,
          status: input.status ?? 'PENDING',
          entryPrice: input.entryPrice,
          stopLoss: input.stopLoss,
          targets: input.targets as unknown as Prisma.InputJsonValue,
          quantity: input.quantity ?? null,
          riskFraction: input.riskFraction ?? null,
          sourceDataCutoff: new Date(input.sourceDataCutoff),
          expiresAt: new Date(input.expiresAt),
          feeBps: input.feeBps,
          slippageBps: input.slippageBps,
          fundingBps: input.fundingBps,
          configurationHash: input.configurationHash,
        },
      });
    } catch (error) {
      if (isPrismaUniqueConflict(error)) {
        const existing = await this.prisma.shadowExecutionPlan.findUnique({
          where: { evaluationKey: input.evaluationKey },
        });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  public async finalizePlan(input: FinalizeShadowPlanInput) {
    if (!input.id && !input.evaluationKey) {
      throw new Error('Either id or evaluationKey is required to finalize shadow plan');
    }

    const where = input.id ? { id: input.id } : { evaluationKey: input.evaluationKey! };
    const existing = await this.prisma.shadowExecutionPlan.findUnique({ where });
    if (!existing) {
      throw new Error(`Shadow execution plan not found for finalization: ${JSON.stringify(where)}`);
    }

    return await this.prisma.shadowExecutionPlan.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        grossPnl: input.grossPnl,
        netPnl: input.netPnl,
        netR: input.netR,
        mfe: input.mfe,
        mae: input.mae,
        durationCandles: input.durationCandles,
        terminalReason: input.terminalReason,
        isComplete: input.isComplete,
      },
    });
  }

  public async getPlan(where: { id?: string; evaluationKey?: string }) {
    if (!where.id && !where.evaluationKey) return null;
    return await this.prisma.shadowExecutionPlan.findUnique({
      where: where.id ? { id: where.id } : { evaluationKey: where.evaluationKey! },
    });
  }

  public async evaluateAndFinalizePlan(where: { id?: string; evaluationKey?: string }, candles: ShadowCandle[]) {
    const plan = await this.getPlan(where);
    if (!plan) {
      throw new Error(`Shadow execution plan not found: ${JSON.stringify(where)}`);
    }
    const outcome = evaluateShadowPlan(
      {
        id: plan.id,
        evaluationKey: plan.evaluationKey,
        symbol: plan.symbol,
        direction: plan.direction as 'LONG' | 'SHORT',
        entryPrice: Number(plan.entryPrice),
        stopLoss: Number(plan.stopLoss),
        targets: plan.targets as any,
        expiresAt: plan.expiresAt,
        sourceDataCutoff: plan.sourceDataCutoff,
        feeBps: Number(plan.feeBps),
        slippageBps: Number(plan.slippageBps),
        fundingBps: Number(plan.fundingBps),
        quantity: plan.quantity ? Number(plan.quantity) : 1,
        riskFraction: plan.riskFraction ? Number(plan.riskFraction) : undefined,
      },
      candles,
    );
    return await this.finalizePlan({
      id: plan.id,
      status: outcome.status,
      grossPnl: outcome.grossPnl,
      netPnl: outcome.netPnl,
      netR: outcome.netR,
      mfe: outcome.mfe,
      mae: outcome.mae,
      durationCandles: outcome.durationCandles,
      terminalReason: outcome.terminalReason,
      isComplete: outcome.isComplete,
    });
  }

  private validatePlanInput(input: CreateShadowPlanInput) {
    if (!input.evaluationKey || typeof input.evaluationKey !== 'string') {
      throw new Error('Valid evaluationKey is required');
    }
    if (!input.cohortKey || typeof input.cohortKey !== 'string') {
      throw new Error('Valid cohortKey is required');
    }
    if (!input.configurationHash || typeof input.configurationHash !== 'string') {
      throw new Error('Valid configurationHash is required');
    }
    if (!input.symbol || !input.provider || !input.timeframe) {
      throw new Error('symbol, provider, and timeframe are required');
    }
    if (input.direction !== 'LONG' && input.direction !== 'SHORT') {
      throw new Error(`Invalid direction: ${input.direction}`);
    }
    if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
      throw new Error(`Invalid entryPrice: ${input.entryPrice}`);
    }
    if (!Number.isFinite(input.stopLoss) || input.stopLoss <= 0) {
      throw new Error(`Invalid stopLoss: ${input.stopLoss}`);
    }
    if (!Array.isArray(input.targets) || input.targets.length === 0) {
      throw new Error('targets must be a non-empty array');
    }
    for (const t of input.targets) {
      if (!Number.isFinite(t.price) || t.price <= 0 || !Number.isFinite(t.fraction) || t.fraction <= 0) {
        throw new Error(`Invalid target: ${JSON.stringify(t)}`);
      }
    }
    if (input.direction === 'LONG') {
      if (input.stopLoss >= input.entryPrice) {
        throw new Error('LONG stopLoss must be strictly less than entryPrice');
      }
      if (input.targets.some((t) => t.price <= input.entryPrice)) {
        throw new Error('LONG targets must be strictly greater than entryPrice');
      }
    } else {
      if (input.stopLoss <= input.entryPrice) {
        throw new Error('SHORT stopLoss must be strictly greater than entryPrice');
      }
      if (input.targets.some((t) => t.price >= input.entryPrice)) {
        throw new Error('SHORT targets must be strictly less than entryPrice');
      }
    }
    if (!input.expiresAt || isNaN(Date.parse(String(input.expiresAt)))) {
      throw new Error('Valid expiresAt is required');
    }
    if (!input.sourceDataCutoff || isNaN(Date.parse(String(input.sourceDataCutoff)))) {
      throw new Error('Valid sourceDataCutoff is required');
    }
    if (
      !Number.isFinite(input.feeBps) || input.feeBps < 0 ||
      !Number.isFinite(input.slippageBps) || input.slippageBps < 0 ||
      !Number.isFinite(input.fundingBps) || input.fundingBps < 0
    ) {
      throw new Error('Valid non-negative costs (feeBps, slippageBps, fundingBps) are required');
    }
  }
}
