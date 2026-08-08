import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Server, Socket } from "socket.io";
import { resolveSocketIoPath } from "../../../common/utils/socket-io-path";
import { SessionService } from "../../../session/session.service";
import { LiveTradingService } from "../application/live-trading.service";

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(",") || "http://localhost:3000",
    credentials: true,
  },
  namespace: "/live-trading",
  path: resolveSocketIoPath(),
})
export class LiveTradingGateway {
  private readonly logger = new Logger(LiveTradingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly sessionService: SessionService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.debug(`Live trading client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Live trading client disconnected: ${client.id}`);
  }

  private readUserAgent(client: Socket): string | undefined {
    const headers = client.handshake.headers as Record<string, string | string[] | undefined>;
    const userAgent = headers["user-agent"];
    if (Array.isArray(userAgent)) return userAgent[0];
    return userAgent ?? undefined;
  }

  private async resolveAuthenticatedUserId(client: Socket): Promise<string | undefined> {
    let token: string | undefined;

    // 1. Try auth object (e.g. io(url, { auth: { token: "..." } }))
    const authObj = client.handshake.auth as Record<string, unknown> | undefined;
    if (typeof authObj?.token === "string" && authObj.token.trim()) {
      token = authObj.token.trim();
    }

    // 2. Try query param (e.g. io(url, { query: { token: "..." } }))
    if (!token) {
      const queryObj = client.handshake.query as Record<string, unknown> | undefined;
      if (typeof queryObj?.token === "string" && queryObj.token.trim()) {
        token = queryObj.token.trim();
      }
    }

    // 3. Fallback to session cookie
    if (!token) {
      const cookies = client.handshake.headers.cookie;
      if (cookies) {
        const cookieHeader = Array.isArray(cookies) ? cookies.join(";") : cookies;
        const tokenCookie = cookieHeader
          .split(";")
          .map((entry) => entry.trim())
          .find((entry) => entry.startsWith(`${SessionService.cookieName}=`));
        if (tokenCookie) {
          token = tokenCookie.slice(SessionService.cookieName.length + 1);
        }
      }
    }

    if (!token) return undefined;

    try {
      const session = await this.sessionService.resolve(token, {
        ip: client.handshake.address,
        userAgent: this.readUserAgent(client),
      });
      return session.userId;
    } catch (error) {
      this.logger.warn({
        event: "live_trading_socket_session_resolution_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  @SubscribeMessage("subscribe")
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId?: string; connectionId?: string },
  ) {
    try {
      const requestedUserId = payload.userId?.trim();
      const sessionUserId = await this.resolveAuthenticatedUserId(client);
      const userId = requestedUserId || sessionUserId;
      const room = `dashboard:${userId ?? "default"}`;
      await client.join(room);
      const service = this.moduleRef.get(LiveTradingService, { strict: false });
      if (!service) {
        this.logger.warn(
          "LiveTradingService was not available for socket subscription",
        );
        client.emit("exception", {
          status: "error",
          message: "LiveTradingService unavailable",
        });
        return;
      }
      if (!userId) {
        client.emit("exception", {
          status: "error",
          message: "Authentication required to access live-trading snapshots",
        });
        return;
      }
      const snapshot = await service.dashboard(userId, payload.connectionId);
      client.emit("snapshot", snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({
        event: "live_trading_socket_subscribe_failed",
        payload,
        error: message,
      });
      client.emit("exception", {
        status: "error",
        message: "Failed to load live-trading snapshot",
        cause: error,
      });
    }
  }

  pushSnapshot(userId: string, payload: unknown): void {
    if (!this.server) {
      return;
    }
    this.server.to(`dashboard:${userId}`).emit("snapshot", payload);
  }
}
