export type NewsImpactLevel = "LOW" | "MEDIUM" | "HIGH";
export type SentimentOverall = "BULLISH" | "BEARISH" | "NEUTRAL";
export type SentimentIntensity = "LOW" | "MEDIUM" | "HIGH";

export function classifyNewsImpact(importance: number): NewsImpactLevel {
  if (!Number.isFinite(importance)) return "LOW";
  if (importance >= 80) return "HIGH";
  if (importance >= 50) return "MEDIUM";
  return "LOW";
}

export function mapSentimentScore(score: number): {
  overall: SentimentOverall;
  intensity: SentimentIntensity;
} {
  if (!Number.isFinite(score)) return { overall: "NEUTRAL", intensity: "LOW" };

  const bounded = Math.max(0, Math.min(100, score));
  if (bounded >= 75) return { overall: "BULLISH", intensity: "HIGH" };
  if (bounded >= 56) return { overall: "BULLISH", intensity: "MEDIUM" };
  if (bounded >= 45) return { overall: "NEUTRAL", intensity: "LOW" };
  if (bounded >= 25) return { overall: "BEARISH", intensity: "MEDIUM" };
  return { overall: "BEARISH", intensity: "HIGH" };
}
