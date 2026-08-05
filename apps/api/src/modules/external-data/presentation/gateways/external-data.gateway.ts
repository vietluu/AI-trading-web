import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ExternalDataEventPublisher, ExternalDataEventPublisherGateway } from '../../application/services/external-data-event-publisher.service';

interface ClientSubscription {
  type: string;
  symbols?: string[];
  minimumImportance?: number;
}

@WebSocketGateway({
  namespace: '/external-data',
  path: '/api/socket.io/',
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const allowed = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map((item) => item.trim())
        : [];
      if (!origin || allowed.includes(origin) || allowed.includes('*')) {
        callback(null, true);
        return;
      }
      callback(null, true);
    },
    credentials: true,
  },
})
export class ExternalDataGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ExternalDataEventPublisherGateway {
  private readonly logger = new Logger(ExternalDataGateway.name);

  @WebSocketServer()
  server!: Server;

  private clientSubscriptions = new Map<string, ClientSubscription[]>();

  constructor(private readonly eventPublisher: ExternalDataEventPublisher) {}

  afterInit() {
    this.logger.log('ExternalDataGateway initialized on namespace /external-data');
    this.eventPublisher.setGateway(this);
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected to /external-data WebSocket: ${client.id}`);
    this.clientSubscriptions.set(client.id, []);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected from /external-data WebSocket: ${client.id}`);
    this.clientSubscriptions.delete(client.id);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { channels: ClientSubscription[] }) {
    if (!payload || !Array.isArray(payload.channels)) {
      client.emit('error', { message: 'Invalid subscription payload' });
      return;
    }

    const subscriptions = payload.channels;
    this.clientSubscriptions.set(client.id, subscriptions);

    client.emit('subscribed', {
      channels: subscriptions.map((s) => s.type),
      status: 'OK',
    });
  }

  broadcastToChannel(channel: string, event: string, data: Record<string, unknown>) {
    if (!this.server) return;

    const message = {
      channel,
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Note: per-socket emits below enforce filters; avoid broadcasting raw channel events globally.
    // Also check filtered subscriptions per connected client
    for (const [clientId, subs] of this.clientSubscriptions.entries()) {
      const socket =
        (this.server.sockets as any)?.get?.(clientId) ??
        (this.server.sockets as any)?.sockets?.get?.(clientId);
      if (!socket) continue;

      for (const sub of subs) {
        if (sub.type === channel) {
          // Check importance filter
          const importanceScore = typeof data.importanceScore === 'number' ? data.importanceScore : undefined;
          if (
            sub.minimumImportance != null &&
            importanceScore != null &&
            importanceScore < sub.minimumImportance
          ) {
            continue;
          }

          // Check symbol filter
          if (sub.symbols && sub.symbols.length > 0) {
            const dataSymbols: string[] = Array.isArray(data.symbols)
              ? (data.symbols as string[])
              : Array.isArray(data.relatedSymbols)
              ? (data.relatedSymbols as string[])
              : [];
            const hasMatchingSymbol = sub.symbols.some((s) => dataSymbols.includes(s));
            if (!hasMatchingSymbol) continue;
          }

          socket.emit(event, message);
        }
      }
    }
  }
}
