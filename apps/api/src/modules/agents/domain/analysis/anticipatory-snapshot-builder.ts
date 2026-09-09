import {
  AnticipatoryMarketSnapshotSchema,
  type AnticipatoryMarketSnapshot,
  type EvidenceRef,
} from '@platform/shared';

import {
  CALCULATION_VERSION,
  calculateAllIndicators,
  calculateIndicatorSeries,
  type CandleData,
} from '../../../../market-data/domain/indicators/indicator-calculator';
import {
  detectLiquiditySweep,
  identifyConfirmedPivots,
  identifyLiquidityZones,
  type CandleInput,
  type ConfirmedPivot,
} from './liquidity-sweep-hunter';

type Timestamp = Date | string;

export interface AnticipatoryCandleInput extends CandleInput {
  openTime: Timestamp;
  closeTime: Timestamp;
  isClosed?: boolean;
}

export interface TimestampedNumberInput {
  timestamp: Timestamp;
  value: number;
}

export interface TimestampedMacdInput {
  timestamp: Timestamp;
  value: number;
  signal: number;
  histogram: number;
}

export interface AnticipatoryOrderBookInput {
  timestamp: Timestamp;
  imbalance: number;
  source?: string;
  freshnessThresholdMs?: number;
}

export interface AnticipatoryExecutionInput {
  timestamp: Timestamp;
  currentPrice?: number;
  spread: number;
  estimatedRoundTripCost: number;
  tickSize: number;
  lotSize: number;
  currentExposure: number;
  candidateZonePrices?: number[];
  maximumChaseDistanceAtr?: number;
  source?: string;
  freshnessThresholdMs?: number;
}

export interface AnticipatoryLiquidationInput {
  timestamp: Timestamp;
  longLiquidations: number;
  shortLiquidations: number;
  source?: string;
  freshnessThresholdMs?: number;
}

export interface AnticipatoryDerivativesImbalanceInput {
  timestamp: Timestamp;
  fundingExtreme: 'EXTREME_NEGATIVE' | 'EXTREME_POSITIVE' | 'NORMAL';
  oiPriceDivergence:
    | 'OI_RISING_PRICE_FLAT'
    | 'OI_RISING_PRICE_FALLING'
    | 'OI_FALLING_PRICE_RISING'
    | 'ALIGNED';
  squeezeProbability: number;
  squeezeDirection: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'NONE';
  signals: string[];
  source?: string;
  freshnessThresholdMs?: number;
}

export interface AnticipatoryDerivativesInput {
  timestamp: Timestamp;
  fundingRate: number;
  fundingHistory: TimestampedNumberInput[];
  openInterest: number;
  openInterestHistory: TimestampedNumberInput[];
  priceOpenInterestDivergence:
    | 'OI_RISING_PRICE_FLAT'
    | 'OI_RISING_PRICE_FALLING'
    | 'OI_FALLING_PRICE_RISING'
    | 'ALIGNED';
  liquidationContext?: AnticipatoryLiquidationInput;
  derivativesImbalance?: AnticipatoryDerivativesImbalanceInput;
  source?: string;
  freshnessThresholdMs?: number;
}

export interface AnticipatoryContextObservationInput {
  observedAt: Timestamp;
  summary: string;
}

export interface AnticipatoryContextSourceInput {
  observations: AnticipatoryContextObservationInput[];
  source: string;
  freshnessThresholdMs?: number;
}

export interface AnticipatoryContextInput {
  news?: AnticipatoryContextSourceInput;
  sentiment?: AnticipatoryContextSourceInput;
  macro?: AnticipatoryContextSourceInput;
  onChain?: AnticipatoryContextSourceInput;
}

export interface AnticipatorySnapshotInput {
  symbol: string;
  provider: string;
  timeframe: string;
  sourceDataCutoff: Timestamp;
  candles: AnticipatoryCandleInput[];
  rsiHistory?: TimestampedNumberInput[];
  macdHistory?: TimestampedMacdInput[];
  atrHistory?: TimestampedNumberInput[];
  orderBook?: AnticipatoryOrderBookInput;
  derivatives?: AnticipatoryDerivativesInput;
  context?: AnticipatoryContextInput;
  execution?: AnticipatoryExecutionInput;
  pivotStrength?: number;
  lookback?: number;
  schemaVersion?: number;
  calculationVersion?: number;
  freshnessThresholdMs?: number;
}

type AvailableMetadata = {
  coverage: 'AVAILABLE';
  freshness: 'FRESH' | 'STALE';
  observationAgeMs: number;
  freshnessThresholdMs: number;
  sourceTimestamp: string;
  calculationVersion: number;
  evidence: EvidenceRef[];
};

type UnavailableEvidence = {
  coverage: 'UNAVAILABLE';
  freshness: 'UNAVAILABLE';
  observationAgeMs: null;
  unavailableFields: string[];
  reason: string;
};

const DEFAULT_FRESHNESS_THRESHOLD_MS = 300_000;

function assertNumericInput(
  field: string,
  value: number,
  predicate: (value: number) => boolean = () => true,
): void {
  if (!Number.isFinite(value) || !predicate(value)) {
    throw new Error(`Invalid anticipatory snapshot input: ${field}`);
  }
}

