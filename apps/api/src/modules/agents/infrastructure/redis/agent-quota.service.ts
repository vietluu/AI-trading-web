import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../../redis/redis.service';

@Injectable()
export class AgentQuotaService {
  private readonly logger = new Logger(AgentQuotaService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async checkQuota(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    const maxRpm = this.configService.get<number>('AGENT_MAX_RUNS_PER_MINUTE', 5);
    const maxRph = this.configService.get<number>('AGENT_MAX_RUNS_PER_HOUR', 100);
    const maxRpd = this.configService.get<number>('AGENT_MAX_RUNS_PER_DAY', 500);

    const minKey = `ai:agent:quota:user:${userId}:rpm`;
    const hourKey = `ai:agent:quota:user:${userId}:rph`;
    const dayKey = `ai:agent:quota:user:${userId}:rpd`;

    const [minRunsStr, hourRunsStr, dayRunsStr] = await Promise.all([
      this.redisService.get(minKey),
      this.redisService.get(hourKey),
      this.redisService.get(dayKey),
    ]);

    const minRuns = minRunsStr ? parseInt(minRunsStr, 10) : 0;
    const hourRuns = hourRunsStr ? parseInt(hourRunsStr, 10) : 0;
    const dayRuns = dayRunsStr ? parseInt(dayRunsStr, 10) : 0;

    if (minRuns >= maxRpm) {
      return { allowed: false, reason: `Exceeded minute quota of ${maxRpm}` };
    }
    if (hourRuns >= maxRph) {
      return { allowed: false, reason: `Exceeded hourly quota of ${maxRph}` };
    }
    if (dayRuns >= maxRpd) {
      return { allowed: false, reason: `Exceeded daily quota of ${maxRpd}` };
    }

    return { allowed: true };
  }

  async recordRun(userId: string): Promise<void> {
    const minKey = `ai:agent:quota:user:${userId}:rpm`;
    const hourKey = `ai:agent:quota:user:${userId}:rph`;
    const dayKey = `ai:agent:quota:user:${userId}:rpd`;

    await Promise.all([
      this.redisService.incrementWithTtl(minKey, 60),
      this.redisService.incrementWithTtl(hourKey, 3600),
      this.redisService.incrementWithTtl(dayKey, 86400),
    ]);
  }

  async checkGlobalQuota(): Promise<{ allowed: boolean; reason?: string }> {
    return { allowed: true };
  }
}
