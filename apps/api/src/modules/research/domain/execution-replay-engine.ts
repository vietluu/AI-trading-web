import { createHash } from 'node:crypto';
import type { RiskLimits } from '../../risk/domain/risk-engine.types';
import { calculatePositionSize } from '../../risk/domain/risk-engine';
import type { TradePlan } from '../../risk/domain/trade-plan-engine';
import { evaluatePositionManagement } from '../../live-trading/domain/position-manager';
import {
  aggregateLifecyclesByThesis,
  type TradeLifecycleEvent,
  type TradeLifecycleOutcome,
} from './trade-lifecycle';

export interface ReplayCandle {
  symbol: string;
  openTime: Date | string | number;
  closeTime?: Date | string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  finerQuotes?: Array<{ timestamp: Date | string | number; price: number }>;
}

export interface ReplayFundingRate {
  symbol: string;
  timestamp: Date | string | number;
  rate: number;
}

export interface ReplayCandidateThesis {
  thesisId: string;
  symbol: string;
  provider?: string;
  timeframe?: string;
  direction: 'LONG' | 'SHORT';
  sourceDataCutoff: Date | string | number;
  setup?: string;
  regime?: string;
  entryZone?: { lower: number; upper: number };
  limitPrice?: number;
  orderType?: 'MARKET' | 'LIMIT';
  limitTtlCandles?: number;
  stopLoss?: number;
  takeProfit?: number;
  targets?: Array<{ price: number; fraction: number }>;
  initialRisk?: number;
  quantity?: number;
  size?: number;
  stagedEntry?: {
    stage: 'PROBE' | 'CONFIRMED';
    parentThesisId?: string;
    probeSizePct?: number;
    confirmationSizePct?: number;
  };
  tradePlan?: TradePlan;
  metadata?: Record<string, unknown>;
}

export interface ReplayExecutionAssumptions {
  feeRate?: number;
  slippageRate?: number;
  entryDriftTolerancePct?: number;
  defaultLimitTtlCandles?: number;
  stopFirstAmbiguity?: boolean;
  configurationHash?: string;
}

export interface ReplayDatasetProvenance {
  source?: string;
  symbols?: string[];
  startTime?: Date | string | number;
  endTime?: Date | string | number;
  totalCandles?: number;
  checksum?: string;
  sourceCutoff?: Date | string | number;
}

export interface ExecutionReplayInput {
  initialBalance: number;
  theses: ReplayCandidateThesis[];
  candles: ReplayCandle[];
  fundingRates?: ReplayFundingRate[];
  riskLimits?: Partial<RiskLimits>;
  assumptions?: ReplayExecutionAssumptions;
  provenance?: ReplayDatasetProvenance;
}

export interface EquityCurvePoint {
  timestamp: Date;
  cashBalance: number;
  unrealizedPnl: number;
  equity: number;
  peakEquity: number;
  drawdownPct: number;
  openPositionsCount: number;
}

export interface ReplayRejection {
  thesisId: string;
  symbol: string;
  reason: string;
  timestamp: Date;
}

export interface ReplayMetrics {
  initialBalance: number;
  finalBalance: number;
  finalEquity: number;
  totalReturnPct: number;
  realizedGrossPnl: number;
  realizedNetPnl: number;
  unrealizedPnl: number;
  totalSignedFees: number;
  totalSignedFunding: number;
  totalThesesCount: number;
  executedThesesCount: number;
  unfilledThesesCount: number;
  rejectedThesesCount: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  expectancyNetR: number | null;
  rejections: ReplayRejection[];
}

export interface ExecutionReplayReport {
  outcomes: TradeLifecycleOutcome[];
  events: TradeLifecycleEvent[];
  equityCurve: EquityCurvePoint[];
  metrics: ReplayMetrics;
  executionAssumptions: Required<ReplayExecutionAssumptions>;
  datasetProvenance: {
    source: string;
    symbols: string[];
    startTime: Date;
    endTime: Date;
    totalCandles: number;
    checksum?: string;
    sourceCutoff?: Date;
  };
}

interface ActivePosition {
  thesisId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  size: number;
  initialSize: number;
  entryPrice: number;
  initialStopLoss: number;
  currentStopLoss: number;
  takeProfit?: number;
  openedAt: Date;
  highestMark: number;
  lowestMark: number;
  partialTaken: boolean;
  plan: TradePlan;
  initialRisk?: number;
  thesis: ReplayCandidateThesis;
}

