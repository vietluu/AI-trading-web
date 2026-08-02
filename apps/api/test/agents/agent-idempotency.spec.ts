import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AgentIdempotencyService } from '../../src/modules/agents/infrastructure/redis/agent-idempotency.service';

describe('AgentIdempotencyService', () => {
  it('uses the configured short TTL for locks and successful results', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setWithTtl: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AgentIdempotencyService(
      redis as never,
      new ConfigService({ AGENT_IDEMPOTENCY_TTL_SECONDS: 45 }),
    );

    await expect(service.checkAndLock('fingerprint')).resolves.toEqual({
      locked: true,
    });
    expect(redis.setWithTtl).toHaveBeenNthCalledWith(
      1,
      'ai:agent:run-lock:fingerprint',
      'locked',
      45,
    );

    await service.setResult('fingerprint', 'run-id');
    expect(redis.setWithTtl).toHaveBeenNthCalledWith(
      2,
      'ai:agent:run-result:fingerprint',
      'run-id',
      45,
    );
    expect(redis.delete).toHaveBeenCalledWith(
      'ai:agent:run-lock:fingerprint',
    );
  });

  it('returns a cached successful run without replacing it', async () => {
    const redis = {
      get: vi.fn().mockResolvedValueOnce('existing-run-id'),
      setWithTtl: vi.fn(),
      delete: vi.fn(),
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
