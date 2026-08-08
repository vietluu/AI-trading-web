import type {
  ExchangeInterval,
  ExchangeProvider,
} from "../../exchange/domain/exchange.types";
import type {
  IndicatorStatus,
  MarketEventType,
  MarketStreamState,
} from "./market-data.enums";

export interface MarketEventMetadata {
  eventId: string;
  provider: ExchangeProvider;
  symbol: string;
  exchangeTimestamp: Date;
  receivedAt: Date;
  sequence?: string;
  sourceChannel: string;
  schemaVersion: number;
}

export interface NormalizedTicker {
  provider: ExchangeProvider;
  symbol: string;
  lastPrice: string;
  markPrice?: string;
  indexPrice?: string;
  bidPrice?: string;
  askPrice?: string;
  bidQuantity?: string;
  askQuantity?: string;
  high24h?: string;
  low24h?: string;
  volume24h?: string;
  quoteVolume24h?: string;
  priceChange24h?: string;
  priceChangePercent24h?: string;
  timestamp: Date;
}

export interface NormalizedCandle {
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  openTime: Date;
  closeTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume?: string;
  tradeCount?: number;
  isClosed: boolean;
}

export interface NormalizedTrade {
  provider: ExchangeProvider;
  symbol: string;
  tradeId: string;
  price: string;
  quantity: string;
  side: "BUY" | "SELL";
  timestamp: Date;
}

export interface NormalizedOrderBookLevel {
  price: string;
  quantity: string;
}

export interface NormalizedOrderBook {
  provider: ExchangeProvider;
  symbol: string;
  bids: NormalizedOrderBookLevel[];
  asks: NormalizedOrderBookLevel[];
  timestamp: Date;
  depth: number;
}

export interface NormalizedFundingRate {
  provider: ExchangeProvider;
  symbol: string;
  fundingRate: string;
  fundingTime: Date;
  nextFundingTime?: Date;
  markPrice?: string;
}

export interface NormalizedOpenInterest {
  provider: ExchangeProvider;
  symbol: string;
  openInterest: string;
  openInterestValue?: string;
  timestamp: Date;
}

export interface MarketStreamStatus {
  provider: ExchangeProvider;
  state: MarketStreamState;
  connectedAt?: Date;
  lastMessageAt?: Date;
  activeSubscriptions: number;
  reconnectCount: number;
  lastReconnectAt?: Date;
  lastErrorCode?: string;
  lastErrorAt?: Date;
  messageCount: number;
  malformedMessageCount: number;
}

export interface MarketStreamError {
  provider: ExchangeProvider;
  code: string;
  message: string;
  timestamp: Date;
  recoverable: boolean;
}

export interface CandleSubscription {
  symbol: string;
  interval: ExchangeInterval;
}

export interface OrderBookSubscription {
  symbol: string;
  depth: number;
}

export type UnsubscribeFunction = () => void;

// Discriminated union market events
export interface TickerUpdatedEvent {
  type: MarketEventType.TICKER_UPDATED;
  metadata: MarketEventMetadata;
  payload: NormalizedTicker;
}

export interface CandleUpdatedEvent {
  type: MarketEventType.CANDLE_UPDATED;
  metadata: MarketEventMetadata;
  payload: NormalizedCandle;
}

export interface CandleClosedEvent {
  type: MarketEventType.CANDLE_CLOSED;
  metadata: MarketEventMetadata;
  payload: NormalizedCandle;
}

export interface PublicTradeReceivedEvent {
  type: MarketEventType.PUBLIC_TRADE_RECEIVED;
  metadata: MarketEventMetadata;
  payload: NormalizedTrade;
}

export interface OrderBookUpdatedEvent {
  type: MarketEventType.ORDER_BOOK_UPDATED;
  metadata: MarketEventMetadata;
  payload: NormalizedOrderBook;
}

export interface FundingRateUpdatedEvent {
  type: MarketEventType.FUNDING_RATE_UPDATED;
  metadata: MarketEventMetadata;
  payload: NormalizedFundingRate;
}

export interface OpenInterestUpdatedEvent {
  type: MarketEventType.OPEN_INTEREST_UPDATED;
  metadata: MarketEventMetadata;
  payload: NormalizedOpenInterest;
}

export interface StreamConnectedEvent {
  type: MarketEventType.STREAM_CONNECTED;
  metadata: MarketEventMetadata;
  payload: { provider: ExchangeProvider };
}

export interface StreamDisconnectedEvent {
  type: MarketEventType.STREAM_DISCONNECTED;
  metadata: MarketEventMetadata;
  payload: { provider: ExchangeProvider; reason?: string };
}

export interface StreamStaleEvent {
  type: MarketEventType.STREAM_STALE;
  metadata: MarketEventMetadata;
  payload: { provider: ExchangeProvider; lastMessageAge: number };
}

export interface StreamRecoveredEvent {
  type: MarketEventType.STREAM_RECOVERED;
  metadata: MarketEventMetadata;
  payload: { provider: ExchangeProvider; downtime: number };
}

export interface DataGapDetectedEvent {
  type: MarketEventType.DATA_GAP_DETECTED;
  metadata: MarketEventMetadata;
  payload: {
    provider: ExchangeProvider;
    symbol: string;
    interval: ExchangeInterval;
    gapStart: Date;
    gapEnd: Date;
  };
}

export type NormalizedMarketEvent =
  | TickerUpdatedEvent
  | CandleUpdatedEvent
  | CandleClosedEvent
  | PublicTradeReceivedEvent
  | OrderBookUpdatedEvent
  | FundingRateUpdatedEvent
  | OpenInterestUpdatedEvent
  | StreamConnectedEvent
  | StreamDisconnectedEvent
  | StreamStaleEvent
  | StreamRecoveredEvent
  | DataGapDetectedEvent;

export interface IndicatorSnapshot {
  provider: ExchangeProvider;
  symbol: string;
  interval: ExchangeInterval;
  candleOpenTime: Date;
  candleCloseTime: Date;
  status: IndicatorStatus;
  values: {
    sma20?: string;
    sma50?: string;
    sma200?: string;
    ema9?: string;
    ema20?: string;
    ema50?: string;
    ema200?: string;
    rsi14?: string;
    macd?: {
      value: string;
      signal: string;
      histogram: string;
    };
    atr14?: string;
    adx14?: string;
    efficiencyRatio20?: string;
    bollingerBands?: {
      upper: string;
      middle: string;
      lower: string;
    };
    volumeChangePercent?: string;
    priceChangePercent?: string;
    rollingHigh?: string;
    rollingLow?: string;
    volatility?: string;
  };
  calculatedAt: Date;
  calculationVersion: number;
}

export interface MarketDataConfig {
  enabled: boolean;
  providers: ExchangeProvider[];
  symbols: string[];
  intervals: ExchangeInterval[];
  ticker: { enabled: boolean };
  trades: { enabled: boolean };
  candles: { enabled: boolean };
  orderBook: {
    enabled: boolean;
    depth: number;
    snapshotIntervalSeconds: number;
  };
  funding: { enabled: boolean; pollIntervalSeconds: number };
  openInterest: { enabled: boolean; pollIntervalSeconds: number };
  staleAfterSeconds: number;
  reconnect: {
    baseDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
  };
  persistence: {
    batchSize: number;
    flushIntervalMs: number;
  };
}
