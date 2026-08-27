import type {
  MarketAgentOutput,
  TechnicalAgentOutput,
} from "@platform/shared";
import { mapMacdTrend, mapRsiState } from "./technical-indicator-mapper";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

function rows(value: unknown, key: string): UnknownRecord[] {
  const items = record(value)?.[key];
  return Array.isArray(items)
    ? items.flatMap((item) => (record(item) ? [record(item)!] : []))
    : [];
}

function latestCandle(toolData: Readonly<UnknownRecord>): UnknownRecord | undefined {
  return rows(toolData["market.candles.list"], "candles").at(-1);
}

function trendFromAverages(price?: number, ema20?: number, ema50?: number) {
  if (price === undefined || ema20 === undefined || ema50 === undefined) {
    return { direction: "SIDEWAYS" as const, strength: "WEAK" as const };
  }
  const direction = price > ema20 && ema20 >= ema50
    ? ("UP" as const)
    : price < ema20 && ema20 <= ema50
      ? ("DOWN" as const)
      : ("SIDEWAYS" as const);
  const separationPct = Math.abs(ema20 - ema50) /
    Math.max(Math.abs(price), Number.EPSILON) * 100;
  const strength = direction === "SIDEWAYS" || separationPct < 0.08
    ? ("WEAK" as const)
    : separationPct >= 0.35
      ? ("STRONG" as const)
      : ("MODERATE" as const);
  return { direction, strength };
}

function trendOfHistory(items: UnknownRecord[], key: string) {
  const current = finite(items[0]?.[key]);
  const previous = finite(items[1]?.[key]);
  if (current === undefined || previous === undefined) return "STABLE" as const;
  const change = current - previous;
  const tolerance = Math.max(Math.abs(previous) * 0.0025, Number.EPSILON);
  return change > tolerance
    ? ("INCREASING" as const)
    : change < -tolerance
      ? ("DECREASING" as const)
      : ("STABLE" as const);
}

function orderBookImbalance(value: unknown) {
  const book = record(value);
  const sum = (levels: unknown): number => Array.isArray(levels)
    ? levels.reduce<number>((total, level: unknown) => {
        if (!Array.isArray(level)) return total;
        return total + (finite(level[1]) ?? 0);
      }, 0)
    : 0;
  const bidSize = sum(book?.bids);
  const askSize = sum(book?.asks);
  if (!(bidSize > 0) || !(askSize > 0)) return undefined;
  const ratio = bidSize / askSize;
  return ratio >= 1.2
    ? ("BUY_HEAVY" as const)
    : ratio <= 1 / 1.2
      ? ("SELL_HEAVY" as const)
      : ("BALANCED" as const);
}

function orderBookSpread(value: unknown): string | undefined {
  const book = record(value);
  const bestBid = Array.isArray(book?.bids) && Array.isArray(book.bids[0])
    ? finite(book.bids[0][0])
    : undefined;
  const bestAsk = Array.isArray(book?.asks) && Array.isArray(book.asks[0])
    ? finite(book.asks[0][0])
    : undefined;
  if (bestBid === undefined || bestAsk === undefined || bestAsk <= bestBid) return undefined;
  const midpoint = (bestBid + bestAsk) / 2;
  return `${(((bestAsk - bestBid) / midpoint) * 100).toFixed(4)}%`;
}

export function deterministicMarketAnalysis(
  toolData: Readonly<UnknownRecord>,
  usedTools: string[],
): MarketAgentOutput | undefined {
  const ticker = record(toolData["market.ticker.get"]);
  const indicators = record(toolData["market.indicators.get"]);
  const candle = latestCandle(toolData);
  const price = finite(ticker?.price) ?? finite(candle?.close);
  const ema20 = finite(indicators?.ema20);
  const ema50 = finite(indicators?.ema50);
  if (price === undefined || (!indicators && !candle)) return undefined;

  const trend = trendFromAverages(price, ema20, ema50);
  const atr = finite(indicators?.atr);
  const atrPct = atr === undefined ? undefined : atr / price * 100;
  const volatilityLevel = atrPct === undefined
    ? ("MEDIUM" as const)
    : atrPct >= 1.5
      ? ("HIGH" as const)
      : atrPct <= 0.2
        ? ("LOW" as const)
        : ("MEDIUM" as const);
  const funding = record(toolData["market.funding.get"]);
  const openInterest = record(toolData["market.open_interest.get"]);
  const fundingHistory = Array.isArray(funding?.history)
    ? funding.history.flatMap((item) => (record(item) ? [record(item)!] : []))
    : [];
  const oiHistory = Array.isArray(openInterest?.history)
    ? openInterest.history.flatMap((item) => (record(item) ? [record(item)!] : []))
    : [];
  const fundingRate = scalarText(funding?.fundingRate);
  const openInterestValue = scalarText(openInterest?.openInterest);
  const usableTools = usedTools.filter((tool): tool is MarketAgentOutput["usedTools"][number] =>
    [
      "market.ticker.get",
      "market.candles.list",
      "market.indicators.get",
      "market.funding.get",
      "market.open_interest.get",
      "market.order_book.get",
    ].includes(tool),
  );
  const hasCoreSet = Boolean(ticker && indicators && candle);

  return {
    summary: `Deterministic market evidence places price ${trend.direction === "UP" ? "above bullish" : trend.direction === "DOWN" ? "below bearish" : "inside mixed"} EMA20/EMA50 structure with ${volatilityLevel.toLowerCase()} ATR volatility.`,
    trend,
    volatility: {
      level: volatilityLevel,
      ...(atr !== undefined ? { atr: String(atr) } : {}),
    },
    liquidity: {
      ...(orderBookSpread(toolData["market.order_book.get"])
        ? { bidAskSpread: orderBookSpread(toolData["market.order_book.get"]) }
        : {}),
      ...(orderBookImbalance(toolData["market.order_book.get"])
        ? { depthImbalance: orderBookImbalance(toolData["market.order_book.get"]) }
        : {}),
    },
    derivatives: {
      ...(fundingRate !== undefined
        ? { fundingRate, fundingTrend: trendOfHistory(fundingHistory, "rate") }
        : {}),
      ...(openInterestValue !== undefined
        ? { openInterest: openInterestValue, oiTrend: trendOfHistory(oiHistory, "value") }
        : {}),
    },
    anomalies: hasCoreSet ? [] : ["Deterministic market fallback is operating with partial tool coverage."],
    dataQuality: hasCoreSet ? "GOOD" : "PARTIAL",
    usedTools: usableTools,
    generatedAt: new Date().toISOString(),
  };
}

