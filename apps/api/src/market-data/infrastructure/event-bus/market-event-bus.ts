import { EventEmitter } from 'node:events';
import { Injectable, Logger } from '@nestjs/common';
import type { MarketEventType } from '../../domain/market-data.enums';
import type { NormalizedMarketEvent } from '../../domain/market-data.types';

@Injectable()
export class MarketEventBus {
  private readonly logger = new Logger(MarketEventBus.name);
  private readonly emitter = new EventEmitter();
  private eventCount = 0;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: NormalizedMarketEvent): void {
    this.eventCount++;
    this.emitter.emit(event.type, event);
    this.emitter.emit('market.*', event);
  }

  on(
    eventType: MarketEventType | 'market.*',
    handler: (event: NormalizedMarketEvent) => void,
  ): () => void {
    this.emitter.on(eventType, handler);
    return () => {
      this.emitter.removeListener(eventType, handler);
    };
  }

  once(
    eventType: MarketEventType,
    handler: (event: NormalizedMarketEvent) => void,
  ): void {
    this.emitter.once(eventType, handler);
  }

  getEventCount(): number {
    return this.eventCount;
  }

  getListenerCount(eventType?: string): number {
    if (eventType) {
      return this.emitter.listenerCount(eventType);
    }
    return this.emitter.eventNames().reduce(
      (total, name) => total + this.emitter.listenerCount(name),
      0,
    );
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
