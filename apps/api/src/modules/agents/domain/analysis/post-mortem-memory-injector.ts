export interface PostMortemContext {
  recentLosses: Array<{ symbol: string; regime: string; rootCause: string; recommendation: string }>;
  recurringPatterns: Array<{ pattern: string; count: number }>;
  penalties: Partial<Record<string, number>>;
  cautionAdvice?: string;
}

/**
 * Pure domain helper to build PostMortemContext from loaded memories.
 */
export function buildPostMortemContext(memories: any[], symbol: string, regime: string): PostMortemContext {
  const recentLosses: PostMortemContext['recentLosses'] = [];
  const penalties: Record<string, number> = {};
  
  // Track patterns within the current regime
  const patternCounts: Record<string, number> = {};

  for (const mem of memories) {
    if (!mem.content) continue;
    const content = mem.content;
    
    // Only process relevant memories matching symbol or regime
    if (content.symbol === symbol || content.regime === regime) {
      recentLosses.push({
        symbol: content.symbol,
        regime: content.regime,
        rootCause: content.rootCause,
        recommendation: content.recommendation,
      });

      if (content.penaltyAdjustments) {
        for (const [agent, penalty] of Object.entries(content.penaltyAdjustments)) {
          penalties[agent] = (penalties[agent] || 0) + (penalty as number);
        }
      }

      const patternKey = `${content.symbol}:${content.regime}:${content.rootCause}`;
      patternCounts[patternKey] = (patternCounts[patternKey] || 0) + 1;
    }
  }

  const recurringPatterns = Object.entries(patternCounts)
    .filter(([_, count]) => count >= 2)
    .map(([pattern, count]) => ({ pattern, count }));

  let cautionAdvice: string | undefined;
  
  // Check if there is a recurring pattern specifically for the current regime and symbol
  const hasCurrentRegimePattern = recurringPatterns.some(p => p.pattern.includes(`${symbol}:${regime}`));
  if (hasCurrentRegimePattern) {
    cautionAdvice = "Repeated losses detected in current regime. Require higher confidence threshold or reduce sizing.";
  }

  // clamp penalties
  for (const agent in penalties) {
    if (penalties[agent] < -15) {
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