function validateRawNumericInputs(
  input: AnticipatorySnapshotInput,
  cutoffMs: number,
): void {
  const assertOptionalNonnegativeInteger = (
    field: string,
    value: number | undefined,
  ) => {
    if (value !== undefined) {
      assertNumericInput(
        field,
        value,
        (candidate) => Number.isSafeInteger(candidate) && candidate >= 0,
      );
    }
  };
  assertOptionalNonnegativeInteger('schemaVersion', input.schemaVersion);
  assertOptionalNonnegativeInteger('calculationVersion', input.calculationVersion);
  assertOptionalNonnegativeInteger('freshnessThresholdMs', input.freshnessThresholdMs);
  if (input.pivotStrength !== undefined) {
    assertNumericInput(
      'pivotStrength',
      input.pivotStrength,
      (value) => Number.isSafeInteger(value) && value >= 1,
    );
  }
  if (input.lookback !== undefined) {
    assertNumericInput(
      'lookback',
      input.lookback,
      (value) => Number.isSafeInteger(value) && value >= 1,
    );
  }

  input.candles.forEach((candle, index) => {
    if (candle.isClosed === false || !isAtOrBefore(candle.closeTime, cutoffMs)) return;
    assertNumericInput(`candles[${index}].open`, candle.open, (value) => value > 0);
    assertNumericInput(`candles[${index}].high`, candle.high, (value) => value > 0);
    assertNumericInput(`candles[${index}].low`, candle.low, (value) => value > 0);
    assertNumericInput(`candles[${index}].close`, candle.close, (value) => value > 0);
    assertNumericInput(`candles[${index}].volume`, candle.volume, (value) => value >= 0);
    if (candle.high < candle.low) {
      throw new Error(`Invalid anticipatory snapshot input: candles[${index}].high`);
    }
  });
  input.rsiHistory?.forEach((point, index) => {
    if (!isAtOrBefore(point.timestamp, cutoffMs)) return;
    assertNumericInput(
      `rsiHistory[${index}].value`,
      point.value,
      (value) => value >= 0 && value <= 100,
    );
  });
  input.macdHistory?.forEach((point, index) => {
    if (!isAtOrBefore(point.timestamp, cutoffMs)) return;
    assertNumericInput(`macdHistory[${index}].value`, point.value);
    assertNumericInput(`macdHistory[${index}].signal`, point.signal);
    assertNumericInput(`macdHistory[${index}].histogram`, point.histogram);
  });
  input.atrHistory?.forEach((point, index) => {
    if (!isAtOrBefore(point.timestamp, cutoffMs)) return;
    assertNumericInput(
      `atrHistory[${index}].value`,
      point.value,
      (value) => value > 0,
    );
  });

  if (
    input.orderBook !== undefined &&
    isAtOrBefore(input.orderBook.timestamp, cutoffMs)
  ) {
    assertNumericInput(
      'orderBook.imbalance',
      input.orderBook.imbalance,
      (value) => value >= -1 && value <= 1,
    );
    assertOptionalNonnegativeInteger(
      'orderBook.freshnessThresholdMs',
      input.orderBook.freshnessThresholdMs,
    );
  }

  const execution = input.execution;
  if (execution !== undefined && isAtOrBefore(execution.timestamp, cutoffMs)) {
    if (execution.currentPrice !== undefined) {
      assertNumericInput(
        'execution.currentPrice',
        execution.currentPrice,
        (value) => value > 0,
      );
    }
    assertNumericInput('execution.spread', execution.spread, (value) => value >= 0);
    assertNumericInput(
      'execution.estimatedRoundTripCost',
      execution.estimatedRoundTripCost,
      (value) => value >= 0,
    );
    assertNumericInput('execution.tickSize', execution.tickSize, (value) => value > 0);
    assertNumericInput('execution.lotSize', execution.lotSize, (value) => value > 0);
    assertNumericInput(
      'execution.currentExposure',
      execution.currentExposure,
      (value) => value >= 0,
    );
    execution.candidateZonePrices?.forEach((value, index) =>
      assertNumericInput(
        `execution.candidateZonePrices[${index}]`,
        value,
        (price) => price > 0,
      ),
    );
    if (execution.maximumChaseDistanceAtr !== undefined) {
      assertNumericInput(
        'execution.maximumChaseDistanceAtr',
        execution.maximumChaseDistanceAtr,
        (value) => value >= 0,
      );
    }
    assertOptionalNonnegativeInteger(
      'execution.freshnessThresholdMs',
      execution.freshnessThresholdMs,
    );
  }

  const derivatives = input.derivatives;
  if (derivatives !== undefined && isAtOrBefore(derivatives.timestamp, cutoffMs)) {
    assertNumericInput('derivatives.fundingRate', derivatives.fundingRate);
    assertNumericInput(
      'derivatives.openInterest',
      derivatives.openInterest,
      (value) => value >= 0,
    );
    derivatives.fundingHistory.forEach((point, index) => {
      if (!isAtOrBefore(point.timestamp, cutoffMs)) return;
      assertNumericInput(`derivatives.fundingHistory[${index}].value`, point.value);
    });
    derivatives.openInterestHistory.forEach((point, index) => {
      if (!isAtOrBefore(point.timestamp, cutoffMs)) return;
      assertNumericInput(
        `derivatives.openInterestHistory[${index}].value`,
        point.value,
        (value) => value >= 0,
      );
    });
    assertOptionalNonnegativeInteger(
      'derivatives.freshnessThresholdMs',
      derivatives.freshnessThresholdMs,
    );
    const liquidation = derivatives.liquidationContext;
    if (
      liquidation !== undefined &&
      isAtOrBefore(liquidation.timestamp, cutoffMs)
    ) {
      assertNumericInput(
        'derivatives.liquidationContext.longLiquidations',
        liquidation.longLiquidations,
        (value) => value >= 0,
      );
      assertNumericInput(
        'derivatives.liquidationContext.shortLiquidations',
        liquidation.shortLiquidations,
        (value) => value >= 0,
      );
      assertOptionalNonnegativeInteger(
        'derivatives.liquidationContext.freshnessThresholdMs',
        liquidation.freshnessThresholdMs,
      );
    }
    const imbalance = derivatives.derivativesImbalance;
    if (imbalance !== undefined && isAtOrBefore(imbalance.timestamp, cutoffMs)) {
      assertNumericInput(
        'derivatives.derivativesImbalance.squeezeProbability',
        imbalance.squeezeProbability,
        (value) => value >= 0 && value <= 100,
      );
      assertOptionalNonnegativeInteger(
        'derivatives.derivativesImbalance.freshnessThresholdMs',
        imbalance.freshnessThresholdMs,
      );
    }
  }

  for (const name of ['news', 'sentiment', 'macro', 'onChain'] as const) {
    const source = input.context?.[name];
    if (
      source !== undefined &&
      source.observations.some((observation) =>
        isAtOrBefore(observation.observedAt, cutoffMs),
      )
    ) {
      assertOptionalNonnegativeInteger(
        `context.${name}.freshnessThresholdMs`,
        source.freshnessThresholdMs,
      );
    }
  }
}

