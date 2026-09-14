const SUPPORTED_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

export type PipelineTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];
export type TimeframeTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';

export interface TimeframeIndicatorInput {
  timeframe: string;
  close?: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
  isClosed?: boolean;
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
    isClosed?: boolean;
  }>;
  directionalFrames: number;
  bullishWeight: number;
  bearishWeight: number;
  bullishConfirmation: number;
  bearishConfirmation: number;
  normalEntryConfirmed?: boolean;
  probeEligible?: boolean;
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
      ...(input.isClosed !== undefined ? { isClosed: input.isClosed } : {}),
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

export interface EvaluateMultiTimeframeConfirmationInput {
  direction: 'LONG' | 'SHORT' | 'WAIT';
  primaryTimeframe: PipelineTimeframe;
  frames: Array<{
    timeframe: PipelineTimeframe;
    trend: TimeframeTrend;
    weight: number;
    isClosed?: boolean;
    close?: number;
    ema20?: number;
    ema50?: number;
    rsi?: number;
  }>;
}

export interface MultiTimeframeConfirmationResult {
  normalEntryConfirmed: boolean;
  probeEligible: boolean;
  directionalFrames: number;
  bullishWeight: number;
  bearishWeight: number;
  bullishConfirmation: number;
  bearishConfirmation: number;
  allowed: boolean;
  reason?: 'MULTI_TIMEFRAME_CONFLICT' | 'HIGHER_TIMEFRAME_OVERBOUGHT' | 'HIGHER_TIMEFRAME_OVERSOLD';
  confirmation: number;
}

export function evaluateMultiTimeframeConfirmation(
  input: EvaluateMultiTimeframeConfirmationInput,
): MultiTimeframeConfirmationResult {
  const primaryFrame = input.frames.find((f) => f.timeframe === input.primaryTimeframe);
  const isPrimaryClosed = primaryFrame?.isClosed !== false;

  let bullishWeight = 0;
  let bearishWeight = 0;
  let directionalFrames = 0;

  for (const frame of input.frames) {
    if (frame.trend === 'BULLISH') {
      bullishWeight += frame.weight;
      directionalFrames += 1;
    } else if (frame.trend === 'BEARISH') {
      bearishWeight += frame.weight;
      directionalFrames += 1;
    }
  }

  const directionalWeight = bullishWeight + bearishWeight;
  const bullishConfirmation = confirmation(bullishWeight, directionalWeight);
  const bearishConfirmation = confirmation(bearishWeight, directionalWeight);

  const analysis: MultiTimeframeAnalysis = {
    primaryTimeframe: input.primaryTimeframe,
    frames: input.frames.map((f) => ({
      timeframe: f.timeframe,
      trend: f.trend,
      weight: f.weight,
      close: f.close,
      ema20: f.ema20,
      ema50: f.ema50,
      rsi: f.rsi,
      isClosed: f.isClosed,
    })),
    directionalFrames,
    bullishWeight,
    bearishWeight,
    bullishConfirmation,
    bearishConfirmation,
  };

  const decisionEval = evaluateMultiTimeframeDecision(input.direction, analysis);

  const directionMatchesTrend =
    (input.direction === 'LONG' && bullishConfirmation > 40) ||
    (input.direction === 'SHORT' && bearishConfirmation > 40);

  const normalEntryConfirmed = isPrimaryClosed && decisionEval.allowed && directionMatchesTrend;
  const probeEligible = decisionEval.allowed && directionMatchesTrend;

  return {
    normalEntryConfirmed,
    probeEligible,
    directionalFrames,
    bullishWeight,
    bearishWeight,
    bullishConfirmation,
    bearishConfirmation,
    allowed: decisionEval.allowed,
    reason: decisionEval.reason,
    confirmation: decisionEval.confirmation,
  };
}

export function evaluateMultiTimeframeDecision(
  decision: 'LONG' | 'SHORT' | 'WAIT',
  analysis: MultiTimeframeAnalysis,
): { allowed: boolean; reason?: 'MULTI_TIMEFRAME_CONFLICT' | 'HIGHER_TIMEFRAME_OVERBOUGHT' | 'HIGHER_TIMEFRAME_OVERSOLD'; confirmation: number } {
  const confirmation = decision === 'LONG'
    ? analysis.bullishConfirmation
    : decision === 'SHORT'
      ? analysis.bearishConfirmation
      : 0;
  if (decision === 'WAIT') {
    return { allowed: true, confirmation };
  }

  // Check Higher-Timeframe RSI Exhaustion (1h, 4h, 1d)
  for (const frame of analysis.frames) {
    const isHigherTf = frame.timeframe === '1h' || frame.timeframe === '4h' || frame.timeframe === '1d';
    if (isHigherTf && frame.rsi !== undefined) {
      if (decision === 'LONG') {
        const overboughtThreshold = frame.timeframe === '1h' ? 75 : 78;
        if (frame.rsi >= overboughtThreshold) {
          return { allowed: false, reason: 'HIGHER_TIMEFRAME_OVERBOUGHT', confirmation };
        }
      } else if (decision === 'SHORT') {
        const oversoldThreshold = frame.timeframe === '1h' ? 25 : 22;
        if (frame.rsi <= oversoldThreshold) {
          return { allowed: false, reason: 'HIGHER_TIMEFRAME_OVERSOLD', confirmation };
        }
      }
    }
  }

  if (analysis.directionalFrames < 2) {
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
