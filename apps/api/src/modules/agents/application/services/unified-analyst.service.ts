import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FusionInputSchema,
  FusionOutputSchema,
  MacroAgentOutputSchema,
  MarketAgentOutputSchema,
  NewsAgentOutputSchema,
  OnChainAgentOutputSchema,
  SentimentAgentOutputSchema,
  TechnicalAgentOutputSchema,
  type FusionInput,
  type FusionOutput,
  type FusionRunInput,
} from '@platform/shared';
import { AgentInvocationSource, AgentType } from '../../domain/enums';
import { canonicalSymbol } from '../../../../exchange/infrastructure/exchange-symbol';
import { AgentExecutionService } from './agent-execution.service';
import type { UnifiedAnalystResult } from '../../domain/types/unified-analyst.types';

export type { UnifiedAnalystResult };

@Injectable()
export class UnifiedAnalystService {
  private readonly logger = new Logger(UnifiedAnalystService.name);

  constructor(private readonly agentExecutionService: AgentExecutionService) {}

  public async analyze(options: {
    input: FusionRunInput;
    userId?: string;
    sessionId?: string;
    invocationSource: AgentInvocationSource;
    correlationId?: string;
  }): Promise<UnifiedAnalystResult> {
    const symbol = canonicalSymbol(options.input.symbol);
    const asset = symbol.split('-')[0] || 'BTC';
    const correlationId = options.correlationId ?? randomUUID();
    const common = {
      userId: options.userId,
      sessionId: options.sessionId,
      invocationSource: options.invocationSource,
      correlationId,
    };

    const requests = [
      {
        name: 'market' as const,
        agentType: AgentType.MARKET_ANALYST,
        input: {
          symbol: options.input.symbol,
          provider: options.input.provider,
          interval: options.input.interval,
          lookbackCandles: options.input.lookbackCandles,
        },
        schema: MarketAgentOutputSchema,
      },
      {
        name: 'technical' as const,
        agentType: AgentType.TECHNICAL_ANALYST,
        input: {
          symbol: options.input.symbol,
          provider: options.input.provider,
          interval: options.input.interval,
          lookbackCandles: options.input.lookbackCandles,
        },
        schema: TechnicalAgentOutputSchema,
      },
      {
        name: 'news' as const,
        agentType: AgentType.NEWS_ANALYST,
        input: {
          symbol: asset,
          lookbackHours: options.input.lookbackHours,
          maxItems: options.input.maxItems,
        },
        schema: NewsAgentOutputSchema,
      },
      {
        name: 'sentiment' as const,
        agentType: AgentType.SENTIMENT_ANALYST,
        input: {
          symbol: asset,
          lookbackHours: options.input.lookbackHours,
          maxItems: options.input.maxItems,
        },
        schema: SentimentAgentOutputSchema,
      },
      {
        name: 'macro' as const,
        agentType: AgentType.MACRO_ANALYST,
        input: { lookbackHours: options.input.lookbackHours },
        schema: MacroAgentOutputSchema,
      },
      {
        name: 'onchain' as const,
        agentType: AgentType.ON_CHAIN_ANALYST,
        input: { symbol: asset, lookbackHours: options.input.lookbackHours },
        schema: OnChainAgentOutputSchema,
      },
    ];

    const analyses: Partial<FusionInput> = {};

    const results = await Promise.allSettled(
      requests.map(async (req) => {
        try {
          const run = await this.agentExecutionService.executeSync({
            ...common,
            agentType: req.agentType,
            input: req.input,
          });
          const parsed = req.schema.safeParse(run.output);
          if (parsed.success) {
            return { name: req.name, data: parsed.data };
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Sub-agent ${req.agentType} failed during UnifiedAnalyst: ${errorMsg}`);
        }
        return { name: req.name, data: null };
      }),
    );

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value.data) {
        Object.assign(analyses, { [res.value.name]: res.value.data });
      }
    }

    const nowIso = new Date().toISOString();
    if (!analyses.market) {
      analyses.market = {
        summary: `Market analysis for ${symbol} is unavailable.`,
        trend: { direction: 'SIDEWAYS', strength: 'WEAK' },
        volatility: { level: 'MEDIUM' },
        liquidity: {},
        derivatives: {},
        anomalies: ['Agent execution failed or returned invalid output.'],
        dataQuality: 'INSUFFICIENT',
        usedTools: [],
        generatedAt: nowIso,
      };
    }
    if (!analyses.technical) {
      analyses.technical = {
        summary: `Technical analysis for ${symbol} is unavailable.`,
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
        generatedAt: nowIso,
      };
    }
    if (!analyses.news) {
      analyses.news = {
        summary: `News analysis for ${asset} is unavailable.`,
        impact: { level: 'LOW', direction: 'NEUTRAL' },
        keyEvents: [],
        themes: [],
        riskSignals: ['Agent execution failed or returned invalid output.'],
        dataQuality: 'INSUFFICIENT',
        usedTools: [],
        generatedAt: nowIso,
      };
    }
    if (!analyses.sentiment) {
      analyses.sentiment = {
        summary: `Sentiment analysis for ${asset} is unavailable.`,
        sentiment: { overall: 'NEUTRAL', intensity: 'LOW' },
        crowdBehavior: { fomo: false, panic: false, euphoria: false },
        sources: {},
        anomalies: ['Agent execution failed or returned invalid output.'],
        dataQuality: 'INSUFFICIENT',
        usedTools: [],
        generatedAt: nowIso,
      };
    }
    if (!analyses.macro) {
      analyses.macro = {
        summary: 'Macro analysis is unavailable.',
        macroTrend: 'NEUTRAL',
        keyEvents: [],
        riskFactors: ['Agent execution failed or returned invalid output.'],
        dataQuality: 'INSUFFICIENT',
        generatedAt: nowIso,
      };
    }
    if (!analyses.onchain) {
      analyses.onchain = {
        summary: `On-chain analysis for ${asset} is unavailable.`,
        activity: 'NORMAL',
        flows: {},
        signals: ['No verified on-chain analysis is available.'],
        dataQuality: 'INSUFFICIENT',
        generatedAt: nowIso,
      };
    }

    const parsedAnalyses = FusionInputSchema.parse(analyses);
    const usable = Object.values(parsedAnalyses).filter(
      (analysis) => analysis.dataQuality !== 'INSUFFICIENT',
    );
    const biases = [
      parsedAnalyses.market.trend.direction === 'UP' ? 'BULLISH' : parsedAnalyses.market.trend.direction === 'DOWN' ? 'BEARISH' : 'NEUTRAL',
      parsedAnalyses.technical.trend.direction === 'UP' ? 'BULLISH' : parsedAnalyses.technical.trend.direction === 'DOWN' ? 'BEARISH' : 'NEUTRAL',
      parsedAnalyses.news.impact.direction === 'POSITIVE' ? 'BULLISH' : parsedAnalyses.news.impact.direction === 'NEGATIVE' ? 'BEARISH' : 'NEUTRAL',
      parsedAnalyses.sentiment.sentiment.overall,
      parsedAnalyses.macro.macroTrend === 'RISK_ON' ? 'BULLISH' : parsedAnalyses.macro.macroTrend === 'RISK_OFF' ? 'BEARISH' : 'NEUTRAL',
      'NEUTRAL',
    ] as const;
    const usableBiases = biases.filter((_, index) => Object.values(parsedAnalyses)[index]?.dataQuality !== 'INSUFFICIENT');
    const bullish = usableBiases.filter((bias) => bias === 'BULLISH').length;
    const bearish = usableBiases.filter((bias) => bias === 'BEARISH').length;
    const overallBias = bullish > usable.length / 2 ? 'BULLISH' : bearish > usable.length / 2 ? 'BEARISH' : 'NEUTRAL';
    const agreement = usableBiases.length ? Math.max(bullish, bearish, usableBiases.length - bullish - bearish) : 0;
    const fusionOutput: FusionOutput = FusionOutputSchema.parse({
      summary: `Unified multi-analyst analysis for ${symbol} is ${overallBias.toLowerCase()} with ${usable.length} usable sources.`,
      combinedAnalysis: {
        market: parsedAnalyses.market.summary,
        technical: parsedAnalyses.technical.summary,
        news: parsedAnalyses.news.summary,
        sentiment: parsedAnalyses.sentiment.summary,
        macro: parsedAnalyses.macro.summary,
        onchain: parsedAnalyses.onchain.summary,
      },
      overallBias,
      confidence: usableBiases.length ? Math.round((agreement / usableBiases.length) * 100) : 0,
      conflicts: bullish > 0 && bearish > 0 ? ['Usable analysts disagree on market direction.'] : [],
      dataQuality: usable.length === 6 ? 'GOOD' : usable.length === 0 ? 'INSUFFICIENT' : 'PARTIAL',
      generatedAt: nowIso,
    });

    this.logger.log({
      event: 'unified_multi_analyst_completed',
      symbol,
      provider: options.input.provider,
    });

    return {
      analyses: parsedAnalyses,
      fusionOutput,
    };
  }
}
