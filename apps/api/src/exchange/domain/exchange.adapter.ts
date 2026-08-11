import type {
  ExchangeAccountConfiguration,
  ExchangeAccountSummary,
  ExchangeBalance,
  ExchangeConnectionTest,
  ExchangeCredentials,
  ExchangeFundingRate,
  ExchangeFill,
  ExchangeInfo,
  ExchangeInstrument,
  ExchangeKline,
  ExchangeOpenInterest,
  ExchangeOrder,
  ExchangeOrderBook,
  ExchangePosition,
  ExchangeProvider,
  ExchangeServerTime,
  ExchangeTicker,
  ExchangeTrade,
  GetOrderQuery,
  InstrumentQuery,
  KlineQuery,
  OpenOrderQuery,
  PlaceOrderCommand,
  CancelOrderCommand,
  AmendProtectiveOrderCommand,
  CancelProtectiveOrderCommand,
} from "./exchange.types";

export interface ExchangeAdapter {
  readonly provider: ExchangeProvider;
  testPublicConnection(): Promise<ExchangeConnectionTest>;
  testPrivateConnection(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeConnectionTest>;
  getServerTime(
    environment?: ExchangeCredentials["environment"],
  ): Promise<ExchangeServerTime>;
  getExchangeInfo(
    environment?: ExchangeCredentials["environment"],
  ): Promise<ExchangeInfo>;
  getInstruments(query?: InstrumentQuery): Promise<ExchangeInstrument[]>;
  getTicker(symbol: string): Promise<ExchangeTicker>;
  getOrderBook(symbol: string, depth?: number): Promise<ExchangeOrderBook>;
  getRecentTrades(symbol: string, limit?: number): Promise<ExchangeTrade[]>;
  getKlines(query: KlineQuery): Promise<ExchangeKline[]>;
  getFundingRate(symbol: string): Promise<ExchangeFundingRate>;
  getOpenInterest(symbol: string): Promise<ExchangeOpenInterest>;
  getAccountSummary(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeAccountSummary>;
  getBalances(credentials: ExchangeCredentials): Promise<ExchangeBalance[]>;
  getPositions(credentials: ExchangeCredentials): Promise<ExchangePosition[]>;
  getOpenOrders(
    credentials: ExchangeCredentials,
    query?: OpenOrderQuery,
  ): Promise<ExchangeOrder[]>;
  getOrderHistory?(
    credentials: ExchangeCredentials,
    symbols?: string[],
    limit?: number,
  ): Promise<ExchangeOrder[]>;
  getTradeFills?(
    credentials: ExchangeCredentials,
    symbols?: string[],
    limit?: number,
    before?: Date,
  ): Promise<ExchangeFill[]>;
  getOrder(
    credentials: ExchangeCredentials,
    query: GetOrderQuery,
  ): Promise<ExchangeOrder>;
  getAccountConfiguration(
    credentials: ExchangeCredentials,
  ): Promise<ExchangeAccountConfiguration>;
  placeOrder(
    credentials: ExchangeCredentials,
    command: PlaceOrderCommand,
  ): Promise<ExchangeOrder>;
  cancelOrder(
    credentials: ExchangeCredentials,
    command: CancelOrderCommand,
  ): Promise<ExchangeOrder>;
  amendProtectiveOrder?(
    credentials: ExchangeCredentials,
    command: AmendProtectiveOrderCommand,
  ): Promise<void>;
  cancelProtectiveOrder?(
    credentials: ExchangeCredentials,
    command: CancelProtectiveOrderCommand,
  ): Promise<void>;
}
