import type { PipelineDefinition } from '@platform/shared';

export const FULL_ANALYSIS_DECISION = Object.freeze({
  id: 'FULL_ANALYSIS_DECISION',
  version: 1,
  description: 'Market, technical, news, sentiment, macro and on-chain analysis followed by fusion and decision consensus.',
  defaultParams: { interval: '15m', lookbackCandles: 150, lookbackHours: 24, maxItems: 50 },
  timeoutMs: 8 * 60_000,
  maxConcurrency: 5,
  retryPolicy: { attempts: 2, backoffMs: 5_000 },
  enabled: true,
  steps: [
    { id: 'market', type: 'AGENT', ref: 'MARKET_ANALYST' },
    { id: 'technical', type: 'AGENT', ref: 'TECHNICAL_ANALYST' },
    { id: 'news', type: 'AGENT', ref: 'NEWS_ANALYST' },
    { id: 'sentiment', type: 'AGENT', ref: 'SENTIMENT_ANALYST' },
    { id: 'macro', type: 'AGENT', ref: 'MACRO_ANALYST' },
    { id: 'onchain', type: 'AGENT', ref: 'ON_CHAIN_ANALYST' },
    { id: 'fusion', type: 'FUSION', ref: 'FUSION_V1', dependsOn: ['market', 'technical', 'news', 'sentiment', 'macro', 'onchain'] },
    { id: 'decision', type: 'DECISION', ref: 'DECISION_PRO', dependsOn: ['fusion'] },
  ],
} satisfies PipelineDefinition);

export function resolvePipelineDefinition(id: string): PipelineDefinition | undefined {
  return id === FULL_ANALYSIS_DECISION.id ? FULL_ANALYSIS_DECISION : undefined;
}
