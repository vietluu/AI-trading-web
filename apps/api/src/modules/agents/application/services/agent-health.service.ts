import { Injectable } from '@nestjs/common';
import { AgentRegistryService } from '../../infrastructure/registry/agent-registry.service';
import { AgentRunRepository } from '../../infrastructure/persistence/agent-run.repository';
import { AgentHealthStatus } from '../../domain/enums';
import { AgentHealthDto } from '@platform/shared';

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

      if (agent.status !== 'ACTIVE') {
        healthStatus = AgentHealthStatus.DISABLED;
        reasons.push(`Agent is in ${agent.status} state`);
      } else if (stats.successRatePct < 80) {
        healthStatus = AgentHealthStatus.DEGRADED;
        reasons.push(`Success rate is low (${stats.successRatePct}%)`);
      }

      healthStats.push({
        agentType: agent.type as any,
        version: agent.version,
        status: agent.status as any,
        healthStatus: healthStatus as any,
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
