type NumericValue = number | string;

export type MarketCausalityInput = {
  candles: Array<{ close: NumericValue; volume: NumericValue }>;
  openInterest: Array<{ openInterest: NumericValue; timestamp?: Date | string }>;
  funding: Array<{ fundingRate: NumericValue }>;
};

export type SqueezeIndicator =
  | 'SHORT_SQUEEZE'
  | 'LONG_BUILDUP'
  | 'DISTRIBUTION'
  | 'DELEVERAGING'
  | 'NONE';

const finite = (value: NumericValue | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const rounded = (value: number): number => Number(value.toFixed(4));

export function calculateMarketCausality(input: MarketCausalityInput) {
  const firstCandle = input.candles[0];
  const lastCandle = input.candles.at(-1);
  const firstClose = finite(firstCandle?.close);
  const lastClose = finite(lastCandle?.close);
  const priceChangePercent = firstClose !== undefined && firstClose > 0 && lastClose !== undefined
    ? rounded(((lastClose - firstClose) / firstClose) * 100)
    : undefined;

  const currentVolume = finite(lastCandle?.volume);
  const historicalVolumes = input.candles.slice(0, -1)
    .map((item) => finite(item.volume))
    .filter((value): value is number => value !== undefined && value >= 0);
  const averageVolume = historicalVolumes.length > 0
    ? historicalVolumes.reduce((sum, value) => sum + value, 0) / historicalVolumes.length
    : undefined;
  const volumeRatio = currentVolume !== undefined && averageVolume !== undefined && averageVolume > 0
    ? rounded(currentVolume / averageVolume)
    : undefined;

  const timestampedOi = input.openInterest.every((item) => {
    if (item.timestamp === undefined) return false;
    return Number.isFinite(new Date(item.timestamp).getTime());
  });
  const chronologicalOi = timestampedOi
    ? [...input.openInterest].sort(
        (left, right) => new Date(left.timestamp!).getTime() - new Date(right.timestamp!).getTime(),
      )
    : input.openInterest;
  const firstOi = finite(chronologicalOi[0]?.openInterest);
  const lastOi = finite(chronologicalOi.at(-1)?.openInterest);
  const deltaOi = input.openInterest.length >= 2 && firstOi !== undefined && lastOi !== undefined
    ? rounded(lastOi - firstOi)
    : undefined;
  const deltaOiPercent = deltaOi !== undefined && firstOi !== undefined && firstOi > 0
    ? rounded((deltaOi / firstOi) * 100)
    : undefined;
  const fundingRate = finite(input.funding[0]?.fundingRate);

  const expansion = (priceChangePercent ?? 0) >= 1 && (volumeRatio ?? 0) >= 1.35;
  let squeezeIndicator: SqueezeIndicator = 'NONE';
  let causality = 'INSUFFICIENT_CONFIRMED_EXPANSION';
  if (expansion && (deltaOiPercent ?? 0) >= 1 && fundingRate !== undefined && fundingRate < 0) {
    squeezeIndicator = 'SHORT_SQUEEZE';
    causality = 'PRICE_VOLUME_OI_EXPANSION_WITH_NEGATIVE_FUNDING';
  } else if (expansion && (deltaOiPercent ?? 0) >= 1 && fundingRate !== undefined && fundingRate >= 0) {
    squeezeIndicator = 'LONG_BUILDUP';
    causality = 'PRICE_VOLUME_OI_EXPANSION_WITH_POSITIVE_FUNDING';
  } else if (expansion && (deltaOiPercent ?? 0) <= -1) {
    squeezeIndicator = 'DELEVERAGING';
    causality = 'PRICE_VOLUME_EXPANSION_WITH_OI_CONTRACTION';
  } else if ((priceChangePercent ?? 0) <= -1 && (deltaOiPercent ?? 0) >= 1) {
    squeezeIndicator = 'DISTRIBUTION';
    causality = 'PRICE_DECLINE_WITH_OI_EXPANSION';
  }

  const missingEvidence: string[] = [];
  if (volumeRatio === undefined) missingEvidence.push('AVERAGE_VOLUME_UNAVAILABLE');
  if (deltaOi === undefined) missingEvidence.push('OPEN_INTEREST_HISTORY_UNAVAILABLE');
  if (fundingRate === undefined) missingEvidence.push('FUNDING_UNAVAILABLE');
  missingEvidence.push('LIQUIDATION_DATA_UNAVAILABLE');

  return {
    volumeRatio,
    priceChangePercent,
    deltaOi,
    deltaOiPercent,
    fundingRate,
    squeezeIndicator,
    causality,
    missingEvidence,
  };
}
