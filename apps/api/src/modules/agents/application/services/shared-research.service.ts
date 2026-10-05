import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RedisService } from '../../../../redis/redis.service';

/** Public research only. Never pass user/account context to this cache. */
@Injectable()
export class SharedResearchService {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly redis: RedisService) {}

  async getOrCompute<T>(identity: unknown, load: () => Promise<T>): Promise<T> {
    const key = `research:v1:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
    let promise = this.pending.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = this.compute(key, load);
      this.pending.set(key, promise);
    }
    try {
      // Consumers may annotate analysis with their own execution context.
      return structuredClone(await promise);
    } finally {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    }
  }

  private async compute<T>(key: string, load: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const lock = `${key}:lock`;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const cached = await this.redis.get(key);
      if (cached !== null) return JSON.parse(cached) as T;
      if (await this.redis.setNx(lock, token, 180)) {
        let leaseLost = false;
        const timer = setInterval(() => {
          void this.redis.compareAndExpire(lock, token, 180)
            .then((owned) => { if (!owned) leaseLost = true; })
            .catch(() => { leaseLost = true; });
        }, 30_000);
        timer.unref();
        try {
          // Another owner may have completed between GET and SET NX.
          const completed = await this.redis.get(key);
          if (completed !== null) return JSON.parse(completed) as T;
          const value = await load();
          if (leaseLost || !await this.redis.compareAndExpire(lock, token, 180)) {
            throw new Error('SHARED_RESEARCH_LEASE_LOST');
          }
          await this.redis.setWithTtl(key, JSON.stringify(value), 300);
          return value;
        } finally {
          clearInterval(timer);
          await this.redis.compareAndDelete(lock, token).catch(() => false);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Never fan out independent AI calls after a shared-cache timeout.
    throw new Error('SHARED_RESEARCH_PENDING');
  }
}
