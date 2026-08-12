import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  FusionInputSchema,
  FusionOutputSchema,
  FusionRunInputSchema,
  MacroAgentOutputSchema,
  MarketAgentOutputSchema,
  NewsAgentOutputSchema,
  OnChainAgentOutputSchema,
  SentimentAgentOutputSchema,
  TechnicalAgentOutputSchema,
  type AgentDataQuality,
  type FusionInput,
  type FusionOutput,
  type FusionRunInput,
} from '@platform/shared';
import { randomUUID } from 'node:crypto';
import { AgentInvocationSource, AgentType } from '../../domain/enums';
import { canonicalSymbol } from '../../../../exchange/infrastructure/exchange-symbol';
import { AgentExecutionService } from './agent-execution.service';

type AnalysisName = keyof FusionInput;
type AnalysisBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface RunFusionOptions {
  input: FusionRunInput;
  userId?: string;
  sessionId?: string;
  invocationSource: AgentInvocationSource;
  correlationId?: string;
}

export interface FusionAnalysisResult {
  analyses: FusionInput;
  fusionOutput: FusionOutput;
}

export function deriveAssetSymbol(symbol: string): string {
  const canonical = canonicalSymbol(symbol);
  const [baseAsset] = canonical.split('-');
  if (!baseAsset) throw new Error('SYMBOL_REQUIRED: fusion analysis requires an explicit BASE-QUOTE symbol');
  return baseAsset;
}

import { RedisService } from '../../../../redis/redis.service';
import { PrismaService } from '../../../../database/prisma.service';

const ANALYSIS_TTL_SECONDS: Record<AnalysisName, number> = {
  market: 30,
  technical: 30,
  news: 300,
  sentiment: 300,
  macro: 900,
  onchain: 300,
};
const ANALYSIS_LOCK_TTL_SECONDS = 45;
const ANALYSIS_LOCK_WAIT_MS = 35_000;
const ANALYSIS_LOCK_POLL_MS = 100;

@Injectable()
export class FusionService {
  private readonly inFlightAnalyses = new Map<string, Promise<unknown>>();

  constructor(
    private readonly agentExecutionService: AgentExecutionService,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  private analysisCacheKey(
    name: AnalysisName,
    input: FusionRunInput,
    assetSymbol: string,
    userId?: string,
  ): string {
    const userScope = userId ?? 'public';
    if (name === 'macro') {
      return `fusion:analysis:${userScope}:macro:market-wide:lh${input.lookbackHours}`;
    }
    if (name === 'news' || name === 'sentiment' || name === 'onchain') {
      return `fusion:analysis:${userScope}:${name}:${assetSymbol}:lh${input.lookbackHours}:mi${input.maxItems}`;
    }
    return `fusion:analysis:${userScope}:${name}:${input.provider}:${input.symbol}:${input.interval}:lc${input.lookbackCandles}`;
  }

  private async getAnalysisCache<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private async setAnalysisCache(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setWithTtl(key, JSON.stringify(value), ttlSeconds);
    } catch {
      // Cache write failures must never break the pipeline
    }
  }

  private async rememberAnalysis<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.getAnalysisCache<T>(key);
    if (cached !== null) return cached;

