import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface PostMortemResult {
  tradeId: string;
  symbol: string;
  decision: 'LONG' | 'SHORT';
  regime: string;
  lossReturnPct: number;
  rootCause: 'TRAP_ENTRY' | 'REGIME_MISMATCH' | 'TIMING_ERROR' | 'DATA_STALE' | 'AGENT_DISAGREEMENT' | 'UNKNOWN';
  agentAccuracy: Record<string, { vote: string; correct: boolean }>;
  recommendation: string;
  penaltyAdjustments: Partial<Record<string, number>>;
}

export interface RecurringPattern {
  pattern: string;
  symbol: string;
  regime: string;
  rootCause: string;
  count: number;
  lastOccurred: Date;
}

@Injectable()
export class PostMortemAnalyzerService {
  constructor(private readonly prisma: PrismaService) {}

  async analyzeFailedRun(params: {
    runId: string;
    userId: string;
    symbol: string;
    decision: string;
    outcome: string;
    returnPct: number;
    marketRegime?: string;
    storedContext?: any;
  }): Promise<PostMortemResult | null> {
    if (params.outcome !== 'WRONG') return null;

    const agentAccuracy: Record<string, { vote: string; correct: boolean }> = {};
    const penaltyAdjustments: Record<string, number> = {};
    let wrongVotes = 0;

    if (params.storedContext?.agentVotes) {
      for (const [agent, vote] of Object.entries(params.storedContext.agentVotes)) {
        const voteStr = vote as string;
        const votedWithSystem = voteStr === params.decision;
        const correct = !votedWithSystem && voteStr !== 'NEUTRAL';
        
        agentAccuracy[agent] = { vote: voteStr, correct };
        if (votedWithSystem) {
          wrongVotes++;
          // Assign -2 to -5 penalty. I'll use -3 as base.
          penaltyAdjustments[agent] = -3;
        }
      }
    }

    let rootCause: PostMortemResult['rootCause'] = 'UNKNOWN';
    if (wrongVotes >= 3) {
      rootCause = 'AGENT_DISAGREEMENT';
    } else if (params.storedContext?.isExtendedEntry || params.storedContext?.trapLikelihood > 0.7) {
      rootCause = 'TRAP_ENTRY';
    } else if (params.marketRegime === 'TRENDING' && params.storedContext?.actualRegime === 'RANGING') {
      rootCause = 'REGIME_MISMATCH';
    } else {
      rootCause = 'TIMING_ERROR';
    }

    const regime = params.marketRegime || 'UNKNOWN';
    const result: PostMortemResult = {
      tradeId: params.runId,
      symbol: params.symbol,
      decision: params.decision as 'LONG' | 'SHORT',
      regime,
      lossReturnPct: params.returnPct,
      rootCause,
      agentAccuracy,
      recommendation: `Detected ${rootCause} during ${regime} regime.`,
      penaltyAdjustments,
    };

    const key = `post_mortem:${params.runId}`;
    const existing = await this.prisma.aIMemory.findFirst({
      where: { userId: params.userId, key }
    });

    if (existing) {
      await this.prisma.aIMemory.update({
        where: { id: existing.id },
        data: {
          content: result as any,
          tags: ['post-mortem', params.symbol, result.regime, result.rootCause],
        }
      });
    } else {
      await this.prisma.aIMemory.create({
        data: {
          userId: params.userId,
          type: 'REFLECTION',
          key,
          content: result as any,
          tags: ['post-mortem', params.symbol, result.regime, result.rootCause],
        }
      });
    }

    return result;
  }

  async findRecurringPatterns(userId: string, lookbackDays: number = 7): Promise<RecurringPattern[]> {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const memories = await this.prisma.aIMemory.findMany({
      where: {
        userId,
        type: 'REFLECTION',
        tags: { has: 'post-mortem' },
        createdAt: { gte: since }
      }
    });

    const groups = new Map<string, RecurringPattern>();
    for (const mem of memories) {
      const content = mem.content as unknown as PostMortemResult;
      const key = `${content.symbol}:${content.regime}:${content.rootCause}`;
      
      if (!groups.has(key)) {
        groups.set(key, {
          pattern: key,
          symbol: content.symbol,
          regime: content.regime,
          rootCause: content.rootCause,
          count: 0,
          lastOccurred: mem.createdAt
        });
      }
      const group = groups.get(key)!;
      group.count++;
      if (mem.createdAt > group.lastOccurred) {
        group.lastOccurred = mem.createdAt;
      }
    }

    return Array.from(groups.values()).filter(g => g.count >= 2);
  }

  async getAgentPenalties(userId: string): Promise<Partial<Record<string, number>>> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const memories = await this.prisma.aIMemory.findMany({
      where: {
        userId,
        type: 'REFLECTION',
        tags: { has: 'post-mortem' },
        createdAt: { gte: since }
      }
    });

    const totalPenalties: Record<string, number> = {};
    for (const mem of memories) {
      const content = mem.content as unknown as PostMortemResult;
      if (content.penaltyAdjustments) {
        for (const [agent, penalty] of Object.entries(content.penaltyAdjustments)) {
          totalPenalties[agent] = (totalPenalties[agent] || 0) + (penalty as number);
        }
      }
    }

    for (const agent in totalPenalties) {
      if (totalPenalties[agent] < -15) {
        totalPenalties[agent] = -15;
      }
    }

    return totalPenalties;
  }
}
