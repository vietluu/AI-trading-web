import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(configService: ConfigService) {
    this.client = new Redis(configService.getOrThrow<string>("REDIS_URL"), {
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });

    this.client.on("error", (error: Error) => {
      this.logger.error({
        event: "redis_error",
        message: error.message,
      });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.checkConnection();
    this.logger.log({ event: "redis_connected" });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async checkConnection(): Promise<void> {
    await this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async getAndDelete(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }

  async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  /**
   * Atomically set key=value with TTL only if the key does NOT already exist.
   * Returns true if the lock was acquired, false if another holder already owns it.
   * Used for distributed mutex (NX = "Not eXists").
   */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Delete a lock only when it is still owned by the supplied token. */
  async compareAndDelete(key: string, token: string): Promise<boolean> {
    const result = await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
    return Number(result) === 1;
  }

  /** Renew a lease only while it is still owned by the supplied token. */
  async compareAndExpire(key: string, token: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      key,
      token,
      ttlSeconds,
    );
    return Number(result) === 1;
  }

  async acquireSemaphore(key: string, token: string, limit: number, ttlMs: number): Promise<{ acquired: boolean; current: number }> {
    const now = Date.now();
    const result = await this.client.eval(
      "redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1]); local count = redis.call('zcard', KEYS[1]); if count < tonumber(ARGV[3]) then redis.call('zadd', KEYS[1], ARGV[2], ARGV[5]); redis.call('pexpire', KEYS[1], tonumber(ARGV[4]) * 2); return {1, count + 1}; end; return {0, count}",
      1,
      key,
      now,
      now + ttlMs,
      limit,
      ttlMs,
      token,
    ) as [number, number];
    return { acquired: Number(result[0]) === 1, current: Number(result[1]) };
  }

  async releaseSemaphore(key: string, token: string): Promise<void> {
    await this.client.zrem(key, token);
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.client.expire(key, ttlSeconds)) === 1;
  }

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const result = await this.client.eval(
      "local value = redis.call('incr', KEYS[1]); if value == 1 then redis.call('expire', KEYS[1], ARGV[1]); end; return value",
      1,
      key,
      ttlSeconds,
    );
    return Number(result);
  }

  /**
   * Reserves the next globally spaced execution slot for a key. Redis TIME and
   * the Lua script keep the schedule consistent across API replicas.
   */
  async reserveInterval(key: string, intervalMs: number): Promise<number> {
    const result = await this.client.eval(
      "local t = redis.call('time'); local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000); local nextAt = tonumber(redis.call('get', KEYS[1])) or now; local slot = math.max(now, nextAt); local following = slot + tonumber(ARGV[1]); local ttl = math.max((following - now) + tonumber(ARGV[1]), 1000); redis.call('set', KEYS[1], following, 'PX', ttl); return slot - now",
      1,
      key,
      intervalMs,
    );
    return Math.max(0, Number(result));
  }

  /**
   * Atomically decrements a counter. If the resulting value is <= 0 the key
   * is deleted so it does not stay at a negative value after a crash.
   */
  async decrement(key: string): Promise<number> {
    const val = await this.client.decr(key);
    if (val <= 0) {
      await this.client.del(key);
      return 0;
    }
    return val;
  }
}
