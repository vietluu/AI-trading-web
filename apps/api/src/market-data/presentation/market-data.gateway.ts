import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { MarketEventBus } from "../infrastructure/event-bus/market-event-bus";
import { MarketEventType } from "../domain/market-data.enums";
import type { NormalizedMarketEvent } from "../domain/market-data.types";

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(",") || "http://localhost:3000",
    credentials: true,
  },
  namespace: "/market",
  path: "/api/socket.io/",
})
export class MarketDataGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(MarketDataGateway.name);
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly eventBus: MarketEventBus) {}

  afterInit() {
    this.logger.log("MarketDataGateway initialized");

    // Subscribe to internal event bus and broadcast to connected WS clients
    this.unsubscribers.push(
      this.eventBus.on("market.*", (event: NormalizedMarketEvent) => {
        // Broadcast specific event types
        if (event.type === MarketEventType.TICKER_UPDATED) {
          this.server
            .to(`ticker:${event.payload.provider}:${event.payload.symbol}`)
            .emit("ticker", event.payload);
        } else if (
          event.type === MarketEventType.CANDLE_UPDATED ||
          event.type === MarketEventType.CANDLE_CLOSED
        ) {
          this.server
            .to(
              `candle:${event.payload.provider}:${event.payload.symbol}:${event.payload.interval}`,
            )
            .emit("candle", event.payload);
        } else if (event.type === MarketEventType.ORDER_BOOK_UPDATED) {
          this.server
            .to(`orderbook:${event.payload.provider}:${event.payload.symbol}`)
            .emit("orderbook", event.payload);
        } else if (event.type === MarketEventType.PUBLIC_TRADE_RECEIVED) {
          this.server
            .to(`trades:${event.payload.provider}:${event.payload.symbol}`)
            .emit("trade", event.payload);
        }
      }),
    );
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected to Market WS: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected from Market WS: ${client.id}`);
  }

  @SubscribeMessage("subscribe")
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      channel: string;
      provider: string;
      symbol: string;
      interval?: string;
    },
  ): void {
    let room = "";

    switch (payload.channel) {
      case "ticker":
        room = `ticker:${payload.provider}:${payload.symbol}`;
        break;
      case "candle":
        if (!payload.interval) return;
        room = `candle:${payload.provider}:${payload.symbol}:${payload.interval}`;
        break;
      case "orderbook":
        room = `orderbook:${payload.provider}:${payload.symbol}`;
        break;
      case "trades":
        room = `trades:${payload.provider}:${payload.symbol}`;
        break;
      default:
        return;
    }

    if (room) {
      void client.join(room);
      this.logger.debug(`Client ${client.id} joined room ${room}`);
    }
  }

  @SubscribeMessage("unsubscribe")
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      channel: string;
      provider: string;
      symbol: string;
      interval?: string;
    },
  ): void {
    let room = "";

    switch (payload.channel) {
      case "ticker":
        room = `ticker:${payload.provider}:${payload.symbol}`;
        break;
      case "candle":
        if (!payload.interval) return;
        room = `candle:${payload.provider}:${payload.symbol}:${payload.interval}`;
        break;
      case "orderbook":
        room = `orderbook:${payload.provider}:${payload.symbol}`;
        break;
      case "trades":
        room = `trades:${payload.provider}:${payload.symbol}`;
        break;
      default:
        return;
    }

    if (room) {
      void client.leave(room);
      this.logger.debug(`Client ${client.id} left room ${room}`);
    }
  }

  onModuleDestroy() {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers.length = 0;
  }
}
