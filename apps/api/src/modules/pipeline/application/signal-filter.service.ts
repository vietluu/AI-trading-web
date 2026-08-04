import { Injectable } from "@nestjs/common";

export interface SignalFilterInput {
  rsi?: number;
  atr?: number;
  volumeChangePercent?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  breakout?: boolean;
}

export interface SignalFilterResult {
  allowed: boolean;
  reason?: "NO_TRADE_ZONE" | "LOW_ATR" | "NO_TREND";
}

@Injectable()
export class SignalFilterService {
  private readonly minAtr = 25;
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

    const hasRsiNeutralZone = Number.isFinite(rsi) && rsi >= 45 && rsi <= 55;
    const lowVol = Number.isFinite(atr) && atr < this.minAtr;
    const lowVolume =
      Number.isFinite(volumeChange) &&
      volumeChange < this.minVolumeChangePercent;

    if (hasAnyIndicatorData && hasRsiNeutralZone && lowVol && lowVolume) {
      return { allowed: false, reason: "NO_TRADE_ZONE" };
    }

    if (Number.isFinite(atr) && atr < this.minAtr) {
      return { allowed: false, reason: "LOW_ATR" };
    }

    if (!hasAnyIndicatorData) {
      return { allowed: true };
    }

    const hasTrend =
      (Number.isFinite(ema20) && Number.isFinite(ema50) && ema20 > ema50) ||
      (Number.isFinite(ema20) && Number.isFinite(ema200) && ema20 > ema200) ||
      input.breakout === true;

    if (!hasTrend) {
      return { allowed: false, reason: "NO_TREND" };
    }

    return { allowed: true };
  }
}
