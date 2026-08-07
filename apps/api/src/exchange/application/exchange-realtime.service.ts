import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

import {
  ExchangeProvider,
  type ExchangeOrderBook,
  type ExchangeTicker,
  type ExchangeTrade,
} from "../domain/exchange.types";
import { MarketEventType } from "../../market-data/domain/market-data.enums";
import type { NormalizedTicker } from "../../market-data/domain/market-data.types";
import { OkxPublicStreamAdapter } from "../../market-data/infrastructure/streams/okx-public-stream.adapter";

interface StoredTicker {
  value: ExchangeTicker;
  updatedAt: number;
}

interface StoredOrderBook {
  value: ExchangeOrderBook;
  updatedAt: number;
}

interface StoredTrades {
  value: ExchangeTrade[];
  updatedAt: number;
}

@Injectable()
export class ExchangeRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(ExchangeRealtimeService.name);
  private readonly tickers = new Map<string, StoredTicker>();
  private readonly orderBooks = new Map<string, StoredOrderBook>();
  private readonly trades = new Map<string, StoredTrades>();
  private readonly subscriptions = new Set<string>();
  private initialized = false;
  private readonly staleAfterMs = 2_000;
  private readonly unsubscribeFromEvents?: () => void;

  constructor(private readonly okxAdapter: OkxPublicStreamAdapter) {
    this.unsubscribeFromEvents = this.okxAdapter.onEvent((event) => {
      void this.handleEvent(event);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribeFromEvents?.();
  }

  async getTicker(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ExchangeTicker | null> {
    if (provider !== ExchangeProvider.OKX_FUTURES) return null;
    await this.ensureReady(provider, symbol);
    const key = this.key(provider, symbol);
    const cached = this.tickers.get(key);
    if (cached && Date.now() - cached.updatedAt <= this.staleAfterMs) {
      return cached.value;
    }
    return null;
  }

  async getOrderBook(
    provider: ExchangeProvider,
    symbol: string,
    depth: number,
  ): Promise<ExchangeOrderBook | null> {
    if (provider !== ExchangeProvider.OKX_FUTURES) return null;
    await this.ensureReady(provider, symbol);
    const key = this.orderBookKey(provider, symbol, depth);
    const cached = this.orderBooks.get(key);
    if (cached && Date.now() - cached.updatedAt <= this.staleAfterMs) {
      return cached.value;
    }
    return null;
  }

  async getTrades(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<ExchangeTrade[] | null> {
    if (provider !== ExchangeProvider.OKX_FUTURES) return null;
    await this.ensureReady(provider, symbol);
    const key = this.key(provider, symbol);
    const cached = this.trades.get(key);
    if (cached && Date.now() - cached.updatedAt <= this.staleAfterMs) {
      return cached.value;
    }
    return null;
  }

  private async ensureReady(
    provider: ExchangeProvider,
    symbol: string,
  ): Promise<void> {
    if (provider !== ExchangeProvider.OKX_FUTURES) return;
    if (!this.initialized) {
      try {
        await this.okxAdapter.connect();
        this.initialized = true;
      } catch (error) {
        this.logger.warn({
          event: "okx_realtime_stream_connect_failed",
          provider,
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    const subscriptionKey = `${provider}:${symbol}`;
    if (!this.subscriptions.has(subscriptionKey)) {
      await this.okxAdapter.subscribeTicker([symbol]);
      await this.okxAdapter.subscribeTrades([symbol]);
      await this.okxAdapter.subscribeOrderBook([{ symbol, depth: 5 }]);
      this.subscriptions.add(subscriptionKey);
    }
  }

  private handleEvent(event: {
    type: string;
    payload: unknown;
  }): void {
    if (event.type === String(MarketEventType.TICKER_UPDATED)) {
      const payload = event.payload as NormalizedTicker;
      const value: ExchangeTicker = {
        provider: payload.provider,
        symbol: payload.symbol,
        lastPrice: payload.lastPrice,
        markPrice: payload.markPrice,
        bidPrice: payload.bidPrice,
        askPrice: payload.askPrice,
        high24h: payload.high24h,
        low24h: payload.low24h,
        volume24h: payload.volume24h,
        quoteVolume24h: payload.quoteVolume24h,
        priceChange24h: payload.priceChange24h,
        priceChangePercent24h: payload.priceChangePercent24h,
        timestamp: payload.timestamp,
      };
      this.tickers.set(this.key(payload.provider, payload.symbol), {
        value,
        updatedAt: Date.now(),
      });
      return;
    }
    if (event.type === String(MarketEventType.ORDER_BOOK_UPDATED)) {
      const payload = event.payload as {
        provider: ExchangeProvider;
        symbol: string;
        bids: Array<{ price: string; quantity: string }>;
        asks: Array<{ price: string; quantity: string }>;
        timestamp: Date;
        depth: number;
      };
      const value: ExchangeOrderBook = {
        provider: payload.provider,
        symbol: payload.symbol,
        bids: payload.bids.map((level) => ({
          price: level.price,
          quantity: level.quantity,
        })),
        asks: payload.asks.map((level) => ({
          price: level.price,
          quantity: level.quantity,
        })),
        timestamp: payload.timestamp,
        depth: payload.depth,
      };
      this.orderBooks.set(this.orderBookKey(payload.provider, payload.symbol, payload.depth), {
        value,
        updatedAt: Date.now(),
      });
      return;
    }
    if (event.type === String(MarketEventType.PUBLIC_TRADE_RECEIVED)) {
      const payload = event.payload as {
        provider: ExchangeProvider;
        symbol: string;
        tradeId: string;
        price: string;
        quantity: string;
        side: "BUY" | "SELL";
        timestamp: Date;
      };
      const value: ExchangeTrade[] = [
        {
          provider: payload.provider,
          symbol: payload.symbol,
          tradeId: payload.tradeId,
          price: payload.price,
          quantity: payload.quantity,
          side: payload.side,
          timestamp: payload.timestamp,
        },
      ];
      this.trades.set(this.key(payload.provider, payload.symbol), {
        value,
        updatedAt: Date.now(),
      });
    }
  }

  private key(provider: ExchangeProvider, symbol: string): string {
    return `${provider}:${symbol}`;
  }

  private orderBookKey(
    provider: ExchangeProvider,
    symbol: string,
    depth: number,
  ): string {
    return `${provider}:${symbol}:${depth}`;
  }
}
