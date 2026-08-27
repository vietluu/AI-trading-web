import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

export interface HighImportanceNewsEvent {
  id: string;
  title: string;
  importanceScore: number;
  symbols: string[];
  publishedAt: string;
}

@Injectable()
export class ExternalDataEventBus {
  private readonly emitter = new EventEmitter();

  emitHighImportanceNews(event: HighImportanceNewsEvent): void {
    this.emitter.emit("high-importance-news", event);
  }

  onHighImportanceNews(
    listener: (event: HighImportanceNewsEvent) => void,
  ): () => void {
    this.emitter.on("high-importance-news", listener);
    return () => this.emitter.off("high-importance-news", listener);
  }
}
