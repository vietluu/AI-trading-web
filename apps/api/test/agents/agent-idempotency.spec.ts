import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AgentIdempotencyService } from '../../src/modules/agents/infrastructure/redis/agent-idempotency.service';

describe('AgentIdempotencyService', () => {
  it('uses the configured short TTL for locks and successful results', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setNx: vi.fn().mockResolvedValue(true),
      setWithTtl: vi.fn().mockResolvedValue(undefined),
      compareAndDelete: vi.fn().mockResolvedValue(true),
    };
    const service = new AgentIdempotencyService(
      redis as never,
      new ConfigService({ AGENT_IDEMPOTENCY_TTL_SECONDS: 45 }),
    );

    const lock = await service.checkAndLock('fingerprint');
    expect(lock.locked).toBe(true);
    expect(typeof lock.lockToken).toBe('string');
    const lockToken = lock.lockToken!;
    expect(redis.setNx).toHaveBeenCalledWith(
      'ai:agent:run-lock:fingerprint',
      lockToken,
      45,
    );

    await service.setResult('fingerprint', 'run-id', lockToken);
    expect(redis.setWithTtl).toHaveBeenCalledWith(
      'ai:agent:run-result:fingerprint',
      'run-id',
      45,
    );
    expect(redis.compareAndDelete).toHaveBeenCalledWith(
      'ai:agent:run-lock:fingerprint',
      lockToken,
    );
  });

  it('returns a cached successful run without replacing it', async () => {
    const redis = {
      get: vi.fn().mockResolvedValueOnce('existing-run-id'),
      setNx: vi.fn(),
      setWithTtl: vi.fn(),
      compareAndDelete: vi.fn(),
    };
    const service = new AgentIdempotencyService(
      redis as never,
      new ConfigService({ AGENT_IDEMPOTENCY_TTL_SECONDS: 60 }),
    );

    await expect(service.checkAndLock('fingerprint')).resolves.toEqual({
      locked: false,
      existingRunId: 'existing-run-id',
    });
    expect(redis.setWithTtl).not.toHaveBeenCalled();
  });
});