function timestampMs(value: Timestamp): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function timestampIso(value: Timestamp): string {
  return new Date(timestampMs(value)).toISOString();
}

function unavailable(fields: string[], reason: string): UnavailableEvidence {
  return {
    coverage: 'UNAVAILABLE',
    freshness: 'UNAVAILABLE',
    observationAgeMs: null,
    unavailableFields: fields,
    reason,
  };
}

function availableMetadata(params: {
  cutoffMs: number;
  timestamp: Timestamp;
  freshnessThresholdMs: number;
  calculationVersion: number;
  snapshotFields: string[];
  source: string;
}): AvailableMetadata {
  const sourceTimestamp = timestampIso(params.timestamp);
  const observationAgeMs = params.cutoffMs - Date.parse(sourceTimestamp);
  return {
    coverage: 'AVAILABLE',
    freshness:
      observationAgeMs <= params.freshnessThresholdMs ? 'FRESH' : 'STALE',
    observationAgeMs,
    freshnessThresholdMs: params.freshnessThresholdMs,
    sourceTimestamp,
    calculationVersion: params.calculationVersion,
    evidence: params.snapshotFields.map((snapshotField) => ({
      snapshotField,
      source: params.source,
      sourceTimestamp,
      calculationVersion: params.calculationVersion,
    })),
  };
}

function isAtOrBefore(value: Timestamp, cutoffMs: number): boolean {
  const valueMs = timestampMs(value);
  return Number.isFinite(valueMs) && valueMs <= cutoffMs;
}

function oldestTimestamp(...values: Timestamp[]): Timestamp {
  return values.reduce((oldest, value) =>
    timestampMs(value) < timestampMs(oldest) ? value : oldest,
  );
}

function calculatePercentile(values: number[], current: number): number {
  if (values.length === 0) return 50;
  const below = values.filter((value) => value < current).length;
  return Math.round((below / values.length) * 100);
}

function slope(values: number[]): number {
  if (values.length < 2) return 0;
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}

function toIndicatorCandle(candle: AnticipatoryCandleInput): CandleData {
  return {
    open: String(candle.open),
    high: String(candle.high),
    low: String(candle.low),
    close: String(candle.close),
    volume: String(candle.volume),
  };
}

function computedOscillatorHistories(candles: AnticipatoryCandleInput[]): {
  rsiHistory: TimestampedNumberInput[];
  macdHistory: TimestampedMacdInput[];
  atrHistory: TimestampedNumberInput[];
} {
  const series = calculateIndicatorSeries(candles.map(toIndicatorCandle));
  const rsiHistory: TimestampedNumberInput[] = [];
  const macdHistory: TimestampedMacdInput[] = [];
  const atrHistory: TimestampedNumberInput[] = [];

  candles.forEach((candle, index) => {
    const rsi = series.rsi14[index];
    if (rsi !== undefined) {
      rsiHistory.push({ timestamp: candle.closeTime, value: rsi });
    }
    const macd = series.macd[index];
    if (macd !== undefined) {
      macdHistory.push({
        timestamp: candle.closeTime,
        value: Number(macd.value),
        signal: Number(macd.signal),
        histogram: Number(macd.histogram),
      });
    }
    const atr = series.atr14[index];
    if (atr !== undefined) {
      atrHistory.push({ timestamp: candle.closeTime, value: atr });
    }
  });

  return { rsiHistory, macdHistory, atrHistory };
}

