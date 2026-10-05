import { Injectable } from '@nestjs/common';
import type { ExchangeProvider } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { canonicalSymbol } from '../../../exchange/infrastructure/exchange-symbol';

export interface EventSubscriber {
  userId: string;
  provider: ExchangeProvider;
  symbol: string;
  strategyIds: string[];
}

@Injectable()
export class EventSubscribersService {
  private cached: EventSubscriber[] = [];
  private expiresAt = 0;
  private pending?: Promise<EventSubscriber[]>;
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<EventSubscriber[]> {
    if (Date.now() < this.expiresAt) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try { return await this.pending; } finally { this.pending = undefined; }
  }

  private async load(): Promise<EventSubscriber[]> {
    const users = await this.prisma.user.findMany({
      where: {
        portfolioStrategies: { some: { status: 'ACTIVE' } },
        exchangeConnections: { some: { isEnabled: true, isVerified: true } },
      },
      select: {
        id: true,
        setting: { select: { preferredSymbols: true, preferredExchange: true } },
        portfolioStrategies: { where: { status: 'ACTIVE' }, select: { key: true, symbols: true } },
        exchangeConnections: {
          where: { isEnabled: true, isVerified: true }, select: { provider: true },
        },
      },
    });
    const subscribers: EventSubscriber[] = [];
    for (const user of users) {
      const symbols = new Set((user.setting?.preferredSymbols.length
        ? user.setting.preferredSymbols
        : user.portfolioStrategies.flatMap((s) => s.symbols)).map(canonicalSymbol));
      const providers = new Set(user.exchangeConnections.map((c) => c.provider));
      for (const provider of providers) {
        const preferred = user.setting?.preferredExchange?.replace(/_FUTURES$/, '');
        if (preferred && `${preferred}_FUTURES` !== provider) continue;
        for (const symbol of symbols) {
          const strategyIds = user.portfolioStrategies
            .filter((s) => s.symbols.some((value) => canonicalSymbol(value) === symbol))
            .map((s) => s.key);
          if (strategyIds.length) subscribers.push({ userId: user.id, provider, symbol, strategyIds });
        }
      }
    }
    this.cached = subscribers;
    this.expiresAt = Date.now() + 30_000;
    return subscribers;
  }
}