export function deterministicTechnicalAnalysis(
  toolData: Readonly<UnknownRecord>,
  usedTools: string[],
): TechnicalAgentOutput | undefined {
  const indicators = record(toolData["market.indicators.get"]);
  const candles = rows(toolData["market.candles.list"], "candles");
  const current = candles.at(-1);
  const price = finite(current?.close);
  const ema20 = finite(indicators?.ema20);
  const ema50 = finite(indicators?.ema50);
  const rsi = finite(indicators?.rsi);
  const macdHistogram = finite(indicators?.macdHistogram);
  const atr = finite(indicators?.atr);
  if (!indicators || price === undefined || ema20 === undefined || ema50 === undefined) return undefined;

  const trend = trendFromAverages(price, ema20, ema50);
  const alignment = ema20 > ema50
    ? ("BULLISH" as const)
    : ema20 < ema50
      ? ("BEARISH" as const)
      : ("MIXED" as const);
  const pricePosition = price > Math.max(ema20, ema50)
    ? ("ABOVE" as const)
    : price < Math.min(ema20, ema50)
      ? ("BELOW" as const)
      : ("INSIDE" as const);
  const prior = candles.slice(-21, -1);
  const priorHigh = prior.length ? Math.max(...prior.map((item) => finite(item.high) ?? -Infinity)) : undefined;
  const priorLow = prior.length ? Math.min(...prior.map((item) => finite(item.low) ?? Infinity)) : undefined;
  const bullishBreakout = priorHigh !== undefined && Number.isFinite(priorHigh) && price > priorHigh;
  const bearishBreakout = priorLow !== undefined && Number.isFinite(priorLow) && price < priorLow;
  const breakout = bullishBreakout || bearishBreakout;
  const marketStructure = trend.direction === "UP"
    ? ("HH_HL" as const)
    : trend.direction === "DOWN"
      ? ("LH_LL" as const)
      : ("RANGE" as const);
  const signals = [
    `Price is ${pricePosition.toLowerCase()} EMA20 and EMA50.`,
    `${alignment.toLowerCase()} moving-average alignment is derived from verified indicators.`,
    `RSI is ${rsi === undefined ? "unavailable" : rsi.toFixed(2)} and MACD momentum is ${mapMacdTrend(macdHistogram ?? 0).toLowerCase()}.`,
    ...(breakout ? [`Price closed beyond the previous ${prior.length}-candle range.`] : []),
  ];
  const usableTools = usedTools.filter((tool): tool is TechnicalAgentOutput["usedTools"][number] =>
    tool === "market.indicators.get" || tool === "market.candles.list",
  );

  return {
    summary: `Deterministic technical analysis identifies a ${trend.strength.toLowerCase()} ${trend.direction.toLowerCase()} trend from price, EMA, RSI and MACD evidence.`,
    trend,
    momentum: {
      rsi: rsi === undefined ? "Unavailable" : rsi.toFixed(2),
      rsiState: mapRsiState(rsi ?? NaN),
      macd: { trend: mapMacdTrend(macdHistogram ?? 0), crossover: "NONE" },
    },
    movingAverages: { alignment, pricePosition },
    volatility: {
      ...(atr !== undefined ? { atr: String(atr) } : {}),
      bollinger: { position: "MIDDLE", squeeze: false },
    },
    structure: { marketStructure, breakout },
    divergence: { rsiDivergence: "NONE", macdDivergence: "NONE" },
    signals,
    dataQuality: candles.length >= 20 ? "GOOD" : "PARTIAL",
    usedTools: usableTools,
    generatedAt: new Date().toISOString(),
  };
}
