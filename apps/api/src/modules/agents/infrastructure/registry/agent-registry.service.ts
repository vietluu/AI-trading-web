import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgentType, AgentStatus } from '../../domain/enums';
import type { AgentDefinition } from '../../domain/models/agent-definition.model';
import { AgentError, AgentErrorCode } from '../../domain/errors/agent-errors';

/**
 * Central registry for all agent definitions.
 * Manages in-memory registration, lookup, and lifecycle of agent definitions.
 */
@Injectable()
export class AgentRegistryService {
  private readonly logger = new Logger(AgentRegistryService.name);
  private readonly registry = new Map<string, AgentDefinition>();

  /**
   * Register an agent definition. Validates required fields and rejects
   * duplicate active type+version combinations.
   */
  public register(definition: AgentDefinition): void {
    if (!definition.promptId || definition.promptId.trim() === '') {
      throw new AgentError(
        AgentErrorCode.AGENT_MISCONFIGURED,
        'AgentDefinition must have a non-empty promptId',
        false,
      );
    }

    for (const toolName of definition.allowedToolNames) {
      if (!toolName || typeof toolName !== 'string' || toolName.trim() === '') {
        throw new AgentError(
          AgentErrorCode.AGENT_MISCONFIGURED,
          'AgentDefinition allowedToolNames must contain non-empty strings',
          false,
        );
      }
    }

    for (const capability of definition.requiredCapabilities) {
      if (!capability || typeof capability !== 'string' || capability.trim() === '') {
        throw new AgentError(
          AgentErrorCode.AGENT_MISCONFIGURED,
          'AgentDefinition requiredCapabilities must contain non-empty strings',
          false,
        );
      }
    }

    const key = this.getRegistrationKey(definition.type, definition.version);
    const existing = this.registry.get(key);

    if (existing && existing.status === AgentStatus.ACTIVE && definition.status === AgentStatus.ACTIVE) {
      throw new AgentError(
        AgentErrorCode.AGENT_MISCONFIGURED,
        `Active agent definition for ${key} already exists`,
        false,
      );
    }

    this.registry.set(key, definition);
    this.logger.log({
      event: 'agent_definition_registered',
      agentType: definition.type,
      version: definition.version,
      status: definition.status,
      promptId: definition.promptId,
      toolCount: definition.allowedToolNames.length,
      hash: this.calculateDefinitionHash(definition),
    });
  }

  /** Remove an agent definition from the registry. */
  public unregister(type: AgentType, version: number): boolean {
    const key = this.getRegistrationKey(type, version);
    const deleted = this.registry.delete(key);
    if (deleted) {
      this.logger.log({ event: 'agent_definition_unregistered', agentType: type, version });
    }
    return deleted;
  }

  /**
   * Resolve an agent definition by type. If version is provided, returns
   * exact match. Otherwise returns the latest active version.
   */
  public resolve(type: AgentType, version?: number): AgentDefinition | undefined {
    if (version !== undefined) {
      return this.resolveByTypeAndVersion(type, version);
    }

    const activeVersions = this.listActive().filter((def) => def.type === type);
    if (activeVersions.length === 0) return undefined;

    return activeVersions.sort((a, b) => b.version - a.version)[0];
  }

  /** Resolve an exact type + version combination. */
  public resolveByTypeAndVersion(type: AgentType, version: number): AgentDefinition | undefined {
    const key = this.getRegistrationKey(type, version);
    return this.registry.get(key);
  }

  /** List all registered agent definitions. */
  public list(): AgentDefinition[] {
    return Array.from(this.registry.values());
  }

  /** List only active agent definitions. */
  public listActive(): AgentDefinition[] {
    return this.listByStatus(AgentStatus.ACTIVE);
  }

  /** List agent definitions by status. */
  public listByStatus(status: AgentStatus): AgentDefinition[] {
    return this.list().filter((def) => def.status === status);
  }

