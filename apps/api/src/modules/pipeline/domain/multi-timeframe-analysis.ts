const SUPPORTED_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

export type PipelineTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];
export type TimeframeTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';

export interface TimeframeIndicatorInput {
  timeframe: string;
  close?: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
}

export interface MultiTimeframeAnalysis {
  primaryTimeframe: PipelineTimeframe;
  frames: Array<{
    timeframe: PipelineTimeframe;
    trend: TimeframeTrend;
    weight: number;
    close?: number;
    ema20?: number;
    ema50?: number;
    rsi?: number;
  }>;
  directionalFrames: number;
  bullishWeight: number;
  bearishWeight: number;
  bullishConfirmation: number;
  bearishConfirmation: number;
}

export function selectPipelineTimeframes(
  explicit: unknown,
  preferred: readonly string[] | undefined,
  fallback = '15m',
): { primary: PipelineTimeframe; selected: PipelineTimeframe[] } {
  const valid = (value: unknown): value is PipelineTimeframe =>
    typeof value === 'string' && (SUPPORTED_TIMEFRAMES as readonly string[]).includes(value);
  const unique = [...new Set((preferred ?? []).filter(valid))];
  const fallbackTimeframe = valid(fallback) ? fallback : '15m';
  const explicitTimeframe = valid(explicit) ? explicit : undefined;
  if (explicitTimeframe && !unique.includes(explicitTimeframe)) unique.push(explicitTimeframe);
  if (unique.length === 0) unique.push(explicitTimeframe ?? fallbackTimeframe);
  unique.sort((left, right) => timeframeMs(left) - timeframeMs(right));
  const primary = explicitTimeframe ?? (unique.includes('15m') ? '15m' : unique[0]!);
  return { primary, selected: unique };
}

export function analyzeMultiTimeframe(
  primaryTimeframe: PipelineTimeframe,
  inputs: readonly TimeframeIndicatorInput[],
): MultiTimeframeAnalysis {
  const ordered = [...inputs]
    .filter((input): input is TimeframeIndicatorInput & { timeframe: PipelineTimeframe } =>
      (SUPPORTED_TIMEFRAMES as readonly string[]).includes(input.timeframe),
    )
    .sort((left, right) => timeframeMs(left.timeframe) - timeframeMs(right.timeframe));
  let bullishWeight = 0;
  let bearishWeight = 0;
  let directionalFrames = 0;
  const frames = ordered.map((input, index) => {
    const weight = index + 1;
    const trend = classifyTrend(input);
    if (trend === 'BULLISH') {
      bullishWeight += weight;
      directionalFrames += 1;
    } else if (trend === 'BEARISH') {
      bearishWeight += weight;
      directionalFrames += 1;
    }
    return {
      timeframe: input.timeframe,
      trend,
      weight,
      ...(finite(input.close) ? { close: input.close } : {}),
      ...(finite(input.ema20) ? { ema20: input.ema20 } : {}),
      ...(finite(input.ema50) ? { ema50: input.ema50 } : {}),
      ...(finite(input.rsi) ? { rsi: input.rsi } : {}),
    };
  });
  const directionalWeight = bullishWeight + bearishWeight;
  return {
    primaryTimeframe,
    frames,
    directionalFrames,
    bullishWeight,
    bearishWeight,
    bullishConfirmation: confirmation(bullishWeight, directionalWeight),
    bearishConfirmation: confirmation(bearishWeight, directionalWeight),
  };
}

export function evaluateMultiTimeframeDecision(
  decision: 'LONG' | 'SHORT' | 'WAIT',
  analysis: MultiTimeframeAnalysis,
): { allowed: boolean; reason?: 'MULTI_TIMEFRAME_CONFLICT'; confirmation: number } {
  const confirmation = decision === 'LONG'
    ? analysis.bullishConfirmation
    : decision === 'SHORT'
      ? analysis.bearishConfirmation
      : 0;
  if (decision === 'WAIT' || analysis.directionalFrames < 2) {
    return { allowed: true, confirmation };
  }
  return confirmation <= 40
    ? { allowed: false, reason: 'MULTI_TIMEFRAME_CONFLICT', confirmation }
    : { allowed: true, confirmation };
}

function classifyTrend(input: TimeframeIndicatorInput): TimeframeTrend {
  if (!finite(input.close) || !finite(input.ema20) || !finite(input.ema50)) return 'UNAVAILABLE';
  if (input.close > input.ema20 && input.ema20 >= input.ema50) return 'BULLISH';
  if (input.close < input.ema20 && input.ema20 <= input.ema50) return 'BEARISH';
  return 'NEUTRAL';
}

function confirmation(weight: number, total: number): number {
  return total > 0 ? Math.round((weight / total) * 100) : 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function timeframeMs(timeframe: PipelineTimeframe): number {
  const value = Number.parseInt(timeframe, 10);
  if (timeframe.endsWith('m')) return value * 60_000;
  if (timeframe.endsWith('h')) return value * 3_600_000;
  return value * 86_400_000;
}
