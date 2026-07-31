export enum ExchangeProvider {
  BINANCE_FUTURES = "BINANCE_FUTURES",
  OKX_FUTURES = "OKX_FUTURES",
}

export enum ExchangeEnvironment {
  TESTNET = "TESTNET",
  DEMO = "DEMO",
  PRODUCTION = "PRODUCTION",
}

export enum ExchangeInterval {
  ONE_MINUTE = "1m",
  THREE_MINUTES = "3m",
  FIVE_MINUTES = "5m",
  FIFTEEN_MINUTES = "15m",
  THIRTY_MINUTES = "30m",
  ONE_HOUR = "1h",
  TWO_HOURS = "2h",
  FOUR_HOURS = "4h",
  SIX_HOURS = "6h",
  EIGHT_HOURS = "8h",
  TWELVE_HOURS = "12h",
  ONE_DAY = "1d",
  ONE_WEEK = "1w",
  ONE_MONTH = "1M",
}

export type ExchangeInstrumentType = "PERPETUAL" | "FUTURE";
export type ExchangeInstrumentStatus =
  "TRADING" | "SUSPENDED" | "PRE_TRADING" | "UNKNOWN";
export type PositionSide = "LONG" | "SHORT" | "BOTH";
export type PositionMode = "ONE_WAY" | "HEDGE";
export type MarginType = "CROSS" | "ISOLATED";
export type OrderSide = "BUY" | "SELL";
export type OrderType =
  "MARKET" | "LIMIT" | "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "UNKNOWN";
export type OrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "UNKNOWN";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "POST_ONLY";

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  environment: ExchangeEnvironment;
}

export interface ExchangeConnectionTest {
  success: boolean;
  provider: ExchangeProvider;
  environment: ExchangeEnvironment;
  permissions?: {
    accountRead: boolean;
    balanceRead: boolean;
    positionRead: boolean;
    orderRead: boolean;
    trading?: boolean;
    withdrawal?: boolean;
  };
  accountIdentifierMasked?: string;
  serverTime?: Date;
  latencyMs?: number;
  errorCode?: string;
  message?: string;
}

export interface ExchangeServerTime {
  provider: ExchangeProvider;
  serverTime: Date;
  localTime: Date;
  offsetMs: number;
}

export interface ExchangeInfo {
  provider: ExchangeProvider;
  environment: ExchangeEnvironment;
  timezone: string;
  serverTime?: Date;
  instrumentCount: number;
}

export interface ExchangeInstrument {
  provider: ExchangeProvider;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settlementAsset: string;
  instrumentType: ExchangeInstrumentType;
  status: ExchangeInstrumentStatus;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: string;
  stepSize: string;
  minQuantity?: string;
  maxQuantity?: string;
  minNotional?: string;
  contractSize?: string;
  supportsMarketOrder: boolean;
  supportsLimitOrder: boolean;
  supportsStopOrder: boolean;
}

export interface ExchangeTicker {
  provider: ExchangeProvider;
  symbol: string;
  lastPrice: string;
  markPrice?: string;
  indexPrice?: string;
  bidPrice?: string;
  askPrice?: string;
  high24h?: string;
  low24h?: string;
  volume24h?: string;
  quoteVolume24h?: string;
  priceChange24h?: string;
  priceChangePercent24h?: string;
  timestamp: Date;
}

export interface ExchangeOrderBookLevel {
  price: string;
  quantity: string;
}
export interface ExchangeOrderBook {
  provider: ExchangeProvider;
  symbol: string;
  bids: ExchangeOrderBookLevel[];
  asks: ExchangeOrderBookLevel[];
  timestamp: Date;
}

export interface ExchangeTrade {
  provider: ExchangeProvider;
  symbol: string;
  tradeId: string;
  price: string;
  quantity: string;
  side: OrderSide;
  timestamp: Date;
}

export interface ExchangeKline {
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

export interface ExchangeFundingRate {
  provider: ExchangeProvider;
  symbol: string;
  fundingRate: string;
  fundingTime: Date;
  nextFundingTime?: Date;
  markPrice?: string;
}

export interface ExchangeOpenInterest {
  provider: ExchangeProvider;
  symbol: string;
  openInterest: string;
  openInterestValue?: string;
  timestamp: Date;
}

export interface ExchangeAccountSummary {
  provider: ExchangeProvider;
  totalEquity: string;
  availableBalance: string;
  totalUnrealizedPnl: string;
  totalMarginBalance: string;
  canTrade: boolean;
  updatedAt: Date;
}

export interface ExchangeBalance {
  provider: ExchangeProvider;
  asset: string;
  total: string;
  available: string;
  locked?: string;
  unrealizedPnl?: string;
  marginBalance?: string;
}

export interface ExchangePosition {
  provider: ExchangeProvider;
  symbol: string;
  side: PositionSide;
  positionMode: PositionMode;
  quantity: string;
  entryPrice: string;
  markPrice?: string;
  liquidationPrice?: string;
  leverage?: string;
  marginType?: MarginType;
  margin?: string;
  unrealizedPnl: string;
  realizedPnl?: string;
  notional?: string;
  updatedAt: Date;
}

export interface ExchangeOrder {
  provider: ExchangeProvider;
  symbol: string;
  exchangeOrderId: string;
  clientOrderId?: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  timeInForce?: TimeInForce;
  price?: string;
  stopPrice?: string;
  averagePrice?: string;
  originalQuantity: string;
  executedQuantity: string;
  reduceOnly?: boolean;
  positionSide?: PositionSide;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ExchangeAccountConfiguration {
  provider: ExchangeProvider;
  positionMode: PositionMode;
  accountMode?: string;
  canTrade: boolean;
  multiAssetsMargin?: boolean;
}

export interface InstrumentQuery {
  status?: ExchangeInstrumentStatus;
}
export interface KlineQuery {
  symbol: string;
  interval: ExchangeInterval;
  limit?: number;
  startTime?: Date;
  endTime?: Date;
}
export interface OpenOrderQuery {
  symbol?: string;
}
export interface GetOrderQuery {
  symbol: string;
  orderId: string;
}
