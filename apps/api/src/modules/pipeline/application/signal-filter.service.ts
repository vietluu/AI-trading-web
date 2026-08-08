import { Injectable } from "@nestjs/common";

export interface SignalFilterInput {
  rsi?: number;
  atr?: number;
  volumeChangePercent?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  breakout?: boolean;
  price?: number;
}

export interface SignalFilterResult {
  allowed: boolean;
  reason?: "NO_TRADE_ZONE" | "LOW_ATR" | "NO_TREND" | "INSUFFICIENT_INDICATORS";
}

@Injectable()
export class SignalFilterService {
  private readonly minAtrAbsolute = 25;
  private readonly minAtrPercent = 0.1; // 0.1% min relative volatility
  private readonly minVolumeChangePercent = 1.2;

  evaluate(input: SignalFilterInput): SignalFilterResult {
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
        ? Math.min(this.minAtrAbsolute, Math.max(0.1, explicitPrice * (this.minAtrPercent / 100)))
        : this.minAtrAbsolute;

    const isLowAtr = Number.isFinite(atr) && atr < effectiveMinAtr;

    const hasRsiNeutralZone = Number.isFinite(rsi) && rsi >= 45 && rsi <= 55;
    const lowVolume =
      Number.isFinite(volumeChange) &&
      volumeChange < this.minVolumeChangePercent;

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
