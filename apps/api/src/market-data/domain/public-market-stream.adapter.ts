@import type { ExchangeProvider } from "../../exchange/domain/exchange.types";
import type {
  CandleSubscription,
  MarketStreamError,
  MarketStreamStatus,
  NormalizedMarketEvent,
  OrderBookSubscription,
  UnsubscribeFunction,
} from "./market-data.types";

/**
 * Provider-neutral public WebSocket adapter contract.
 * Each exchange implements this interface to provide normalized market events.
 */
export interface PublicMarketStreamAdapter {
  readonly provider: ExchangeProvider;

  connect(): Promise<void>;

  disconnect(): Promise<void>;

  subscribeTicker(symbols: string[]): Promise<void>;

  subscribeCandles(subscriptions: CandleSubscription[]): Promise<void>;

  subscribeTrades(symbols: string[]): Promise<void>;

  subscribeOrderBook(
    subscriptions: OrderBookSubscription[],
  ): Promise<void>;

  unsubscribe(subscriptionIds: string[]): Promise<void>;

  getStatus(): MarketStreamStatus;

  onEvent(
    handler: (event: NormalizedMarketEvent) => void,
  ): UnsubscribeFunction;

  onStatusChange(
    handler: (status: MarketStreamStatus) => void,
  ): UnsubscribeFunction;

  onError(
    handler: (error: MarketStreamError) => void,
  ): UnsubscribeFunction;
}
