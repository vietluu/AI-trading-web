import { Injectable } from '@nestjs/common';
import { AgentRegistryService } from '../../infrastructure/registry/agent-registry.service';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { AgentHealthStatus } from '../../domain/enums';
import type { AgentHealthDto } from '@platform/shared';

const agentStatusToHealthDtoStatus: Record<string, AgentHealthDto['status']> = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  DEPRECATED: 'DEPRECATED',
  EXPERIMENTAL: 'EXPERIMENTAL',
  UNAVAILABLE: 'UNAVAILABLE',
};

@Injectable()
export class AgentHealthService {
  constructor(
    private readonly agentRegistryService: AgentRegistryService,
    private readonly agentRunRepository: AgentRunRepository,
  ) {}

  public async getHealth(): Promise<AgentHealthDto[]> {
    const agents = this.agentRegistryService.list();
    const healthStats: AgentHealthDto[] = [];

    for (const agent of agents) {
      const stats = await this.agentRunRepository.getStatsForAgent(agent.type);

      let healthStatus = AgentHealthStatus.HEALTHY;
      const reasons: string[] = [];

      const normalizedStatus = String(agent.status);
      if (normalizedStatus !== 'ACTIVE') {
        healthStatus = AgentHealthStatus.DISABLED;
        reasons.push(`Agent is in ${normalizedStatus} state`);
      } else if (stats.successRatePct < 80) {
        healthStatus = AgentHealthStatus.DEGRADED;
        reasons.push(`Success rate is low (${stats.successRatePct}%)`);
      }

      const dtoStatus = agentStatusToHealthDtoStatus[normalizedStatus] ?? 'UNAVAILABLE';
      healthStats.push({
        agentType: agent.type,
        version: agent.version,
        status: dtoStatus,
        healthStatus: healthStatus as AgentHealthDto['healthStatus'],
        reasons,
        avgLatencyMs: stats.avgLatencyMs,
        successRatePct: stats.successRatePct,
        totalRuns: stats.totalRuns,
        activeRuns: 0,
      });
    }

    return healthStats;
  }
}
