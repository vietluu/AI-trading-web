import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

export interface HighImportanceNewsEvent {
  id: string;
  title: string;
  importanceScore: number;
  symbols: string[];
  publishedAt: string;
}

export interface MacroReleaseEvent {
  id: string;
  name: string;
  category: string;
  importance: string;
  actual: string;
  forecast?: string | null;
  previous?: string | null;
  unit?: string | null;
  country?: string | null;
  currency?: string | null;
  scheduledAt: string;
  releasedAt: string;
  macroTrend: "RISK_ON" | "RISK_OFF" | "NEUTRAL";
  surprise?: number | null;
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

  emitMacroRelease(event: MacroReleaseEvent): void {
    this.emitter.emit("macro-release", event);
  }

  onMacroRelease(
    listener: (event: MacroReleaseEvent) => void,
  ): () => void {
    this.emitter.on("macro-release", listener);
    return () => this.emitter.off("macro-release", listener);
  }
}

