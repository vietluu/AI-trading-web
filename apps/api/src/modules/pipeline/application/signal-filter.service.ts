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
  marketRegime?: "TRENDING" | "RANGING" | "HIGH_VOLATILITY";
}

export interface SignalFilterResult {
  allowed: boolean;
  reason?: "NO_TRADE_ZONE" | "LOW_ATR" | "NO_TREND" | "INSUFFICIENT_INDICATORS" | "WIDE_SPREAD";
}

@Injectable()
export class SignalFilterService {
  evaluate(input: SignalFilterInput): SignalFilterResult {
    const policy = adaptiveTradingPolicy({
      symbol: input.symbol ?? "BTC-USDT",
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

    const hasAnyIndicatorData = [
      input.rsi,
      input.atr,
      input.volumeChangePercent,
      input.ema20,
      input.ema50,
      input.ema200,
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

    if (input.spreadBps !== undefined && input.spreadBps > policy.maxSpreadBps) {
      return { allowed: false, reason: "WIDE_SPREAD" };
    }

    if (hasAnyIndicatorData && hasRsiNeutralZone && isLowAtr && lowVolume) {
      return { allowed: false, reason: "NO_TRADE_ZONE" };
    }

    if (isLowAtr) {
      return { allowed: false, reason: "LOW_ATR" };
    }

    if (!hasAnyIndicatorData) {
      return { allowed: false, reason: "INSUFFICIENT_INDICATORS" };
    }

    const hasTrend =
      (Number.isFinite(ema20) && Number.isFinite(ema50) && Math.abs(ema20 - ema50) > 0.0001) ||
      (Number.isFinite(ema20) && Number.isFinite(ema200) && Math.abs(ema20 - ema200) > 0.0001) ||
      input.breakout === true;

    if (!hasTrend) {
      return { allowed: false, reason: "NO_TREND" };
    }

    return { allowed: true };
  }
}
