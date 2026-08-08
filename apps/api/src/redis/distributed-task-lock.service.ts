import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';

@Injectable()
export class DistributedTaskLockService {
  constructor(private readonly redis: RedisService) {}

  async run<T>(key: string, ttlSeconds: number, task: () => Promise<T>): Promise<T | undefined> {
    const token = randomUUID();
    if (!(await this.redis.setNx(`task-lock:${key}`, token, ttlSeconds))) return undefined;
    try {
      return await task();
    } finally {
      await this.redis.compareAndDelete(`task-lock:${key}`, token);
    }
  }
}