function buildMomentumState(
  pivots: ConfirmedPivot[],
  pivotOscillators: Array<{
    pivotOccurredAt: string;
    rsi: number;
    macdHistogram: number;
  }>,
  candles: AnticipatoryCandleInput[],
): 'ACCELERATING' | 'DECELERATING' | 'STABLE' {
  const oscillators = new Map(
    pivotOscillators.map((item) => [Date.parse(item.pivotOccurredAt), item]),
  );

  const matchedPairs = (['HIGH', 'LOW'] as const).flatMap((kind) => {
    const matched = pivots
      .filter((pivot) => pivot.kind === kind)
      .map((pivot) => ({
        pivot,
        oscillator: oscillators.get(timestampMs(candles[pivot.index]!.closeTime)),
      }))
      .filter(
        (item): item is typeof item & { oscillator: NonNullable<typeof item.oscillator> } =>
          item.oscillator !== undefined,
      );
    return matched.length < 2
      ? []
      : [{
          previous: matched[matched.length - 2]!,
          current: matched[matched.length - 1]!,
        }];
  });
  const pair = matchedPairs.sort(
    (left, right) => right.current.pivot.index - left.current.pivot.index,
  )[0];
  if (pair === undefined) return 'STABLE';

  const priceDirection = Math.sign(
    pair.current.pivot.price - pair.previous.pivot.price,
  );
  const rsiDirection = Math.sign(
    pair.current.oscillator.rsi - pair.previous.oscillator.rsi,
  );
  const macdDirection = Math.sign(
    pair.current.oscillator.macdHistogram -
      pair.previous.oscillator.macdHistogram,
  );
  if (
    priceDirection !== 0 &&
    rsiDirection === priceDirection &&
    macdDirection === priceDirection
  ) {
    return 'ACCELERATING';
  }
  if (
    priceDirection !== 0 &&
    rsiDirection === -priceDirection &&
    macdDirection === -priceDirection
  ) {
    return 'DECELERATING';
  }

  return 'STABLE';
}

