import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';

@Injectable()
export class DistributedTaskLockService {
  constructor(private readonly redis: RedisService) {}

  async acquire(key: string, ttlSeconds: number, token = randomUUID()): Promise<string | undefined> {
    return (await this.redis.setNx(this.redisKey(key), token, ttlSeconds)) ? token : undefined;
  }

  renew(key: string, token: string, ttlSeconds: number): Promise<boolean> {
    return this.redis.compareAndExpire(this.redisKey(key), token, ttlSeconds);
  }

  release(key: string, token: string): Promise<boolean> {
    return this.redis.compareAndDelete(this.redisKey(key), token);
  }

  async run<T>(key: string, ttlSeconds: number, task: () => Promise<T>): Promise<T | undefined> {
    const token = await this.acquire(key, ttlSeconds);
    if (!token) return undefined;
    try {
      return await task();
    } finally {
      await this.release(key, token);
    }
  }

  private redisKey(key: string): string {
    return `task-lock:${key}`;
  }
}
