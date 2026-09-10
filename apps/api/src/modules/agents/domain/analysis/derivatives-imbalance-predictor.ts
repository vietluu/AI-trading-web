export type FundingExtreme = 'EXTREME_NEGATIVE' | 'EXTREME_POSITIVE' | 'NORMAL';
export type OIDivergence =
  | 'OI_RISING_PRICE_FLAT'
  | 'OI_RISING_PRICE_FALLING'
  | 'OI_FALLING_PRICE_RISING'
  | 'ALIGNED';
export type SqueezeDirection = 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'NONE';

export interface AvailableDerivativesImbalance {
  coverage: 'AVAILABLE';
  fundingRatePercentile: number;
  fundingExtreme: FundingExtreme;
  oiPriceDivergence: OIDivergence;
  squeezeProbability: number;
  squeezeDirection: SqueezeDirection;
  signals: string[];
}

export interface UnavailableDerivativesImbalance {
  coverage: 'UNAVAILABLE';
  reason: 'INSUFFICIENT_DERIVATIVES_HISTORY';
  unavailableFields: Array<'fundingRatePercentile' | 'oiPriceDivergence'>;
}

export type DerivativesImbalance =
  | AvailableDerivativesImbalance
  | UnavailableDerivativesImbalance;

export interface DerivativesInput {
  currentFundingRate: number;
  historicalFundingRates: number[];
  currentOI: number;
  historicalOpenInterest: number[];
  priceChange: number;
  oiTrend: 'RISING' | 'FALLING' | 'FLAT';
  fundingTrend: 'RISING' | 'FALLING' | 'FLAT';
}

const MIN_FUNDING_SAMPLES = 5;
const MIN_OPEN_INTEREST_SAMPLES = 2;

export function predictDerivativesImbalance(
  input: DerivativesInput,
): DerivativesImbalance {
  const unavailableFields: UnavailableDerivativesImbalance['unavailableFields'] = [];
  if (input.historicalFundingRates.length < MIN_FUNDING_SAMPLES) {
    unavailableFields.push('fundingRatePercentile');
  }
  if (input.historicalOpenInterest.length < MIN_OPEN_INTEREST_SAMPLES) {
    unavailableFields.push('oiPriceDivergence');
  }
  if (unavailableFields.length > 0) {
    return {
      coverage: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_DERIVATIVES_HISTORY',
      unavailableFields,
    };
  }

  const sortedHistory = [...input.historicalFundingRates].sort((a, b) => a - b);
  let countBelow = 0;
  for (const rate of sortedHistory) {
    if (rate < input.currentFundingRate) countBelow += 1;
    else break;
  }
  const fundingRatePercentile = Math.round(
    (countBelow / sortedHistory.length) * 100,
  );

  let fundingExtreme: FundingExtreme = 'NORMAL';
  if (fundingRatePercentile < 10) fundingExtreme = 'EXTREME_NEGATIVE';
  else if (fundingRatePercentile > 90) fundingExtreme = 'EXTREME_POSITIVE';

  const previousOI = input.historicalOpenInterest.at(-2)!;
  const oiChange = previousOI > 0
    ? (input.currentOI - previousOI) / previousOI
    : 0;
  let oiPriceDivergence: OIDivergence = 'ALIGNED';
  if (previousOI > 0 && oiChange > 0.05 && Math.abs(input.priceChange) < 1) {
    oiPriceDivergence = 'OI_RISING_PRICE_FLAT';
  } else if (previousOI > 0 && oiChange > 0.05 && input.priceChange < -1) {
    oiPriceDivergence = 'OI_RISING_PRICE_FALLING';
  } else if (previousOI > 0 && oiChange < -0.05 && input.priceChange > 1) {
    oiPriceDivergence = 'OI_FALLING_PRICE_RISING';
  }

  let squeezeDirection: SqueezeDirection = 'NONE';
  if (fundingExtreme === 'EXTREME_NEGATIVE') squeezeDirection = 'SHORT_SQUEEZE';
  else if (fundingExtreme === 'EXTREME_POSITIVE') squeezeDirection = 'LONG_SQUEEZE';

  let squeezeProbability = fundingExtreme !== 'NORMAL' ? 40 : 10;
  if (oiPriceDivergence === 'OI_RISING_PRICE_FLAT') squeezeProbability += 30;
  if (oiPriceDivergence === 'OI_RISING_PRICE_FALLING') squeezeProbability += 20;
  if (oiPriceDivergence === 'OI_FALLING_PRICE_RISING') squeezeProbability += 20;
  if (input.oiTrend === 'RISING' && fundingExtreme !== 'NORMAL') {
    squeezeProbability += 15;
  }
  squeezeProbability = Math.max(0, Math.min(100, squeezeProbability));

  const signals: string[] = [];
  if (fundingExtreme === 'EXTREME_NEGATIVE') {
    signals.push('Funding rate is extremely negative, favoring short squeeze.');
  }
  if (fundingExtreme === 'EXTREME_POSITIVE') {
    signals.push('Funding rate is extremely positive, favoring long squeeze.');
  }
  if (oiPriceDivergence === 'OI_RISING_PRICE_FLAT') {
    signals.push('Open interest rising while price is flat indicates position building.');
  }
  if (oiPriceDivergence === 'OI_RISING_PRICE_FALLING') {
    signals.push('Open interest rising while price falls indicates aggressive shorting.');
  }
  if (oiPriceDivergence === 'OI_FALLING_PRICE_RISING') {
    signals.push('Open interest falling while price rises indicates short covering.');
  }
  if (signals.length === 0) signals.push('Market appears balanced.');

  return {
    coverage: 'AVAILABLE',
    fundingRatePercentile,
    fundingExtreme,
    oiPriceDivergence,
    squeezeProbability,
    squeezeDirection,
    signals,
  };
}