export function buildAnticipatoryMarketSnapshot(
  input: AnticipatorySnapshotInput,
): AnticipatoryMarketSnapshot {
  const cutoffMs = timestampMs(input.sourceDataCutoff);
  if (!Number.isFinite(cutoffMs)) throw new Error('sourceDataCutoff must be a valid timestamp');
  validateRawNumericInputs(input, cutoffMs);

  const calculationVersion = input.calculationVersion ?? CALCULATION_VERSION;
  const freshnessThresholdMs =
    input.freshnessThresholdMs ?? DEFAULT_FRESHNESS_THRESHOLD_MS;
  const pivotStrength = input.pivotStrength ?? 5;
  const lookback = input.lookback ?? 100;
  const candles = input.candles
    .filter(
      (candle) =>
        candle.isClosed !== false && isAtOrBefore(candle.closeTime, cutoffMs),
    )
    .slice()
    .sort((left, right) => timestampMs(left.closeTime) - timestampMs(right.closeTime));
  const indicatorCandles = candles.map(toIndicatorCandle);
  const computedHistories = computedOscillatorHistories(candles);
  const rsiHistory = (input.rsiHistory ?? computedHistories.rsiHistory)
    .filter((point) => isAtOrBefore(point.timestamp, cutoffMs))
    .slice()
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
  const macdHistory = (input.macdHistory ?? computedHistories.macdHistory)
    .filter((point) => isAtOrBefore(point.timestamp, cutoffMs))
    .slice()
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
  const atrHistory = (input.atrHistory ?? computedHistories.atrHistory)
    .filter((point) => isAtOrBefore(point.timestamp, cutoffMs))
    .slice()
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));

  const lastCandle = candles[candles.length - 1];
  const indicators = calculateAllIndicators(indicatorCandles);
  const latestStoredAtrPoint = atrHistory[atrHistory.length - 1];
  const latestStoredAtr = latestStoredAtrPoint?.value;
  const calculatedAtr =
    indicators.atr14 === undefined ? undefined : Number(indicators.atr14);
  const currentAtr =
    latestStoredAtr !== undefined && latestStoredAtr > 0
      ? latestStoredAtr
      : calculatedAtr;
  const currentAtrTimestamp =
    latestStoredAtrPoint !== undefined && latestStoredAtrPoint.value > 0
      ? latestStoredAtrPoint.timestamp
      : lastCandle?.closeTime;
  const pivots = identifyConfirmedPivots(candles, lookback, pivotStrength);
  const zones = identifyLiquidityZones(candles, lookback, pivotStrength);
  const highPivots = pivots.filter((pivot) => pivot.kind === 'HIGH');
  const lowPivots = pivots.filter((pivot) => pivot.kind === 'LOW');

  let structure: AnticipatoryMarketSnapshot['structure'];
  let rangeBoundaries: { lower: number; upper: number } | undefined;
  if (lastCandle === undefined || highPivots.length === 0 || lowPivots.length === 0) {
    structure = unavailable(
      ['structure.confirmedPivots', 'structure.rangeBoundaries'],
      'CONFIRMED_RANGE_BOUNDARIES_UNAVAILABLE',
    );
  } else {
    const lower = Math.min(...lowPivots.map((pivot) => pivot.price));
    const upper = Math.max(...highPivots.map((pivot) => pivot.price));
    if (!(lower > 0 && upper > lower)) {
      structure = unavailable(
        ['structure.rangeBoundaries'],
        'VALID_RANGE_BOUNDARIES_UNAVAILABLE',
      );
    } else if (currentAtr === undefined || !(currentAtr > 0)) {
      structure = unavailable(
        ['structure.distanceToNearestBoundaryAtr'],
        'ATR_NORMALIZATION_UNAVAILABLE',
      );
    } else {
      rangeBoundaries = { lower, upper };
      const structureTimestamp = oldestTimestamp(
        lastCandle.closeTime,
        currentAtrTimestamp ?? lastCandle.closeTime,
      );
      const sweep = detectLiquiditySweep(candles, zones);
      const nearestDistance = Math.min(
        Math.abs(lastCandle.close - lower),
        Math.abs(lastCandle.close - upper),
      );
      structure = {
        ...availableMetadata({
          cutoffMs,
          timestamp: structureTimestamp,
          freshnessThresholdMs,
          calculationVersion,
          snapshotFields: ['structure.confirmedPivots', 'structure.rangeBoundaries'],
          source: input.provider,
        }),
        confirmedPivots: pivots.map((pivot) => ({
          kind: pivot.kind,
          price: pivot.price,
          occurredAt: timestampIso(candles[pivot.index]!.closeTime),
          confirmedAt: timestampIso(candles[pivot.confirmedIndex]!.closeTime),
        })),
        rangeBoundaries,
        equalHighs: zones
          .filter((zone) => zone.type === 'EQUAL_HIGHS')
          .map((zone) => zone.price),
        equalLows: zones
          .filter((zone) => zone.type === 'EQUAL_LOWS')
          .map((zone) => zone.price),
        distanceToNearestBoundaryAtr: nearestDistance / currentAtr,
        invalidationCandidates: [
          { direction: 'LONG', price: lower, reason: 'RANGE_LOW_LOSS' },
          { direction: 'SHORT', price: upper, reason: 'RANGE_HIGH_LOSS' },
        ],
        liquiditySweep: {
          ...availableMetadata({
            cutoffMs,
            timestamp: structureTimestamp,
            freshnessThresholdMs,
            calculationVersion,
            snapshotFields: ['structure.liquiditySweep'],
            source: input.provider,
          }),
          detected: sweep.detected,
          direction: sweep.direction,
          sweepZone:
            sweep.sweepZone === null
              ? null
              : { price: sweep.sweepZone.price, type: sweep.sweepZone.type },
          penetration: sweep.penetration,
          reclaimed: sweep.reclaimed,
        },
      };
    }
  }

  let volatility: AnticipatoryMarketSnapshot['volatility'];
  if (lastCandle === undefined || currentAtr === undefined || !(currentAtr > 0)) {
    volatility = unavailable(['volatility.atr'], 'ATR_HISTORY_INSUFFICIENT');
  } else {
    const recentAtrs = atrHistory.map((point) => point.value).filter(Number.isFinite);
    const comparisonAtr = recentAtrs.length > 0 ? recentAtrs : [currentAtr];
    const recentSlopeValues = comparisonAtr.slice(-5);
    const previousAtr = comparisonAtr[comparisonAtr.length - 2] ?? currentAtr;
    const expansionRatio = previousAtr > 0 ? currentAtr / previousAtr : 1;
    volatility = {
      ...availableMetadata({
        cutoffMs,
        timestamp: oldestTimestamp(
          lastCandle.closeTime,
          currentAtrTimestamp ?? lastCandle.closeTime,
        ),
        freshnessThresholdMs,
        calculationVersion,
        snapshotFields: ['volatility.atr', 'volatility.squeezeState'],
        source: input.provider,
      }),
      atr: currentAtr,
      atrPercentile:
        indicators.squeezeState?.atrPercentile ??
        calculatePercentile(comparisonAtr, currentAtr),
      squeezeState: indicators.squeezeState?.isSqueezing
        ? 'SQUEEZING'
        : 'NOT_SQUEEZING',
      squeezeDurationCandles:
        indicators.squeezeState?.consecutiveSqueezeBars ?? 0,
      compressionSlope: slope(recentSlopeValues),
      expansionState:
        expansionRatio >= 1.2
          ? 'EXPANDED'
          : expansionRatio > 1.05
            ? 'EXPANDING'
            : 'NOT_EXPANDED',
    };
  }

  const latestRsi = rsiHistory[rsiHistory.length - 1];
  const latestMacd = macdHistory[macdHistory.length - 1];
  let momentum: AnticipatoryMarketSnapshot['momentum'];
  if (
    latestRsi === undefined ||
    latestMacd === undefined ||
    latestRsi.value < 0 ||
    latestRsi.value > 100
  ) {
    momentum = unavailable(
      ['momentum.rsi', 'momentum.macd'],
      'OSCILLATOR_HISTORY_INSUFFICIENT',
    );
  } else {
    const rsiByTimestamp = new Map(
      rsiHistory.map((point) => [timestampMs(point.timestamp), point.value]),
    );
    const macdByTimestamp = new Map(
      macdHistory.map((point) => [timestampMs(point.timestamp), point]),
    );
    const pivotOscillators = pivots.flatMap((pivot) => {
      const occurredAt = candles[pivot.index]!.closeTime;
      const rsi = rsiByTimestamp.get(timestampMs(occurredAt));
      const macd = macdByTimestamp.get(timestampMs(occurredAt));
      return rsi === undefined || macd === undefined
        ? []
        : [
            {
              pivotOccurredAt: timestampIso(occurredAt),
              rsi,
              macdHistogram: macd.histogram,
            },
          ];
    });
    const momentumTimestamp = oldestTimestamp(
      latestRsi.timestamp,
      latestMacd.timestamp,
    );
    momentum = {
      ...availableMetadata({
        cutoffMs,
        timestamp: momentumTimestamp,
        freshnessThresholdMs,
        calculationVersion,
        snapshotFields: ['momentum.rsi', 'momentum.macd', 'momentum.pivotOscillators'],
        source: input.provider,
      }),
      rsi: latestRsi.value,
      macd: {
        value: latestMacd.value,
        signal: latestMacd.signal,
        histogram: latestMacd.histogram,
      },
      pivotOscillators,
      momentumState: buildMomentumState(pivots, pivotOscillators, candles),
    };
  }

  let participation: AnticipatoryMarketSnapshot['participation'];
  if (lastCandle === undefined || candles.length < 2) {
    participation = unavailable(
      ['participation.volumeRatio'],
      'VOLUME_HISTORY_INSUFFICIENT',
    );
  } else {
    const currentWindow = candles.slice(-Math.min(5, candles.length));
    const baselineWindow = candles.slice(
      Math.max(0, candles.length - 25),
      Math.max(1, candles.length - currentWindow.length),
    );
    const currentVolume =
      currentWindow.reduce((sum, candle) => sum + candle.volume, 0) /
      currentWindow.length;
    const baselineVolume =
      baselineWindow.reduce((sum, candle) => sum + candle.volume, 0) /
      baselineWindow.length;
    const volumeRatio = baselineVolume > 0 ? currentVolume / baselineVolume : 0;
    const orderBook = input.orderBook;
    const orderBookEvidence =
      orderBook !== undefined && isAtOrBefore(orderBook.timestamp, cutoffMs)
        ? {
            ...availableMetadata({
              cutoffMs,
              timestamp: orderBook.timestamp,
              freshnessThresholdMs:
                orderBook.freshnessThresholdMs ?? freshnessThresholdMs,
              calculationVersion,
              snapshotFields: ['participation.orderBook.imbalance'],
              source: orderBook.source ?? input.provider,
            }),
            imbalance: orderBook.imbalance,
          }
        : unavailable(
            ['participation.orderBook'],
            orderBook === undefined ? 'ORDER_BOOK_UNAVAILABLE' : 'ORDER_BOOK_AFTER_CUTOFF',
          );
    participation = {
      ...availableMetadata({
        cutoffMs,
        timestamp: lastCandle.closeTime,
        freshnessThresholdMs,
        calculationVersion,
        snapshotFields: ['participation.volumeRatio', 'participation.volumeState'],
        source: input.provider,
      }),
      volumeState:
        volumeRatio < 0.8
          ? 'COMPRESSING'
          : volumeRatio > 1.2
            ? 'EXPANDING'
            : 'STABLE',
      volumeRatio,
      orderBook: orderBookEvidence,
    };
  }

  const derivatives = buildDerivativesEvidence(
    input,
    cutoffMs,
    calculationVersion,
    freshnessThresholdMs,
  );
  const context = buildContextEvidence(
    input,
    cutoffMs,
    calculationVersion,
    freshnessThresholdMs,
  );
  const execution = buildExecutionEvidence({
    input,
    cutoffMs,
    calculationVersion,
    freshnessThresholdMs,
    lastCandle,
    currentAtr,
    currentAtrTimestamp,
    rangeBoundaries,
  });

  const ineligibleReasons: string[] = [];
  for (const [name, section] of [
    ['structure', structure],
    ['volatility', volatility],
    ['momentum', momentum],
    ['participation', participation],
  ] as const) {
    if (section.coverage !== 'AVAILABLE') {
      ineligibleReasons.push(`${name.toUpperCase()}_UNAVAILABLE`);
    } else if (section.freshness !== 'FRESH') {
      ineligibleReasons.push(`${name.toUpperCase()}_STALE`);
    }
  }

  const snapshot = {
    symbol: input.symbol,
    provider: input.provider,
    timeframe: input.timeframe,
    sourceDataCutoff: new Date(cutoffMs).toISOString(),
    schemaVersion: input.schemaVersion ?? 1,
    calculationVersion,
    eligibility:
      ineligibleReasons.length === 0
        ? { status: 'ELIGIBLE', reasons: [] }
        : { status: 'INELIGIBLE', reasons: ineligibleReasons },
    structure,
    volatility,
    momentum,
    participation,
    derivatives,
    context,
    execution,
  };
  const parsed = AnticipatoryMarketSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') || 'snapshot';
    throw new Error(
      `Invalid anticipatory snapshot output: ${path}: ${issue?.message ?? 'schema validation failed'}`,
    );
  }
  return parsed.data;
}