  /** Enable (set ACTIVE) an agent definition. */
  public enable(type: AgentType, version: number): boolean {
    const def = this.resolveByTypeAndVersion(type, version);
    if (!def) return false;

    // AgentDefinition interfaces are readonly by design, so we re-register
    // with the updated status via a shallow copy.
    const updated: AgentDefinition = { ...def, status: AgentStatus.ACTIVE };
    this.registry.set(this.getRegistrationKey(type, version), updated);
    this.logger.log({ event: 'agent_definition_enabled', agentType: type, version });
    return true;
  }

  /** Disable an agent definition. */
  public disable(type: AgentType, version: number): boolean {
    const def = this.resolveByTypeAndVersion(type, version);
    if (!def) return false;

    const updated: AgentDefinition = { ...def, status: AgentStatus.DISABLED };
    this.registry.set(this.getRegistrationKey(type, version), updated);
    this.logger.log({ event: 'agent_definition_disabled', agentType: type, version });
    return true;
  }

  /** Deprecate an agent definition. */
  public deprecate(type: AgentType, version: number): boolean {
    const def = this.resolveByTypeAndVersion(type, version);
    if (!def) return false;

    const updated: AgentDefinition = { ...def, status: AgentStatus.DEPRECATED };
    this.registry.set(this.getRegistrationKey(type, version), updated);
    this.logger.log({ event: 'agent_definition_deprecated', agentType: type, version });
    return true;
  }

  /** Build registry key from type and version. */
  public getRegistrationKey(type: AgentType, version: number): string {
    return `${String(type)}:${version}`;
  }

  /** Compute SHA-256 hash of definition for change detection. */
  public calculateDefinitionHash(definition: AgentDefinition): string {
    const hashable = {
      type: definition.type,
      version: definition.version,
      promptId: definition.promptId,
      promptVersion: definition.promptVersion,
      allowedToolNames: [...definition.allowedToolNames].sort(),
      requiredCapabilities: [...definition.requiredCapabilities].sort(),
      executionMode: definition.executionMode,
      timeoutMs: definition.timeoutMs,
      maxToolRounds: definition.maxToolRounds,
      maxToolCalls: definition.maxToolCalls,
      maxInputTokens: definition.maxInputTokens,
      maxOutputTokens: definition.maxOutputTokens,
    };

    return createHash('sha256')
      .update(JSON.stringify(hashable))
      .digest('hex');
  }

  /**
   * Synchronize all in-memory registered definitions to the database idempotently.
   */
  public async syncToDatabase(prisma: {
    agentDefinitionRecord: {
      upsert: (args: {
        where: { agentType_version: { agentType: AgentType; version: number } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  }): Promise<{ synced: number }> {
    let synced = 0;
    for (const def of this.list()) {
      const definitionHash = this.calculateDefinitionHash(def);
      const schemaHash = createHash('sha256')
        .update(JSON.stringify({
          input: def.inputSchema ? 'defined' : 'undefined',
          output: def.outputSchema ? 'defined' : 'undefined',
        }))
        .digest('hex');

      await prisma.agentDefinitionRecord.upsert({
        where: {
          agentType_version: {
            agentType: def.type,
            version: def.version,
          },
        },
        create: {
          agentType: def.type,
          version: def.version,
          displayName: def.displayName,
          description: def.description,
          status: def.status,
          promptId: def.promptId,
          promptVersion: def.promptVersion,
          definitionHash,
          schemaHash,
          allowedTools: [...def.allowedToolNames],
          capabilities: [...def.requiredCapabilities],
        },
        update: {
          displayName: def.displayName,
          description: def.description,
          status: def.status,
          promptId: def.promptId,
          promptVersion: def.promptVersion,
          definitionHash,
          schemaHash,
          allowedTools: [...def.allowedToolNames],
          capabilities: [...def.requiredCapabilities],
        },
      });
      synced++;
    }
    this.logger.log({ event: 'agent_definitions_synced_to_database', count: synced });
    return { synced };
  }
}
