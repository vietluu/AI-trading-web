export interface PostMortemContext {
  recentLosses: Array<{ symbol: string; regime: string; rootCause: string; recommendation: string }>;
  recurringPatterns: Array<{ pattern: string; count: number }>;
  penalties: Partial<Record<string, number>>;
  cautionAdvice?: string;
}

/**
 * Pure domain helper to build PostMortemContext from loaded memories.
 */
export interface MemoryRecordLike {
  content?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Pure domain helper to build PostMortemContext from loaded memories.
 */
export function buildPostMortemContext(
  memories: MemoryRecordLike[],
  symbol: string,
  regime: string,
): PostMortemContext {
  const recentLosses: PostMortemContext['recentLosses'] = [];
  const penalties: Record<string, number> = {};
  
  // Track patterns within the current regime
  const patternCounts: Record<string, number> = {};

  for (const mem of memories) {
    const content = asRecord(mem.content);
    if (!content) continue;
    const contentSymbol = typeof content.symbol === 'string' ? content.symbol : undefined;
    const contentRegime = typeof content.regime === 'string' ? content.regime : undefined;
    const rootCause = typeof content.rootCause === 'string' ? content.rootCause : undefined;
    const recommendation = typeof content.recommendation === 'string' ? content.recommendation : undefined;
    
    // Only process relevant memories matching symbol or regime
    if (contentSymbol === symbol || contentRegime === regime) {
      recentLosses.push({
        symbol: contentSymbol ?? symbol,
        regime: contentRegime ?? regime,
        rootCause: rootCause ?? 'UNKNOWN',
        recommendation: recommendation ?? '',
      });

      const penaltyAdjustments = asRecord(content.penaltyAdjustments);
      if (penaltyAdjustments) {
        for (const [agent, penalty] of Object.entries(penaltyAdjustments)) {
          penalties[agent] = (penalties[agent] || 0) + (typeof penalty === 'number' ? penalty : 0);
        }
      }

      const patternKey = `${contentSymbol ?? symbol}:${contentRegime ?? regime}:${rootCause ?? 'UNKNOWN'}`;
      patternCounts[patternKey] = (patternCounts[patternKey] || 0) + 1;
    }
  }

  const recurringPatterns = Object.entries(patternCounts)
    .filter(([, count]) => count >= 2)
    .map(([pattern, count]) => ({ pattern, count }));

  let cautionAdvice: string | undefined;
  
  // Check if there is a recurring pattern specifically for the current regime and symbol
  const hasCurrentRegimePattern = recurringPatterns.some(p => p.pattern.includes(`${symbol}:${regime}`));
  if (hasCurrentRegimePattern) {
    cautionAdvice = "Repeated losses detected in current regime. Require higher confidence threshold or reduce sizing.";
  }

  // clamp penalties
  for (const agent in penalties) {
    const val = penalties[agent];
    if (typeof val === 'number' && val < -15) {
      penalties[agent] = -15;
    }
  }

  return {
    recentLosses,
    recurringPatterns,
    penalties,
    cautionAdvice,
  };
}