function buildDerivativesEvidence(
  input: AnticipatorySnapshotInput,
  cutoffMs: number,
  calculationVersion: number,
  defaultFreshnessThresholdMs: number,
): AnticipatoryMarketSnapshot['derivatives'] {
  const derivatives = input.derivatives;
  if (derivatives === undefined || !isAtOrBefore(derivatives.timestamp, cutoffMs)) {
    return unavailable(
      ['derivatives'],
      derivatives === undefined ? 'DERIVATIVES_UNAVAILABLE' : 'DERIVATIVES_AFTER_CUTOFF',
    );
  }
  const fundingHistory = derivatives.fundingHistory
    .filter((point) => isAtOrBefore(point.timestamp, cutoffMs))
    .slice()
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
  const oiHistory = derivatives.openInterestHistory
    .filter((point) => isAtOrBefore(point.timestamp, cutoffMs))
    .slice()
    .sort((left, right) => timestampMs(left.timestamp) - timestampMs(right.timestamp));
  const unavailableHistoryFields = [
    ...(fundingHistory.length < 5
      ? ['derivatives.fundingRatePercentile']
      : []),
    ...(oiHistory.length < 2
      ? ['derivatives.openInterestChangePct']
      : []),
  ];
  if (unavailableHistoryFields.length > 0) {
    return unavailable(
      unavailableHistoryFields,
      'DERIVATIVES_HISTORY_INSUFFICIENT_AT_CUTOFF',
    );
  }
  const previousOi = oiHistory[oiHistory.length - 2]?.value;
  if (previousOi === undefined || !Number.isFinite(previousOi) || previousOi <= 0) {
    return unavailable(
      ['derivatives.openInterestChangePct'],
      'OPEN_INTEREST_PERCENTAGE_DENOMINATOR_INVALID',
    );
  }
  const openInterestChangePct =
    ((derivatives.openInterest - previousOi) / previousOi) * 100;
  const threshold = derivatives.freshnessThresholdMs ?? defaultFreshnessThresholdMs;
  const nestedUnavailable = (field: string, reason: string) => unavailable([field], reason);
  const liquidation = derivatives.liquidationContext;
  const liquidationContext =
    liquidation !== undefined && isAtOrBefore(liquidation.timestamp, cutoffMs)
      ? {
          ...availableMetadata({
            cutoffMs,
            timestamp: liquidation.timestamp,
            freshnessThresholdMs: liquidation.freshnessThresholdMs ?? threshold,
            calculationVersion,
            snapshotFields: ['derivatives.liquidationContext'],
            source: liquidation.source ?? derivatives.source ?? input.provider,
          }),
          longLiquidations: liquidation.longLiquidations,
          shortLiquidations: liquidation.shortLiquidations,
        }
      : nestedUnavailable('derivatives.liquidationContext', 'LIQUIDATIONS_UNAVAILABLE');
  const imbalance = derivatives.derivativesImbalance;
  const derivativesImbalance =
    imbalance !== undefined && isAtOrBefore(imbalance.timestamp, cutoffMs)
      ? {
          ...availableMetadata({
            cutoffMs,
            timestamp: imbalance.timestamp,
            freshnessThresholdMs: imbalance.freshnessThresholdMs ?? threshold,
            calculationVersion,
            snapshotFields: ['derivatives.derivativesImbalance'],
            source: imbalance.source ?? derivatives.source ?? input.provider,
          }),
          fundingExtreme: imbalance.fundingExtreme,
          oiPriceDivergence: imbalance.oiPriceDivergence,
          squeezeProbability: imbalance.squeezeProbability,
          squeezeDirection: imbalance.squeezeDirection,
          signals: [...imbalance.signals],
        }
      : nestedUnavailable('derivatives.derivativesImbalance', 'DERIVATIVES_IMBALANCE_UNAVAILABLE');

  return {
    ...availableMetadata({
      cutoffMs,
      timestamp: derivatives.timestamp,
      freshnessThresholdMs: threshold,
      calculationVersion,
      snapshotFields: ['derivatives.fundingRate', 'derivatives.openInterest'],
      source: derivatives.source ?? input.provider,
    }),
    fundingRate: derivatives.fundingRate,
    fundingRatePercentile: calculatePercentile(
      fundingHistory.map((point) => point.value),
      derivatives.fundingRate,
    ),
    openInterest: derivatives.openInterest,
    openInterestChangePct,
    priceOpenInterestDivergence: derivatives.priceOpenInterestDivergence,
    liquidationContext,
    derivativesImbalance,
  };
}

