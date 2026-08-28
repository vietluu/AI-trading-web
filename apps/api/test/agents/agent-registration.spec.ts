import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistryService } from '../../src/modules/agents/infrastructure/registry/agent-registry.service';
import { SYSTEM_DIAGNOSTIC_DEFINITION } from '../../src/modules/agents/domain/definitions/system-diagnostic.definition';
import { AgentType } from '../../src/modules/agents/domain/enums';
import { AgentError } from '../../src/modules/agents/domain/errors/agent-errors';

describe('AgentRegistryService', () => {
  let registry: AgentRegistryService;

  beforeEach(() => {
    registry = new AgentRegistryService();
  });

  it('should register a valid agent definition', () => {
    registry.register(SYSTEM_DIAGNOSTIC_DEFINITION);

    const resolved = registry.resolve(AgentType.SYSTEM_DIAGNOSTIC, 1);
    expect(resolved).toBeDefined();
    expect(resolved?.displayName).toBe('System Diagnostic Agent');
  });

  it('should reject registering duplicate active agent definitions', () => {
    registry.register(SYSTEM_DIAGNOSTIC_DEFINITION);

    expect(() => {
      registry.register(SYSTEM_DIAGNOSTIC_DEFINITION);
    }).toThrowError(AgentError);
  });

  it('should list only active definitions', () => {
    registry.register(SYSTEM_DIAGNOSTIC_DEFINITION);

    const activeList = registry.listActive();
    expect(activeList.length).toBe(1);

    registry.disable(AgentType.SYSTEM_DIAGNOSTIC, 1);
    const activeAfterDisable = registry.listActive();
    expect(activeAfterDisable.length).toBe(0);
  });

  it('should compute deterministic definition hash', () => {
    const hash1 = registry.calculateDefinitionHash(SYSTEM_DIAGNOSTIC_DEFINITION);
    const hash2 = registry.calculateDefinitionHash(SYSTEM_DIAGNOSTIC_DEFINITION);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256
  });

  it('should synchronize definitions to database idempotently via upsert', async () => {
    registry.register(SYSTEM_DIAGNOSTIC_DEFINITION);

    const upsertMock = vi.fn().mockResolvedValue({ id: 'rec-1' });
    const prisma = {
      agentDefinitionRecord: {
        upsert: upsertMock,
      },
    };

    const firstRun = await registry.syncToDatabase(prisma);
    expect(firstRun.synced).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agentType_version: {
            agentType: AgentType.SYSTEM_DIAGNOSTIC,
            version: 1,
          },
        },
        create: expect.objectContaining({
          agentType: AgentType.SYSTEM_DIAGNOSTIC,
          version: 1,
          displayName: 'System Diagnostic Agent',
          status: 'ACTIVE',
        }) as unknown,
      }),
    );

    // Second run should also succeed without error (idempotent)
    const secondRun = await registry.syncToDatabase(prisma);
    expect(secondRun.synced).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });
});
