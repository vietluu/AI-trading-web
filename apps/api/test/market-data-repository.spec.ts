import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { MarketDataRepository } from '../src/market-data/infrastructure/persistence/market-data.repository';
import { ExchangeInterval, ExchangeProvider } from '../src/exchange/domain/exchange.types';

describe('MarketDataRepository candle freshness', () => {
  it('queries latest candles descending and returns them chronologically', async () => {
    const base = {
      id: crypto.randomUUID(),
      provider: 'BINANCE_FUTURES' as const,
      symbol: 'BTC-USDT',
      interval: 'i1h' as const,
      closeTime: new Date(),
      open: new Prisma.Decimal(1), high: new Prisma.Decimal(1), low: new Prisma.Decimal(1),
      close: new Prisma.Decimal(1), volume: new Prisma.Decimal(1), quoteVolume: null,
      tradeCount: null, isClosed: true, createdAt: new Date(), updatedAt: new Date(),
    };
    const newer = { ...base, id: crypto.randomUUID(), openTime: new Date('2026-08-08T02:00:00Z') };
    const older = { ...base, id: crypto.randomUUID(), openTime: new Date('2026-08-08T01:00:00Z') };
    const findMany = vi.fn().mockResolvedValue([newer, older]);
    const repository = new MarketDataRepository({ marketCandle: { findMany } } as never);

    const result = await repository.getCandles({
      provider: ExchangeProvider.BINANCE_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.ONE_HOUR,
      limit: 2,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { openTime: 'desc' }, take: 2 }));
    expect(result.map((row) => row.openTime.toISOString())).toEqual([
      older.openTime.toISOString(),
      newer.openTime.toISOString(),
    ]);
  });

  it('casts string OHLCV parameters for PostgreSQL batch upserts', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const repository = new MarketDataRepository({ $executeRaw: executeRaw } as never);
    const candle = {
      provider: ExchangeProvider.OKX_FUTURES,
      symbol: 'BTC-USDT',
      interval: ExchangeInterval.ONE_MINUTE,
      openTime: new Date('2026-08-08T12:00:00Z'),
      closeTime: new Date('2026-08-08T12:00:59Z'),
      open: '100.1',
      high: '101.2',
      low: '99.8',
      close: '100.9',
      volume: '12.34',
      quoteVolume: '1234.56',
      tradeCount: 42,
      isClosed: true,
    };

    await repository.upsertCandleBatch([candle]);

    const query = executeRaw.mock.calls[0]?.[0] as Prisma.Sql;
    const sql = query.strings.join('?');
    expect(sql.match(/::numeric/g)).toHaveLength(6);
    expect(sql).toContain('::integer');
  });
});