function buildContextEvidence(
  input: AnticipatorySnapshotInput,
  cutoffMs: number,
  calculationVersion: number,
  defaultFreshnessThresholdMs: number,
): AnticipatoryMarketSnapshot['context'] {
  const names = ['news', 'sentiment', 'macro', 'onChain'] as const;
  const built = names.map((name) => {
    const source = input.context?.[name];
    const observations = (source?.observations ?? [])
      .filter((item) => isAtOrBefore(item.observedAt, cutoffMs))
      .slice()
      .sort((left, right) => timestampMs(left.observedAt) - timestampMs(right.observedAt));
    const latest = observations[observations.length - 1];
    if (source === undefined || latest === undefined) {
      return [name, unavailable([`context.${name}`], `${name.toUpperCase()}_UNAVAILABLE`)] as const;
    }
    return [
      name,
      {
        ...availableMetadata({
          cutoffMs,
          timestamp: latest.observedAt,
          freshnessThresholdMs: source.freshnessThresholdMs ?? defaultFreshnessThresholdMs,
          calculationVersion,
          snapshotFields: [`context.${name}.observations`],
          source: source.source,
        }),
        observations: observations.map((item) => ({
          observedAt: timestampIso(item.observedAt),
          summary: item.summary,
        })),
      },
    ] as const;
  });
  const sections = Object.fromEntries(built) as Record<
    (typeof names)[number],
    (typeof built)[number][1]
  >;
  const availableSections = built.filter((entry) => entry[1].coverage === 'AVAILABLE');
  if (availableSections.length === 0) {
    return unavailable(['context'], 'CONTEXT_UNAVAILABLE');
  }
  const latestTimestamp = availableSections
    .map((entry) => entry[1])
    .filter((entry): entry is Extract<typeof entry, AvailableMetadata> => entry.coverage === 'AVAILABLE')
    .sort((left, right) => Date.parse(left.sourceTimestamp) - Date.parse(right.sourceTimestamp))
    .at(-1)!.sourceTimestamp;
  return {
    ...availableMetadata({
      cutoffMs,
      timestamp: latestTimestamp,
      freshnessThresholdMs: defaultFreshnessThresholdMs,
      calculationVersion,
      snapshotFields: ['context'],
      source: input.provider,
    }),
    news: sections.news,
    sentiment: sections.sentiment,
    macro: sections.macro,
    onChain: sections.onChain,
  };
}

