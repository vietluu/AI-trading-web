import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../redis/redis.service";
import type {
  ConfluenceBatchMeta,
  ConfluenceSignal,
} from "../domain/confluence-engine.types";

const BATCH_DEFAULT_TTL_SECONDS = 120;

function parseHgetAll(arr: unknown[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(arr)) return result;
  for (let i = 0; i < arr.length; i += 2) {
    const key = String(arr[i]);
    const val = String(arr[i + 1]);
    result[key] = val;
  }
  return result;
}

@Injectable()
export class ConfluenceCollectorService {
  private readonly logger = new Logger(ConfluenceCollectorService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Initializes a new confluence collection batch in Redis.
   */
  async createBatch(
    batchId: string,
    userId: string,
    expectedCount: number,
    ttlSeconds = BATCH_DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const batchKey = `confluence:batch:${batchId}`;
    const now = Date.now();
    const script = `
      redis.call('hset', KEYS[1], 'batchId', ARGV[1], 'userId', ARGV[2], 'expectedCount', ARGV[3], 'reportedCount', '0', 'createdAt', ARGV[4])
      redis.call('expire', KEYS[1], ARGV[5])
      return 1
    `;
    await this.redis.eval(
      script,
      1,
      batchKey,
      batchId,
      userId,
      expectedCount,
      now,
      ttlSeconds,
    );
  }

  /**
   * Submits an actionable trading signal to the confluence batch.
   * Returns whether all expected signals have reported.
   */
  async addSignal(
    batchId: string,
    signal: ConfluenceSignal,
    ttlSeconds = BATCH_DEFAULT_TTL_SECONDS,
  ): Promise<{ ready: boolean; reported: number; expected: number }> {
    const batchKey = `confluence:batch:${batchId}`;
    const signalsKey = `confluence:batch:${batchId}:signals`;
    const signalJson = JSON.stringify(signal);
    const score = signal.compositeScore ?? 0;

    const script = `
      local exists = redis.call('exists', KEYS[1])
      if exists == 0 then return {0, 0, 0} end
      redis.call('zadd', KEYS[2], ARGV[2], ARGV[1])
      local reported = redis.call('hincrby', KEYS[1], 'reportedCount', 1)
      local expected = tonumber(redis.call('hget', KEYS[1], 'expectedCount') or '0')
      redis.call('expire', KEYS[1], ARGV[3])
      redis.call('expire', KEYS[2], ARGV[3])
      local ready = 0
      if reported >= expected then ready = 1 end
      return {ready, reported, expected}
    `;

    const res = (await this.redis.eval(
      script,
      2,
      batchKey,
      signalsKey,
      signalJson,
      score,
      ttlSeconds,
    )) as [number, number, number];

    return {
      ready: Number(res[0]) === 1,
      reported: Number(res[1]),
      expected: Number(res[2]),
    };
  }

  /**
   * Reports that a symbol evaluated to non-actionable (e.g. WAIT, blocked by gate).
   */
  async reportNonActionable(
    batchId: string,
    ttlSeconds = BATCH_DEFAULT_TTL_SECONDS,
  ): Promise<{ ready: boolean; reported: number; expected: number }> {
    const batchKey = `confluence:batch:${batchId}`;
    const script = `
      local exists = redis.call('exists', KEYS[1])
      if exists == 0 then return {0, 0, 0} end
      local reported = redis.call('hincrby', KEYS[1], 'reportedCount', 1)
      local expected = tonumber(redis.call('hget', KEYS[1], 'expectedCount') or '0')
      redis.call('expire', KEYS[1], ARGV[1])
      local ready = 0
      if reported >= expected then ready = 1 end
      return {ready, reported, expected}
    `;

    const res = (await this.redis.eval(
      script,
      1,
      batchKey,
      ttlSeconds,
    )) as [number, number, number];

    return {
      ready: Number(res[0]) === 1,
      reported: Number(res[1]),
      expected: Number(res[2]),
    };
  }

  /**
   * Atomically drains and deletes the batch, preventing duplicate executions.
   */
  async drainBatch(
    batchId: string,
  ): Promise<{ signals: ConfluenceSignal[]; meta: ConfluenceBatchMeta } | null> {
    const batchKey = `confluence:batch:${batchId}`;
    const signalsKey = `confluence:batch:${batchId}:signals`;

    const script = `
      local exists = redis.call('exists', KEYS[1])
      if exists == 0 then return nil end
      local meta = redis.call('hgetall', KEYS[1])
      local signals = redis.call('zrevrange', KEYS[2], 0, -1)
      redis.call('del', KEYS[1], KEYS[2])
      return {meta, signals}
    `;

    const result = (await this.redis.eval(
      script,
      2,
      batchKey,
      signalsKey,
    )) as [unknown[], unknown[]] | null;

    if (!result || !Array.isArray(result) || result.length < 2) {
      return null;
    }

    const [rawMeta, rawSignals] = result;
    const metaMap = parseHgetAll(rawMeta);

    const meta: ConfluenceBatchMeta = {
      batchId: metaMap.batchId ?? batchId,
      userId: metaMap.userId ?? "",
      expectedCount: Number(metaMap.expectedCount ?? 0),
      reportedCount: Number(metaMap.reportedCount ?? 0),
      createdAt: Number(metaMap.createdAt ?? Date.now()),
    };

    const signals: ConfluenceSignal[] = [];
    if (Array.isArray(rawSignals)) {
      for (const item of rawSignals) {
        try {
          if (typeof item === "string") {
            signals.push(JSON.parse(item) as ConfluenceSignal);
          }
        } catch (err) {
          this.logger.error({
            event: "confluence_signal_deserialize_failed",
            batchId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return { signals, meta };
  }

  /**
   * Checks batch status without modifying it.
   */
  async batchStatus(batchId: string): Promise<ConfluenceBatchMeta | null> {
    const batchKey = `confluence:batch:${batchId}`;
    const script = `
      local exists = redis.call('exists', KEYS[1])
      if exists == 0 then return nil end
      return redis.call('hgetall', KEYS[1])
    `;
    const result = (await this.redis.eval(script, 1, batchKey)) as unknown[] | null;
    if (!result || !Array.isArray(result) || result.length === 0) {
      return null;
    }
    const metaMap = parseHgetAll(result);
    return {
      batchId: metaMap.batchId ?? batchId,
      userId: metaMap.userId ?? "",
      expectedCount: Number(metaMap.expectedCount ?? 0),
      reportedCount: Number(metaMap.reportedCount ?? 0),
      createdAt: Number(metaMap.createdAt ?? Date.now()),
    };
  }
}
