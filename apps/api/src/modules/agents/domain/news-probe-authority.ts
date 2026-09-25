export type NewsProbeAuthorityInput = {
  news: {
    importance: number;
    confidence: number;
    direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    sourceIds: readonly string[];
    publishedAt: string;
  };
  causality: {
    priceChangePercent?: number;
    volumeRatio?: number;
    deltaOiPercent?: number;
    fundingRate?: number;
    liquidationEvidence?: boolean;
    missingEvidence?: readonly string[];
  };
  now?: Date;
};

export type NewsProbeAuthority = {
  allowed: boolean;
  reason: string;
  corroborationCount: number;
};

const HIGH_IMPORTANCE = 80;
const HIGH_CONFIDENCE = 80;
const FRESHNESS_MS = 15 * 60 * 1_000;
const MIN_PRICE_EXPANSION_PERCENT = 1;
const MIN_VOLUME_RATIO = 1.35;
const MIN_OI_EXPANSION_PERCENT = 1;

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

export function evaluateNewsProbeAuthority(
  input: NewsProbeAuthorityInput,
): NewsProbeAuthority {
  const publishedAt = Date.parse(input.news.publishedAt);
  const now = input.now?.getTime() ?? Date.now();
  const missingEvidence = new Set(input.causality.missingEvidence ?? []);
  const uniqueSourceCount = new Set(
    input.news.sourceIds.map((source) => source.trim()).filter(Boolean),
  ).size;

  if (
    input.news.importance < HIGH_IMPORTANCE ||
    input.news.confidence < HIGH_CONFIDENCE ||
    input.news.direction === 'NEUTRAL'
  ) {
    return { allowed: false, reason: 'NEWS_QUALITY_INSUFFICIENT', corroborationCount: 0 };
  }

  if (!Number.isFinite(publishedAt) || publishedAt > now || now - publishedAt > FRESHNESS_MS) {
    return { allowed: false, reason: 'NEWS_NOT_FRESH', corroborationCount: 0 };
  }

  const priceExpanded = finite(input.causality.priceChangePercent) && (
    input.news.direction === 'POSITIVE'
      ? input.causality.priceChangePercent >= MIN_PRICE_EXPANSION_PERCENT
      : input.causality.priceChangePercent <= -MIN_PRICE_EXPANSION_PERCENT
  );
  const volumeExpanded = finite(input.causality.volumeRatio) &&
    input.causality.volumeRatio >= MIN_VOLUME_RATIO;
  if (!priceExpanded || !volumeExpanded) {
    return { allowed: false, reason: 'PRICE_VOLUME_CONFIRMATION_MISSING', corroborationCount: 0 };
  }

  const corroborationCount = [
    uniqueSourceCount >= 2,
    finite(input.causality.deltaOiPercent) &&
      Math.abs(input.causality.deltaOiPercent) >= MIN_OI_EXPANSION_PERCENT &&
      !missingEvidence.has('OPEN_INTEREST_HISTORY_UNAVAILABLE'),
    finite(input.causality.fundingRate) && !missingEvidence.has('FUNDING_UNAVAILABLE'),
    input.causality.liquidationEvidence === true &&
      !missingEvidence.has('LIQUIDATION_DATA_UNAVAILABLE'),
  ].filter(Boolean).length;

  return corroborationCount > 0
    ? { allowed: true, reason: 'NEWS_PROBE_AUTHORIZED', corroborationCount }
    : { allowed: false, reason: 'NEWS_CORROBORATION_INSUFFICIENT', corroborationCount: 0 };
}