function buildExecutionEvidence(params: {
  input: AnticipatorySnapshotInput;
  cutoffMs: number;
  calculationVersion: number;
  freshnessThresholdMs: number;
  lastCandle: AnticipatoryCandleInput | undefined;
  currentAtr: number | undefined;
  currentAtrTimestamp: Timestamp | undefined;
  rangeBoundaries: { lower: number; upper: number } | undefined;
}): AnticipatoryMarketSnapshot['execution'] {
  const execution = params.input.execution;
  if (execution === undefined || !isAtOrBefore(execution.timestamp, params.cutoffMs)) {
    return unavailable(
      ['execution'],
      execution === undefined ? 'EXECUTION_CONTEXT_UNAVAILABLE' : 'EXECUTION_CONTEXT_AFTER_CUTOFF',
    );
  }
  const currentPrice = execution.currentPrice ?? params.lastCandle?.close;
  if (currentPrice === undefined || !(currentPrice > 0)) {
    return unavailable(['execution.currentPrice'], 'CURRENT_PRICE_UNAVAILABLE');
  }
  if (params.currentAtr === undefined || !(params.currentAtr > 0)) {
    return unavailable(
      ['execution.priceTooFarFromCandidateZones'],
      'CHASE_DISTANCE_ATR_UNAVAILABLE',
    );
  }
  const candidateZonePrices = execution.candidateZonePrices ??
    (params.rangeBoundaries === undefined
      ? []
      : [params.rangeBoundaries.lower, params.rangeBoundaries.upper]);
  if (candidateZonePrices.length === 0) {
    return unavailable(
      ['execution.priceTooFarFromCandidateZones'],
      'CHASE_DISTANCE_CANDIDATE_ZONES_UNAVAILABLE',
    );
  }
  const nearestDistance =
    Math.min(...candidateZonePrices.map((price) => Math.abs(currentPrice - price)));
  const maximumChaseDistanceAtr = execution.maximumChaseDistanceAtr ?? 0.8;
  const priceTooFarFromCandidateZones =
    nearestDistance / params.currentAtr > maximumChaseDistanceAtr;
  return {
    ...availableMetadata({
      cutoffMs: params.cutoffMs,
      timestamp:
        params.currentAtrTimestamp === undefined
          ? execution.timestamp
          : oldestTimestamp(execution.timestamp, params.currentAtrTimestamp),
      freshnessThresholdMs:
        execution.freshnessThresholdMs ?? params.freshnessThresholdMs,
      calculationVersion: params.calculationVersion,
      snapshotFields: ['execution.currentPrice', 'execution.priceTooFarFromCandidateZones'],
      source: execution.source ?? params.input.provider,
    }),
    currentPrice,
    spread: execution.spread,
    estimatedRoundTripCost: execution.estimatedRoundTripCost,
    tickSize: execution.tickSize,
    lotSize: execution.lotSize,
    currentExposure: execution.currentExposure,
    priceTooFarFromCandidateZones,
  };
}
