import { Injectable } from "@nestjs/common";
import { adaptiveTradingPolicy } from "../domain/adaptive-trading-policy";

export interface SignalFilterInput {
  rsi?: number;
  atr?: number;
  volumeChangePercent?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  breakout?: boolean;
  price?: number;
  symbol?: string;
  provider?: "BINANCE_FUTURES" | "OKX_FUTURES";
  timeframe?: string;
  spreadBps?: number;
  adx?: number;
  efficiencyRatio?: number;
  marketRegime?: "TRENDING" | "RANGING" | "HIGH_VOLATILITY";
}

export interface SignalFilterResult {
  allowed: boolean;
  reason?: "NO_TRADE_ZONE" | "LOW_ATR" | "NO_TREND" | "INSUFFICIENT_INDICATORS" | "WIDE_SPREAD" | "SYMBOL_REQUIRED";
  preliminaryRegime: "TRENDING" | "RANGING" | "BREAKOUT" | "UNCLASSIFIED";
}

@Injectable()
export class SignalFilterService {
  evaluate(input: SignalFilterInput): SignalFilterResult {
    if (!input.symbol) {
      return { allowed: false, reason: "SYMBOL_REQUIRED", preliminaryRegime: "UNCLASSIFIED" };
    }
    const policy = adaptiveTradingPolicy({
      symbol: input.symbol,
      provider: input.provider,
      timeframe: input.timeframe,
      regime: input.marketRegime,
      spreadBps: input.spreadBps,
    });
    const rsi = input.rsi === undefined ? NaN : Number(input.rsi);
    const atr = input.atr === undefined ? NaN : Number(input.atr);
    const volumeChange =
      input.volumeChangePercent === undefined
        ? NaN
        : Number(input.volumeChangePercent);
    const ema20 = input.ema20 === undefined ? NaN : Number(input.ema20);
    const ema50 = input.ema50 === undefined ? NaN : Number(input.ema50);
    const ema200 = input.ema200 === undefined ? NaN : Number(input.ema200);
    const adx = input.adx === undefined ? NaN : Number(input.adx);
    const efficiencyRatio = input.efficiencyRatio === undefined
      ? NaN
      : Number(input.efficiencyRatio);

    const hasAnyIndicatorData = [
      input.rsi,
      input.atr,
      input.volumeChangePercent,
      input.ema20,
      input.ema50,
      input.ema200,
      input.adx,
      input.efficiencyRatio,
    ].some((value) => value !== undefined && Number.isFinite(Number(value)));

    const explicitPrice =
      input.price !== undefined && input.price > 0
        ? Number(input.price)
        : undefined;

    const effectiveMinAtr =
      explicitPrice !== undefined
        ? Math.max(Number.EPSILON, explicitPrice * (policy.minAtrPercent / 100))
        : 25;

    const isLowAtr = Number.isFinite(atr) && atr < effectiveMinAtr;

    const hasRsiNeutralZone = Number.isFinite(rsi) && rsi >= 45 && rsi <= 55;
    const lowVolume =
      Number.isFinite(volumeChange) &&
      volumeChange < policy.minVolumeChangePercent;

    const quantitativelyRanging =
      (Number.isFinite(adx) && adx < 18) ||
      (Number.isFinite(efficiencyRatio) && efficiencyRatio < 0.25);
    const quantitativelyTrending =
      Number.isFinite(adx) && adx >= 22 &&
      Number.isFinite(efficiencyRatio) && efficiencyRatio >= 0.3;
    const preliminaryRegime = input.breakout
      ? "BREAKOUT"
      : quantitativelyTrending
        ? "TRENDING"
        : quantitativelyRanging || input.marketRegime === "RANGING"
          ? "RANGING"
          : input.marketRegime === "TRENDING"
            ? "TRENDING"
            : "UNCLASSIFIED";

    if (input.spreadBps !== undefined && input.spreadBps > policy.maxSpreadBps) {
      return { allowed: false, reason: "WIDE_SPREAD", preliminaryRegime };
    }

    if (
      hasAnyIndicatorData &&
      ((hasRsiNeutralZone && isLowAtr && lowVolume) ||
        (quantitativelyRanging && hasRsiNeutralZone && lowVolume))
    ) {
      return { allowed: false, reason: "NO_TRADE_ZONE", preliminaryRegime };
    }

    if (isLowAtr) {
      return { allowed: false, reason: "LOW_ATR", preliminaryRegime };
    }

    if (!hasAnyIndicatorData) {
      return { allowed: false, reason: "INSUFFICIENT_INDICATORS", preliminaryRegime };
    }

    // Flat moving averages are expected in a range. Once ADX/efficiency ratio
    // identify that regime, let the downstream range-entry and R:R guards decide.
    if (preliminaryRegime === "RANGING") return { allowed: true, preliminaryRegime };

    const hasTrend =
      quantitativelyTrending ||
      (Number.isFinite(ema20) && Number.isFinite(ema50) &&
        Math.abs(ema20 - ema50) / Math.max(Math.abs(ema50), Number.EPSILON) >= 0.0005) ||
      (Number.isFinite(ema20) && Number.isFinite(ema200) &&
        Math.abs(ema20 - ema200) / Math.max(Math.abs(ema200), Number.EPSILON) >= 0.0005) ||
      input.breakout === true;

    if (!hasTrend) {
      return { allowed: false, reason: "NO_TREND", preliminaryRegime };
    }

    return { allowed: true, preliminaryRegime };
  }
}