    const existing = this.inFlightAnalyses.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = this.loadWithDistributedLock(key, ttlSeconds, load);
    this.inFlightAnalyses.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlightAnalyses.get(key) === pending) {
        this.inFlightAnalyses.delete(key);
      }
    }
  }

  private async loadWithDistributedLock<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!this.redis) return load();

    const lockKey = `${key}:lock`;
    const token = randomUUID();
    const deadline = Date.now() + ANALYSIS_LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      const cached = await this.getAnalysisCache<T>(key);
      if (cached !== null) return cached;

      let acquired = false;
      try {
        acquired = await this.redis.setNx(
          lockKey,
          token,
          ANALYSIS_LOCK_TTL_SECONDS,
        );
      } catch {
        // Redis is an optimization; an outage must not break analysis.
        const value = await load();
        await this.setAnalysisCache(key, value, ttlSeconds);
        return value;
      }
      if (acquired) {
        try {
          const value = await load();
          await this.setAnalysisCache(key, value, ttlSeconds);
          return value;
        } finally {
          await this.redis.compareAndDelete(lockKey, token).catch(() => false);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, ANALYSIS_LOCK_POLL_MS));
    }

    const value = await load();
    await this.setAnalysisCache(key, value, ttlSeconds);
    return value;
  }

  public async run(options: RunFusionOptions): Promise<FusionOutput> {
    return (await this.runDetailed(options)).fusionOutput;
  }

  public async runDetailed(
    options: RunFusionOptions,
  ): Promise<FusionAnalysisResult> {
    const input = FusionRunInputSchema.parse(options.input);
    const correlationId = options.correlationId ?? randomUUID();
    const assetSymbol = deriveAssetSymbol(input.symbol);
    const common = {
      userId: options.userId,
      sessionId: options.sessionId,
      invocationSource: options.invocationSource,
      correlationId,
    };
    const macroEvidenceAvailable = await this.hasImportedMacroEvidence(
      input.lookbackHours,
    );

    const requests = [
      {
        name: 'market' as const,
        agentType: AgentType.MARKET_ANALYST,
        input: {
          symbol: input.symbol,
          provider: input.provider,
          interval: input.interval,
          lookbackCandles: input.lookbackCandles,
        },
        schema: MarketAgentOutputSchema,
      },
      {
        name: 'technical' as const,
        agentType: AgentType.TECHNICAL_ANALYST,
        input: {
          symbol: input.symbol,
          provider: input.provider,
          interval: input.interval,
          lookbackCandles: input.lookbackCandles,
        },
        schema: TechnicalAgentOutputSchema,
      },
      {
        name: 'news' as const,
        agentType: AgentType.NEWS_ANALYST,
        input: {
          symbol: assetSymbol,
          lookbackHours: input.lookbackHours,
          maxItems: input.maxItems,
        },
        schema: NewsAgentOutputSchema,
      },
      {
        name: 'sentiment' as const,
        agentType: AgentType.SENTIMENT_ANALYST,
        input: {
          symbol: assetSymbol,
          lookbackHours: input.lookbackHours,
          maxItems: input.maxItems,
        },
        schema: SentimentAgentOutputSchema,
      },
      {
        name: 'macro' as const,
        agentType: AgentType.MACRO_ANALYST,
        input: { lookbackHours: input.lookbackHours },
        schema: MacroAgentOutputSchema,
      },
      {
        name: 'onchain' as const,
        agentType: AgentType.ON_CHAIN_ANALYST,
        input: { symbol: assetSymbol, lookbackHours: input.lookbackHours },
        schema: OnChainAgentOutputSchema,
      },
    ];

    const analyses: Partial<FusionInput> = {};
    const results = await Promise.allSettled(
      requests.map(async (request) => {
        if (request.name === 'macro' && !macroEvidenceAvailable) {
          return {
            name: request.name,
            data: this.unavailableMacroImportAnalysis(),
          };
        }
        const cacheKey = this.analysisCacheKey(
          request.name,
          input,
          assetSymbol,
          options.userId,
        );
        const data = await this.rememberAnalysis(
          cacheKey,
          ANALYSIS_TTL_SECONDS[request.name],
          async () => {
            const run = await this.agentExecutionService.executeSync({
              ...common,
              agentType: request.agentType,
              input: request.input,
            });
            const parsed = request.schema.safeParse(run.output);
            if (!parsed.success) throw new Error(`Invalid output from ${request.name}`);
            return parsed.data;
          },
        );
        const parsed = request.schema.safeParse(data);
        if (!parsed.success) throw new Error(`Invalid cached output from ${request.name}`);
        return {
          name: request.name,
          data: this.normalizeValidObservation(request.name, parsed.data),
        };
      })
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const request = requests[i]!;
      if (result.status === 'fulfilled') {
        Object.assign(analyses, { [result.value.name]: result.value.data });
      } else {
        Object.assign(analyses, {
          [request.name]: this.unavailableAnalysis(request.name),
        });
      }
    }

    const parsedAnalyses = FusionInputSchema.parse(analyses);
    return {
      analyses: parsedAnalyses,
      fusionOutput: this.fuse(parsedAnalyses),
    };
  }

  public fuse(rawInput: FusionInput): FusionOutput {
    const input = FusionInputSchema.parse(rawInput);
    const votes: Record<AnalysisName, AnalysisBias> = {
      market: this.marketBias(input),
      technical: this.technicalBias(input),
      news: this.newsBias(input),
      sentiment: input.sentiment.sentiment.overall,
      macro:
        input.macro.macroTrend === 'RISK_ON'
          ? 'BULLISH'
          : input.macro.macroTrend === 'RISK_OFF'
            ? 'BEARISH'
            : 'NEUTRAL',
      onchain: this.onChainBias(input),
    };
    const qualities: Record<AnalysisName, AgentDataQuality> = {
      market: input.market.dataQuality,
      technical: input.technical.dataQuality,
      news: input.news.dataQuality,
      sentiment: input.sentiment.dataQuality,
      macro: input.macro.dataQuality,
      onchain: input.onchain.dataQuality,
    };
    const onChainConfigured = !input.onchain.signals.some((signal) =>
      /no verified on-chain (?:provider|analysis)|coin metrics returned no verified coverage/i.test(signal),
    );
    const macroConfigured = !/no imported macro data/i.test(input.macro.summary);
    const expectedNames = (Object.keys(votes) as AnalysisName[]).filter(
      (name) =>
        (name !== 'onchain' || onChainConfigured) &&
        (name !== 'macro' || macroConfigured),
    );
    const usableNames = expectedNames.filter(
      (name) => qualities[name] !== 'INSUFFICIENT',
    );
    const counts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    usableNames.forEach((name) => counts[votes[name]]++);

    const overallBias: AnalysisBias =
      counts.BULLISH > usableNames.length / 2
        ? 'BULLISH'
        : counts.BEARISH > usableNames.length / 2
          ? 'BEARISH'
          : 'NEUTRAL';
    const agreement = Math.max(
      counts.BULLISH,
      counts.BEARISH,
      counts.NEUTRAL,
    );
    const confidence = Math.round(
      (agreement / Math.max(expectedNames.length, 1)) * 100,
    );
    const dataQuality: AgentDataQuality = expectedNames.every(
      (name) => qualities[name] === 'GOOD',
    )
      ? 'GOOD'
      : expectedNames.every(
            (name) => qualities[name] === 'INSUFFICIENT',
          )
        ? 'INSUFFICIENT'
        : 'PARTIAL';
    const conflicts = this.describeConflicts(votes, usableNames);

    return FusionOutputSchema.parse({
      summary: `Unified analysis is ${overallBias.toLowerCase()} with ${confidence}% cross-agent agreement confidence.`,
      combinedAnalysis: {
        market: input.market.summary,
        technical: input.technical.summary,
        news: input.news.summary,
        sentiment: input.sentiment.summary,
        macro: input.macro.summary,
        onchain: input.onchain.summary,
      },
      overallBias,
      confidence,
      conflicts,
      dataQuality,
      generatedAt: new Date().toISOString(),
    });
  }

  private normalizeValidObservation(
    name: AnalysisName,
    value: unknown,
  ): unknown {
    if (name !== 'news') return value;

    const news = NewsAgentOutputSchema.parse(value);
    const verifiedEmptyObservation =
      news.dataQuality === 'INSUFFICIENT' &&
      news.usedTools.includes('news.articles.list') &&
      news.usedTools.includes('news.high_importance.list') &&
      news.keyEvents.length === 0 &&
      news.riskSignals.length === 0 &&
      /no recent news|no .*articles|no .*events .*identified|no material news/i.test(
        news.summary,
      );

    // Successful sources returning zero matching events is evidence of a
    // neutral news state, not an agent outage. Keep it PARTIAL so absence of
    // news can participate without inflating confidence.
    return verifiedEmptyObservation
      ? { ...news, dataQuality: 'PARTIAL' as const }
      : news;
  }

  private async hasImportedMacroEvidence(lookbackHours: number): Promise<boolean> {
    if (!this.prisma) return true;
    const windowMs = lookbackHours * 60 * 60_000;
    const now = Date.now();
    try {
      return (await this.prisma.macroEconomicEvent.count({
        where: {
          scheduledAt: {
            gte: new Date(now - windowMs),
            lte: new Date(now + windowMs),
          },
        },
      })) > 0;
    } catch {
      return false;
    }
  }

  private unavailableMacroImportAnalysis(): FusionInput['macro'] {
    return {
      summary: 'Macro analysis omitted because no imported macro data covers the active window.',
      macroTrend: 'NEUTRAL',
      keyEvents: [],
      riskFactors: ['No imported macro data is available for this analysis window.'],
      dataQuality: 'INSUFFICIENT',
      generatedAt: new Date().toISOString(),
    };
  }

  private marketBias(input: FusionInput): AnalysisBias {
    return input.market.trend.direction === 'UP'
      ? 'BULLISH'
      : input.market.trend.direction === 'DOWN'
        ? 'BEARISH'
        : 'NEUTRAL';
  }

  private technicalBias(input: FusionInput): AnalysisBias {
    return input.technical.trend.direction === 'UP'
      ? 'BULLISH'
      : input.technical.trend.direction === 'DOWN'
        ? 'BEARISH'
        : 'NEUTRAL';
  }

  private newsBias(input: FusionInput): AnalysisBias {
    return input.news.impact.direction === 'POSITIVE'
      ? 'BULLISH'
      : input.news.impact.direction === 'NEGATIVE'
        ? 'BEARISH'
        : 'NEUTRAL';
  }

  private onChainBias(input: FusionInput): AnalysisBias {
    const evidence = [
      ...input.onchain.signals,
      input.onchain.flows.exchangeInflow,
      input.onchain.flows.exchangeOutflow,
    ]
      .filter((item): item is string => Boolean(item))
      .join(' ')
      .toLowerCase();
    const bullish = /bullish|accumulat|net outflow|outflow (?:is )?(?:high|rising|increas)/.test(
      evidence,
    );
    const bearish = /bearish|distribut|net inflow|inflow (?:is )?(?:high|rising|increas)/.test(
      evidence,
    );
    return bullish === bearish ? 'NEUTRAL' : bullish ? 'BULLISH' : 'BEARISH';
  }

  private describeConflicts(
    votes: Record<AnalysisName, AnalysisBias>,
    usableNames: AnalysisName[],
  ): string[] {
    const groups = (['BULLISH', 'BEARISH', 'NEUTRAL'] as const)
      .map((bias) => ({
        bias,
        names: usableNames.filter((name) => votes[name] === bias),
      }))
      .filter((group) => group.names.length > 0);
    if (groups.length <= 1) return [];
    return groups.map(
      (group) =>
        `${group.names.join(', ')} indicate ${group.bias.toLowerCase()} conditions.`,
    );
  }

  private unavailableAnalysis(name: AnalysisName): FusionInput[AnalysisName] {
    const generatedAt = new Date().toISOString();
    switch (name) {
      case 'market':
        return {
          summary: 'Market analysis is unavailable.',
          trend: { direction: 'SIDEWAYS', strength: 'WEAK' },
          volatility: { level: 'MEDIUM' },
          liquidity: {},
          derivatives: {},
          anomalies: ['Agent execution failed or returned invalid output.'],
          dataQuality: 'INSUFFICIENT',
          usedTools: [],
          generatedAt,
        };
      case 'technical':
        return {
          summary: 'Technical analysis is unavailable.',
          trend: { direction: 'SIDEWAYS', strength: 'WEAK' },
          momentum: {
            rsi: 'Unavailable',
            rsiState: 'NEUTRAL',
            macd: { trend: 'NEUTRAL' },
          },
          movingAverages: { alignment: 'MIXED', pricePosition: 'INSIDE' },
          volatility: { bollinger: { position: 'MIDDLE', squeeze: false } },
          structure: { marketStructure: 'RANGE' },
          divergence: {},
          signals: ['Agent execution failed or returned invalid output.'],
          dataQuality: 'INSUFFICIENT',
          usedTools: [],
          generatedAt,
        };
      case 'news':
        return {
          summary: 'News analysis is unavailable.',
          impact: { level: 'LOW', direction: 'NEUTRAL' },
          keyEvents: [],
          themes: [],
          riskSignals: ['Agent execution failed or returned invalid output.'],
          dataQuality: 'INSUFFICIENT',
          usedTools: [],
          generatedAt,
        };
      case 'sentiment':
        return {
          summary: 'Sentiment analysis is unavailable.',
          sentiment: { overall: 'NEUTRAL', intensity: 'LOW' },
          crowdBehavior: { fomo: false, panic: false, euphoria: false },
          sources: {},
          anomalies: ['Agent execution failed or returned invalid output.'],
          dataQuality: 'INSUFFICIENT',
          usedTools: [],
          generatedAt,
        };
      case 'macro':
        return {
          summary: 'Macro analysis is unavailable.',
          macroTrend: 'NEUTRAL',
          keyEvents: [],
          riskFactors: ['Agent execution failed or returned invalid output.'],
          dataQuality: 'INSUFFICIENT',
          generatedAt,
        };
      case 'onchain':
        return {
          summary: 'On-chain analysis is unavailable.',
          activity: 'NORMAL',
          flows: {},
          signals: ['No verified on-chain analysis is available.'],
          dataQuality: 'INSUFFICIENT',
          generatedAt,
        };
    }
  }
}
