import { describe, expect, it, vi } from 'vitest';
import { SharedResearchService } from '../../src/modules/agents/application/services/shared-research.service';

function cache() {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    setNx: vi.fn(async (key: string, value: string) => {
      if (values.has(key)) return false;
      values.set(key, value); return true;
    }),
    setWithTtl: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    compareAndExpire: vi.fn(async (key: string, token: string) => values.get(key) === token),
    compareAndDelete: vi.fn(async (key: string, token: string) => {
      if (values.get(key) !== token) return false;
      return values.delete(key);
    }),
  };
}

describe('shared public research', () => {
  it('does not publish a result after losing its lease', async () => {
    const redis = cache();
    redis.compareAndExpire.mockResolvedValue(false);
    const service = new SharedResearchService(redis as never);
    await expect(service.getOrCompute('event', async () => 'stale owner')).rejects.toThrow('SHARED_RESEARCH_LEASE_LOST');
    expect(redis.setWithTtl).not.toHaveBeenCalled();
  });
  it('coalesces concurrent users and replicas and isolates returned objects', async () => {
    const redis = cache();
    const a = new SharedResearchService(redis as never);
    const b = new SharedResearchService(redis as never);
    const load = vi.fn(async () => ({ confidence: 70 }));
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) =>
      (i % 2 ? a : b).getOrCompute({ event: 'news-1', symbol: 'BTC-USDT' }, load)));
    expect(load).toHaveBeenCalledTimes(1);
    results[0]!.confidence = 0;
    expect(results[1]!.confidence).toBe(70);
  });

  it('does not reuse a different event or snapshot', async () => {
    const service = new SharedResearchService(cache() as never);
    const load = vi.fn(async () => 'result');
    await service.getOrCompute(['event-1', 'snapshot-1'], load);
    await service.getOrCompute(['event-2', 'snapshot-1'], load);
    await service.getOrCompute(['event-1', 'snapshot-2'], load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('fails closed on Redis outage without making an AI call', async () => {
    const redis = cache();
    redis.get.mockRejectedValue(new Error('Redis unavailable'));
    const load = vi.fn();
    await expect(new SharedResearchService(redis as never).getOrCompute('event', load)).rejects.toThrow('Redis unavailable');
    expect(load).not.toHaveBeenCalled();
  });

  it('releases a failed computation for a later retry without caching failure', async () => {
    const service = new SharedResearchService(cache() as never);
    await expect(service.getOrCompute('event', async () => { throw new Error('AI unavailable'); })).rejects.toThrow();
    await expect(service.getOrCompute('event', async () => 'recovered')).resolves.toBe('recovered');
  });
});