interface PendingThesisState {
  thesis: ReplayCandidateThesis;
  cutoffMs: number;
  eligibleCandlesCount: number;
}

function roundToDecimals(val: number, decimals = 8): number {
  return Number(Math.round(Number(`${val}e${decimals}`)) + `e-${decimals}`);
}

function computeConfigurationHash(
  assumptions: ReplayExecutionAssumptions,
  riskLimits?: Partial<RiskLimits>,
): string {
  const payload = JSON.stringify({ assumptions, riskLimits: riskLimits ?? {} });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function replayExecution(input: ExecutionReplayInput): ExecutionReplayReport {
  const initialBalance = input.initialBalance;
  let cashBalance = initialBalance;

  const defaultLimits: Required<
    Pick<
      RiskLimits,
      | 'maxPositions'
      | 'maxSameDirectionPositions'
      | 'maxExposure'
      | 'riskPerTrade'
      | 'stopLossPct'
      | 'riskRewardRatio'
      | 'estimatedRoundTripCostPct'
    >
  > = {
    maxPositions: 3,
    maxSameDirectionPositions: 2,
    maxExposure: 0.5,
    riskPerTrade: 0.02,
    stopLossPct: 0.05,
    riskRewardRatio: 1.5,
    estimatedRoundTripCostPct: 0.0008,
  };

  const riskLimits = { ...defaultLimits, ...(input.riskLimits ?? {}) };

  const rawAssumptions = input.assumptions ?? {};
  const feeRate = rawAssumptions.feeRate ?? 0.0005;
  const slippageRate = rawAssumptions.slippageRate ?? 0.0002;
  const entryDriftTolerancePct = rawAssumptions.entryDriftTolerancePct ?? 0.005;
  const defaultLimitTtlCandles = rawAssumptions.defaultLimitTtlCandles ?? 2;
  const stopFirstAmbiguity = rawAssumptions.stopFirstAmbiguity !== false;
  const configurationHash =
    rawAssumptions.configurationHash ?? computeConfigurationHash(rawAssumptions, riskLimits);

  const assumptions: Required<ReplayExecutionAssumptions> = {
    feeRate,
    slippageRate,
    entryDriftTolerancePct,
    defaultLimitTtlCandles,
    stopFirstAmbiguity,
    configurationHash,
  };

  // Sort candles chronologically
  const sortedCandles = [...input.candles].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime(),
  );

  // Group candles by timestamp
  const candlesByTime = new Map<number, ReplayCandle[]>();
  for (const candle of sortedCandles) {
    const time = new Date(candle.openTime).getTime();
    const list = candlesByTime.get(time);
    if (!list) {
      candlesByTime.set(time, [candle]);
    } else {
      list.push(candle);
    }
  }

  // Sort funding rates
  const sortedFunding = [...(input.fundingRates ?? [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const processedFundingIndices = new Set<number>();

  const openPositions = new Map<string, ActivePosition>();
  const latestPriceBySymbol = new Map<string, number>();

  let pendingTheses: PendingThesisState[] = input.theses.map((thesis) => ({
    thesis,
    cutoffMs: new Date(thesis.sourceDataCutoff).getTime(),
    eligibleCandlesCount: 0,
  }));

  const events: TradeLifecycleEvent[] = [];
  const rejections: ReplayRejection[] = [];
  const equityCurve: EquityCurvePoint[] = [];

  let peakEquity = initialBalance;
  let maxDrawdownPct = 0;

  const sortedTimestamps = [...candlesByTime.keys()].sort((a, b) => a - b);

  for (const timestamp of sortedTimestamps) {
    const currentCandles = candlesByTime.get(timestamp)!;
    const currentTime = new Date(timestamp);

    // Update latest known price for symbols in this candle bucket
    for (const candle of currentCandles) {
      latestPriceBySymbol.set(candle.symbol, candle.close);
    }

    // A. Apply funding payments/rebates due up to this timestamp
    for (let fIdx = 0; fIdx < sortedFunding.length; fIdx++) {
      if (processedFundingIndices.has(fIdx)) continue;
      const funding = sortedFunding[fIdx]!;
      const fTime = new Date(funding.timestamp).getTime();
      if (fTime <= timestamp) {
        processedFundingIndices.add(fIdx);
        for (const pos of openPositions.values()) {
          if (pos.symbol === funding.symbol) {
            const markPrice = latestPriceBySymbol.get(pos.symbol) ?? pos.entryPrice;
            const notional = pos.size * markPrice;
            // For LONG: rate > 0 is a payment (signedFunding < 0)
            // For SHORT: rate > 0 is a receipt (signedFunding > 0)
            const signedFunding =
              pos.direction === 'LONG'
                ? roundToDecimals(-notional * funding.rate)
                : roundToDecimals(notional * funding.rate);

            cashBalance = roundToDecimals(cashBalance + signedFunding);
            events.push({
              thesisId: pos.thesisId,
              symbol: pos.symbol,
              direction: pos.direction,
              type: 'FUNDING',
              signedFunding,
              funding: signedFunding,
              timestamp: new Date(funding.timestamp),
              configurationHash,
            });
          }
        }
      }
    }

    // B. Pending Theses Execution (Next-Observation Entry in deterministic forward order)
    const nextPendingTheses: PendingThesisState[] = [];
    for (const pending of pendingTheses) {
      const thesis = pending.thesis;
      const matchingCandle = currentCandles.find((c) => c.symbol === thesis.symbol);
      if (!matchingCandle) {
        nextPendingTheses.push(pending);
        continue;
      }

      // NEXT-OBSERVATION ENFORCEMENT:
      // Can ONLY execute on a candle whose openTime is strictly after the cutoff!
      if (timestamp <= pending.cutoffMs) {
        nextPendingTheses.push(pending);
        continue;
      }

      pending.eligibleCandlesCount += 1;
      const ttl = thesis.limitTtlCandles ?? assumptions.defaultLimitTtlCandles;
      const isLimit = thesis.orderType === 'LIMIT';

      // Check TTL for limit orders
      if (isLimit && pending.eligibleCandlesCount > ttl) {
        // Expired without filling
        continue;
      }

      // Check Portfolio Concurrency Limits
      if (openPositions.size >= riskLimits.maxPositions) {
        rejections.push({
          thesisId: thesis.thesisId,
          symbol: thesis.symbol,
          reason: 'MAX_OPEN_POSITIONS_EXCEEDED',
          timestamp: currentTime,
        });
        continue;
      }

      const sameDirPositions = Array.from(openPositions.values()).filter(
        (p) => p.direction === thesis.direction,
      );
      if (sameDirPositions.length >= riskLimits.maxSameDirectionPositions) {
        rejections.push({
          thesisId: thesis.thesisId,
          symbol: thesis.symbol,
          reason: 'MAX_SAME_DIRECTION_POSITIONS_EXCEEDED',
          timestamp: currentTime,
        });
        continue;
      }

      const existingSameSymbol = Array.from(openPositions.values()).find(
        (p) => p.symbol === thesis.symbol,
      );
      const isStagedAdd = Boolean(
        thesis.stagedEntry?.stage === 'CONFIRMED' &&
          existingSameSymbol &&
          existingSameSymbol.direction === thesis.direction,
      );

      if (existingSameSymbol && !isStagedAdd) {
        rejections.push({
          thesisId: thesis.thesisId,
          symbol: thesis.symbol,
          reason: 'PYRAMIDING_NOT_ALLOWED',
          timestamp: currentTime,
        });
        continue;
      }

      // Execution Pricing & Drift Check
      let executedEntryPrice: number | null = null;
      if (!isLimit) {
        // MARKET ORDER
        if (thesis.entryZone) {
          const driftedLong =
            thesis.direction === 'LONG' &&
            matchingCandle.open > thesis.entryZone.upper * (1 + assumptions.entryDriftTolerancePct);
          const driftedShort =
            thesis.direction === 'SHORT' &&
            matchingCandle.open < thesis.entryZone.lower * (1 - assumptions.entryDriftTolerancePct);

          if (driftedLong || driftedShort) {
            rejections.push({
              thesisId: thesis.thesisId,
              symbol: thesis.symbol,
              reason: 'ENTRY_PRICE_DRIFT',
              timestamp: currentTime,
            });
            continue;
          }
        }

        executedEntryPrice =
          thesis.direction === 'LONG'
            ? matchingCandle.open * (1 + assumptions.slippageRate)
            : matchingCandle.open * (1 - assumptions.slippageRate);
      } else {
        // LIMIT ORDER
        const targetLimit =
          thesis.limitPrice ??
          (thesis.direction === 'LONG'
            ? thesis.entryZone?.lower ?? matchingCandle.open
            : thesis.entryZone?.upper ?? matchingCandle.open);

        const limitReached =
          thesis.direction === 'LONG'
            ? matchingCandle.low <= targetLimit
            : matchingCandle.high >= targetLimit;

        if (limitReached) {
          executedEntryPrice =
            thesis.direction === 'LONG'
              ? Math.min(matchingCandle.open, targetLimit) * (1 + assumptions.slippageRate)
              : Math.max(matchingCandle.open, targetLimit) * (1 - assumptions.slippageRate);
        } else {
          // Limit price not reached on this candle
          if (pending.eligibleCandlesCount < ttl) {
            nextPendingTheses.push(pending);
          }
          continue;
        }
      }

      if (executedEntryPrice !== null) {
        executedEntryPrice = roundToDecimals(executedEntryPrice);
        const stopLoss =
          thesis.stopLoss ??
          (thesis.direction === 'LONG' ? executedEntryPrice * 0.95 : executedEntryPrice * 1.05);

        let positionSize =
          thesis.quantity ??
          thesis.size ??
          calculatePositionSize(
            cashBalance,
            riskLimits.riskPerTrade,
            executedEntryPrice,
            stopLoss,
            assumptions.feeRate,
          );

        if (thesis.stagedEntry?.stage === 'PROBE') {
          positionSize *= thesis.stagedEntry.probeSizePct ?? 0.5;
        } else if (thesis.stagedEntry?.stage === 'CONFIRMED') {
          positionSize *= thesis.stagedEntry.confirmationSizePct ?? 0.5;
        }

        positionSize = roundToDecimals(positionSize, 4);

        const currentExposure = Array.from(openPositions.values()).reduce(
          (sum, pos) => sum + pos.size * (latestPriceBySymbol.get(pos.symbol) ?? pos.entryPrice),
          0,
        );
        const maxAllowedExposure = cashBalance * riskLimits.maxExposure;
        const newExposure = currentExposure + positionSize * executedEntryPrice;

        if (newExposure > maxAllowedExposure + 1e-6) {
          rejections.push({
            thesisId: thesis.thesisId,
            symbol: thesis.symbol,
            reason: 'MAX_PORTFOLIO_EXPOSURE_EXCEEDED',
            timestamp: currentTime,
          });
          continue;
        }

        const fee = roundToDecimals(positionSize * executedEntryPrice * assumptions.feeRate);
        cashBalance = roundToDecimals(cashBalance - fee);

        const initialRisk = roundToDecimals(Math.abs(executedEntryPrice - stopLoss) * positionSize);
        const eventType = isStagedAdd ? 'ADD' : 'PROBE';

        events.push({
          thesisId: thesis.thesisId,
          symbol: thesis.symbol,
          provider: thesis.provider ?? 'UNKNOWN',
          timeframe: thesis.timeframe ?? '15m',
          direction: thesis.direction,
          type: eventType,
          price: executedEntryPrice,
          quantity: positionSize,
          signedFee: -fee,
          fee,
          stopLoss,
          initialRisk,
          timestamp: currentTime,
          sourceDataCutoff: new Date(pending.cutoffMs),
          configurationHash,
        });

        const plan: TradePlan = thesis.tradePlan ?? {
          approved: true,
          regime: 'TREND_UP',
          strategy: 'TREND_PULLBACK',
          stopLoss,
          takeProfit: thesis.takeProfit ?? (thesis.targets?.[0]?.price),
          maxHoldingCandles: 8,
          breakEvenAtR: 0.8,
          trailingAtrMultiple: 1.5,
          atr: Math.abs(executedEntryPrice - stopLoss) * 0.8,
          estimatedRoundTripCostPct: assumptions.feeRate * 2,
        };

        if (isStagedAdd && existingSameSymbol) {
          const totalQty = roundToDecimals(existingSameSymbol.size + positionSize);
          const totalNotional =
            existingSameSymbol.size * existingSameSymbol.entryPrice +
            positionSize * executedEntryPrice;
          existingSameSymbol.entryPrice = roundToDecimals(totalNotional / totalQty);
          existingSameSymbol.size = totalQty;
          existingSameSymbol.initialSize = totalQty;
          existingSameSymbol.currentStopLoss = stopLoss;
        } else {
          openPositions.set(thesis.thesisId, {
            thesisId: thesis.thesisId,
            symbol: thesis.symbol,
            direction: thesis.direction,
            size: positionSize,
            initialSize: positionSize,
            entryPrice: executedEntryPrice,
            initialStopLoss: stopLoss,
            currentStopLoss: stopLoss,
            takeProfit: thesis.takeProfit ?? (thesis.targets?.[0]?.price),
            openedAt: currentTime,
            highestMark: matchingCandle.high,
            lowestMark: matchingCandle.low,
            partialTaken: false,
            plan,
            initialRisk,
            thesis,
          });
        }
      }
    }
    pendingTheses = nextPendingTheses;

    // C. Position Management & Exit Evaluation
    for (const candle of currentCandles) {
      const positionsForSymbol = Array.from(openPositions.values()).filter(
        (p) => p.symbol === candle.symbol,
      );

      for (const pos of positionsForSymbol) {
        const isEntryBar = pos.openedAt.getTime() === timestamp;

        // 1. First, check SL and TP breaches on the candle's [low, high]
        // using the ACTIVE stop loss and take profit at the start of the candle
        const slHit =
          pos.direction === 'LONG'
            ? candle.low <= pos.currentStopLoss
            : candle.high >= pos.currentStopLoss;

        const tpHit =
          pos.takeProfit !== undefined &&
          (pos.direction === 'LONG'
            ? candle.high >= pos.takeProfit
            : candle.low <= pos.takeProfit);

        if (slHit && tpHit) {
          // Ambiguous same-candle SL/TP order!
          let trigger: 'SL' | 'TP' = assumptions.stopFirstAmbiguity ? 'SL' : 'TP';

          if (candle.finerQuotes && candle.finerQuotes.length > 0) {
            const sortedQuotes = [...candle.finerQuotes].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
            );
            for (const quote of sortedQuotes) {
              const quoteSl =
                pos.direction === 'LONG'
                  ? quote.price <= pos.currentStopLoss
                  : quote.price >= pos.currentStopLoss;
              const quoteTp =
                pos.direction === 'LONG'
                  ? quote.price >= pos.takeProfit!
                  : quote.price <= pos.takeProfit!;

              if (quoteTp && !quoteSl) {
                trigger = 'TP';
                break;
              }
              if (quoteSl && !quoteTp) {
                trigger = 'SL';
                break;
              }
            }
          }

          if (trigger === 'SL') {
            const exitPrice = roundToDecimals(
              pos.direction === 'LONG'
                ? pos.currentStopLoss * (1 - assumptions.slippageRate)
                : pos.currentStopLoss * (1 + assumptions.slippageRate),
            );
            const grossPnl = roundToDecimals(
              pos.direction === 'LONG'
                ? (exitPrice - pos.entryPrice) * pos.size
                : (pos.entryPrice - exitPrice) * pos.size,
            );
            const fee = roundToDecimals(pos.size * exitPrice * assumptions.feeRate);
            cashBalance = roundToDecimals(cashBalance + grossPnl - fee);

            events.push({
              thesisId: pos.thesisId,
              symbol: pos.symbol,
              direction: pos.direction,
              type: 'FINAL_CLOSE',
              price: exitPrice,
              quantity: pos.size,
              realizedPnl: grossPnl,
              grossPnl,
              signedFee: -fee,
              fee,
              stopLoss: pos.currentStopLoss,
              timestamp: currentTime,
              metadata: { exitReason: 'STOP_LOSS' },
              configurationHash,
            });
            openPositions.delete(pos.thesisId);
            continue;
          } else {
            const exitPrice = roundToDecimals(
              pos.direction === 'LONG'
                ? pos.takeProfit! * (1 - assumptions.slippageRate)
                : pos.takeProfit! * (1 + assumptions.slippageRate),
            );
            const grossPnl = roundToDecimals(
              pos.direction === 'LONG'
                ? (exitPrice - pos.entryPrice) * pos.size
                : (pos.entryPrice - exitPrice) * pos.size,
            );
            const fee = roundToDecimals(pos.size * exitPrice * assumptions.feeRate);
            cashBalance = roundToDecimals(cashBalance + grossPnl - fee);

            events.push({
              thesisId: pos.thesisId,
              symbol: pos.symbol,
              direction: pos.direction,
              type: 'FINAL_CLOSE',
              price: exitPrice,
              quantity: pos.size,
              realizedPnl: grossPnl,
              grossPnl,
              signedFee: -fee,
              fee,
              stopLoss: pos.currentStopLoss,
              timestamp: currentTime,
              metadata: { exitReason: 'TAKE_PROFIT' },
              configurationHash,
            });
            openPositions.delete(pos.thesisId);
            continue;
          }
        } else if (slHit) {
          const exitPrice = roundToDecimals(
            pos.direction === 'LONG'
              ? pos.currentStopLoss * (1 - assumptions.slippageRate)
              : pos.currentStopLoss * (1 + assumptions.slippageRate),
          );
          const grossPnl = roundToDecimals(
            pos.direction === 'LONG'
              ? (exitPrice - pos.entryPrice) * pos.size
              : (pos.entryPrice - exitPrice) * pos.size,
          );
          const fee = roundToDecimals(pos.size * exitPrice * assumptions.feeRate);
          cashBalance = roundToDecimals(cashBalance + grossPnl - fee);

          events.push({
            thesisId: pos.thesisId,
            symbol: pos.symbol,
            direction: pos.direction,
            type: 'FINAL_CLOSE',
            price: exitPrice,
            quantity: pos.size,
            realizedPnl: grossPnl,
            grossPnl,
            signedFee: -fee,
            fee,
            stopLoss: pos.currentStopLoss,
            timestamp: currentTime,
            metadata: { exitReason: 'STOP_LOSS' },
            configurationHash,
          });
          openPositions.delete(pos.thesisId);
          continue;
        } else if (tpHit) {
          const exitPrice = roundToDecimals(
            pos.direction === 'LONG'
              ? pos.takeProfit! * (1 - assumptions.slippageRate)
              : pos.takeProfit! * (1 + assumptions.slippageRate),
          );
          const grossPnl = roundToDecimals(
            pos.direction === 'LONG'
              ? (exitPrice - pos.entryPrice) * pos.size
              : (pos.entryPrice - exitPrice) * pos.size,
          );
          const fee = roundToDecimals(pos.size * exitPrice * assumptions.feeRate);
          cashBalance = roundToDecimals(cashBalance + grossPnl - fee);

          events.push({
            thesisId: pos.thesisId,
            symbol: pos.symbol,
            direction: pos.direction,
            type: 'FINAL_CLOSE',
            price: exitPrice,
            quantity: pos.size,
            realizedPnl: grossPnl,
            grossPnl,
            signedFee: -fee,
            fee,
            stopLoss: pos.currentStopLoss,
            timestamp: currentTime,
            metadata: { exitReason: 'TAKE_PROFIT' },
            configurationHash,
          });
          openPositions.delete(pos.thesisId);
          continue;
        }

        // If on the entry bar, do not run PM trailing stop tightening or partial exit
        if (isEntryBar) {
          continue;
        }

        // 2. Position survived the candle range: evaluate Position Manager at candle close
        const pmResult = evaluatePositionManagement({
          side: pos.direction,
          entryPrice: pos.entryPrice,
          markPrice: candle.close,
          initialStopLoss: pos.initialStopLoss,
          currentStopLoss: pos.currentStopLoss,
          highestMark: Math.max(pos.highestMark, candle.high),
          lowestMark: Math.min(pos.lowestMark, candle.low),
          openedAt: pos.openedAt,
          now: currentTime,
          partialTaken: pos.partialTaken,
          plan: pos.plan,
        });

        pos.highestMark = pmResult.highestMark;
        pos.lowestMark = pmResult.lowestMark;

        // Partial Exit
        if (pmResult.takePartial && !pos.partialTaken && pos.size > 1e-6) {
          const partialQty = roundToDecimals(pos.size * 0.5, 4);
          const exitPrice = roundToDecimals(
            pos.direction === 'LONG'
              ? candle.close * (1 - assumptions.slippageRate)
              : candle.close * (1 + assumptions.slippageRate),
          );
          const grossPnl = roundToDecimals(
            pos.direction === 'LONG'
              ? (exitPrice - pos.entryPrice) * partialQty
              : (pos.entryPrice - exitPrice) * partialQty,
          );
          const fee = roundToDecimals(partialQty * exitPrice * assumptions.feeRate);

          cashBalance = roundToDecimals(cashBalance + grossPnl - fee);
          pos.size = roundToDecimals(pos.size - partialQty, 4);
          pos.partialTaken = true;

          events.push({
            thesisId: pos.thesisId,
            symbol: pos.symbol,
            direction: pos.direction,
            type: 'PARTIAL',
            price: exitPrice,
            quantity: partialQty,
            realizedPnl: grossPnl,
            grossPnl,
            signedFee: -fee,
            fee,
            timestamp: currentTime,
            configurationHash,
          });
        }

        // Stop Tightening (applies to subsequent candles)
        if (pmResult.tightenedStopLoss !== undefined) {
          const improved =
            pos.direction === 'LONG'
              ? pmResult.tightenedStopLoss > pos.currentStopLoss
              : pmResult.tightenedStopLoss < pos.currentStopLoss;
          if (improved) {
            pos.currentStopLoss = roundToDecimals(pmResult.tightenedStopLoss);
            events.push({
              thesisId: pos.thesisId,
              symbol: pos.symbol,
              direction: pos.direction,
              type: 'STOP_TIGHTEN',
              stopLoss: pos.currentStopLoss,
              timestamp: currentTime,
              configurationHash,
            });
          }
        }

        // Wick Retraction Close at candle close
        if (pmResult.wickRetractionClose) {
          const exitPrice = roundToDecimals(
            pos.direction === 'LONG'
              ? candle.close * (1 - assumptions.slippageRate)
              : candle.close * (1 + assumptions.slippageRate),
          );
          const grossPnl = roundToDecimals(
            pos.direction === 'LONG'
              ? (exitPrice - pos.entryPrice) * pos.size
              : (pos.entryPrice - exitPrice) * pos.size,
          );
          const fee = roundToDecimals(pos.size * exitPrice * assumptions.feeRate);
          cashBalance = roundToDecimals(cashBalance + grossPnl - fee);

          events.push({
            thesisId: pos.thesisId,
            symbol: pos.symbol,
            direction: pos.direction,
            type: 'FINAL_CLOSE',
            price: exitPrice,
            quantity: pos.size,
            realizedPnl: grossPnl,
            grossPnl,
            signedFee: -fee,
            fee,
            stopLoss: pos.currentStopLoss,
            timestamp: currentTime,
            metadata: { exitReason: 'WICK_RETRACTION' },
            configurationHash,
          });

          openPositions.delete(pos.thesisId);
          continue;
        }
      }
    }

    // D. Mark-to-market Equity Curve at every candle timestamp
    let unrealizedPnl = 0;
    for (const pos of openPositions.values()) {
      const markPrice = latestPriceBySymbol.get(pos.symbol) ?? pos.entryPrice;
      const posPnl =
        pos.direction === 'LONG'
          ? (markPrice - pos.entryPrice) * pos.size
          : (pos.entryPrice - markPrice) * pos.size;
      unrealizedPnl += posPnl;
    }

    unrealizedPnl = roundToDecimals(unrealizedPnl);
    const currentEquity = roundToDecimals(cashBalance + unrealizedPnl);
    peakEquity = Math.max(peakEquity, currentEquity);
    const drawdownPct = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);

    equityCurve.push({
      timestamp: currentTime,
      cashBalance,
      unrealizedPnl,
      equity: currentEquity,
      peakEquity,
      drawdownPct: roundToDecimals(drawdownPct, 6),
      openPositionsCount: openPositions.size,
    });
  }

  // Finalize any still-open positions at the last available candle close
  const lastTime =
    sortedTimestamps.length > 0
      ? new Date(sortedTimestamps[sortedTimestamps.length - 1]!)
      : new Date();

  for (const pos of openPositions.values()) {
    const markPrice = latestPriceBySymbol.get(pos.symbol) ?? pos.entryPrice;
    const exitPrice = roundToDecimals(
      pos.direction === 'LONG'
        ? markPrice * (1 - assumptions.slippageRate)
        : markPrice * (1 + assumptions.slippageRate),
    );
    const grossPnl = roundToDecimals(
      pos.direction === 'LONG'
        ? (exitPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - exitPrice) * pos.size,
    );
    const fee = roundToDecimals(pos.size * exitPrice * assumptions.feeRate);
    cashBalance = roundToDecimals(cashBalance + grossPnl - fee);

    events.push({
      thesisId: pos.thesisId,
      symbol: pos.symbol,
      direction: pos.direction,
      type: 'FINAL_CLOSE',
      price: exitPrice,
      quantity: pos.size,
      realizedPnl: grossPnl,
      grossPnl,
      signedFee: -fee,
      fee,
      stopLoss: pos.currentStopLoss,
      timestamp: lastTime,
      metadata: { exitReason: 'SIMULATION_END' },
      configurationHash,
    });
  }
  openPositions.clear();

  // Aggregate lifecycles by thesis using domain function
  const outcomes = events.length > 0 ? aggregateLifecyclesByThesis(events) : [];

  // Metrics computation
  const finalBalance = roundToDecimals(cashBalance);
  const finalEquity = finalBalance;
  const totalReturnPct = roundToDecimals(((finalEquity - initialBalance) / initialBalance) * 100, 4);
  const realizedGrossPnl = roundToDecimals(outcomes.reduce((s, o) => s + o.realizedGrossPnl, 0));
  const realizedNetPnl = roundToDecimals(outcomes.reduce((s, o) => s + o.realizedNetPnl, 0));
  const totalSignedFees = roundToDecimals(outcomes.reduce((s, o) => s + o.signedFees, 0));
  const totalSignedFunding = roundToDecimals(outcomes.reduce((s, o) => s + o.signedFunding, 0));

  const winCount = outcomes.filter((o) => o.realizedNetPnl > 0).length;
  const winRate = outcomes.length > 0 ? roundToDecimals((winCount / outcomes.length) * 100, 2) : 0;

  const grossWins = outcomes
    .filter((o) => o.realizedNetPnl > 0)
    .reduce((s, o) => s + o.realizedNetPnl, 0);
  const grossLosses = Math.abs(
    outcomes.filter((o) => o.realizedNetPnl < 0).reduce((s, o) => s + o.realizedNetPnl, 0),
  );
  const profitFactor =
    grossLosses > 0
      ? roundToDecimals(grossWins / grossLosses, 4)
      : grossWins > 0
        ? 999
        : 0;

  const netRValues = outcomes.flatMap((o) => (o.netR !== null ? [o.netR] : []));
  const expectancyNetR =
    netRValues.length > 0
      ? roundToDecimals(netRValues.reduce((s, v) => s + v, 0) / netRValues.length, 4)
      : null;

  const executedThesesCount = outcomes.length;
  const unfilledThesesCount = Math.max(0, input.theses.length - executedThesesCount - rejections.length);

  const metrics: ReplayMetrics = {
    initialBalance,
    finalBalance,
    finalEquity,
    totalReturnPct,
    realizedGrossPnl,
    realizedNetPnl,
    unrealizedPnl: 0,
    totalSignedFees,
    totalSignedFunding,
    totalThesesCount: input.theses.length,
    executedThesesCount,
    unfilledThesesCount,
    rejectedThesesCount: rejections.length,
    winRate,
    profitFactor,
    maxDrawdownPct: roundToDecimals(maxDrawdownPct, 4),
    expectancyNetR,
    rejections,
  };

  const startTime =
    sortedCandles.length > 0
      ? new Date(sortedCandles[0]!.openTime)
      : new Date(input.provenance?.startTime ?? Date.now());
  const endTime =
    sortedCandles.length > 0
      ? new Date(sortedCandles[sortedCandles.length - 1]!.openTime)
      : new Date(input.provenance?.endTime ?? Date.now());

  const symbols = input.provenance?.symbols ?? [
    ...new Set(sortedCandles.map((c) => c.symbol)),
  ];

  return {
    outcomes,
    events,
    equityCurve,
    metrics,
    executionAssumptions: assumptions,
    datasetProvenance: {
      source: input.provenance?.source ?? 'HISTORICAL_EXCHANGE_DATA',
      symbols,
      startTime,
      endTime,
      totalCandles: sortedCandles.length,
      checksum: input.provenance?.checksum,
      sourceCutoff: input.provenance?.sourceCutoff ? new Date(input.provenance.sourceCutoff) : undefined,
    },
  };
}
