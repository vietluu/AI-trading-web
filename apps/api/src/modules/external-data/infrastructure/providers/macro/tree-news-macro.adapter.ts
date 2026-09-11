import { Injectable, Logger } from "@nestjs/common";
import WebSocket from "ws";

export interface TreeNewsItem {
  _id: string;
  source: string;
  title: string;
  url?: string;
  time: number;
}

@Injectable()
export class TreeNewsMacroAdapter {
  private readonly logger = new Logger(TreeNewsMacroAdapter.name);
  private readonly wsUrl = "wss://news.treeofalpha.com/ws";
  private readonly restUrl = "https://news.treeofalpha.com/api/news";

  private ws?: WebSocket;
  private isClosedExplicitly = false;
  private reconnectAttempts = 0;
  private reconnectTimeout?: NodeJS.Timeout;

  connectStream(onNewsItem: (item: TreeNewsItem) => void): () => void {
    this.isClosedExplicitly = false;
    this.initWebSocket(onNewsItem);

    return () => {
      this.isClosedExplicitly = true;
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.close();
      }
    };
  }

  private initWebSocket(onNewsItem: (item: TreeNewsItem) => void): void {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        this.logger.log("Connected to Tree News real-time WebSocket feed");
        this.reconnectAttempts = 0;
      });

      this.ws.on("message", (raw: WebSocket.Data) => {
        try {
          const text =
            typeof raw === "string"
              ? raw
              : Buffer.isBuffer(raw)
                ? raw.toString("utf-8")
                : Array.isArray(raw)
                  ? Buffer.concat(raw).toString("utf-8")
                  : "";
          if (!text) return;
          const parsed = JSON.parse(text) as unknown;
          if (parsed && typeof parsed === "object" && "_id" in parsed && "title" in parsed) {
            onNewsItem(parsed as TreeNewsItem);
          }
        } catch (err: unknown) {
          this.logger.debug({
            event: "tree_news_parse_failed",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

      this.ws.on("error", (err: Error) => {
        this.logger.warn({
          event: "tree_news_ws_error",
          message: err.message,
        });
      });

      this.ws.on("close", () => {
        if (this.isClosedExplicitly) return;
        this.reconnectAttempts++;
        const delayMs = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
        this.logger.log(`Tree News WebSocket disconnected. Reconnecting in ${delayMs}ms...`);
        this.reconnectTimeout = setTimeout(() => {
          this.initWebSocket(onNewsItem);
        }, delayMs);
      });
    } catch (err: unknown) {
      this.logger.error({
        event: "tree_news_connect_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async fetchLatestNews(limit = 10): Promise<TreeNewsItem[]> {
    try {
      const response = await fetch(`${this.restUrl}?limit=${limit}`, {
        headers: { "User-Agent": "crypto-platform-fast-macro/1.0" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`Tree News HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json() as unknown;
      if (Array.isArray(data)) {
        return data as TreeNewsItem[];
      }
      return [];
    } catch (err: unknown) {
      this.logger.warn({
        event: "tree_news_poll_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
