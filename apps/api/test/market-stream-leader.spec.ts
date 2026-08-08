import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketStreamManager } from '../src/market-data/application/market-stream.manager';

function adapter() {
  return {
    provider: 'BINANCE_FUTURES',
    onEvent: vi.fn(() => vi.fn()),
    onStatusChange: vi.fn(() => vi.fn()),
    onError: vi.fn(() => vi.fn()),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribeTicker: vi.fn().mockResolvedValue(undefined),
    subscribeTrades: vi.fn().mockResolvedValue(undefined),
    subscribeCandles: vi.fn().mockResolvedValue(undefined),
    subscribeOrderBook: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(() => ({ state: 'CONNECTED' })),
  };
}

describe('MarketStreamManager leader lease', () => {
  afterEach(() => vi.useRealTimers());

  it('runs streams only while the replica owns and can renew the leader lease', async () => {
    vi.useFakeTimers();
    const binance = adapter();
    const okx = adapter();
    const taskLock = {
      acquire: vi.fn().mockResolvedValue('leader-token'),
      renew: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false),
      release: vi.fn().mockResolvedValue(true),
    };
    const manager = new MarketStreamManager(
      {
        isEnabled: () => true,
        getConfig: () => ({
          providers: ['BINANCE_FUTURES'],
          symbols: ['BTC-USDT'],
          intervals: ['1m'],
          ticker: { enabled: true },
          trades: { enabled: true },
          candles: { enabled: true },
          orderBook: { enabled: true, depth: 20 },
        }),
      } as never,
      { emit: vi.fn() } as never,
      binance as never,
      okx as never,
      { setStreamStatus: vi.fn().mockResolvedValue(undefined) } as never,
      taskLock as never,
      new ConfigService({ MARKET_STREAM_LEADER_LEASE_SECONDS: 15 }),
    );

    await manager.onModuleInit();
    expect(taskLock.acquire).toHaveBeenCalledWith('market-stream-leader', 15);
    expect(binance.connect).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(taskLock.renew).toHaveBeenCalledWith('market-stream-leader', 'leader-token', 15);
    expect(binance.disconnect).toHaveBeenCalledOnce();

    await manager.onModuleDestroy();
  });

  it('does not connect exchange streams when another replica is leader', async () => {
    const binance = adapter();
    const manager = new MarketStreamManager(
      { isEnabled: () => true } as never,
      { emit: vi.fn() } as never,
      binance as never,
      adapter() as never,
      { setStreamStatus: vi.fn() } as never,
      { acquire: vi.fn().mockResolvedValue(undefined) } as never,
      new ConfigService({ MARKET_STREAM_LEADER_LEASE_SECONDS: 30 }),
    );

    await manager.onModuleInit();
    expect(binance.connect).not.toHaveBeenCalled();
    await manager.onModuleDestroy();
  });
});
