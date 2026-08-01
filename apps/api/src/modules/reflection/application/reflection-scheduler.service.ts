import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceService } from './performance.service';

@Injectable()
export class ReflectionSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReflectionSchedulerService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly performance: PerformanceService, private readonly config: ConfigService) {}
  onApplicationBootstrap() {
    if (!this.config.get<boolean>('REFLECTION_ENABLED', true)) return;
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
    void this.sweep();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async sweep() {
    try { this.logger.log({ event: 'performance_evaluation_sweep', ...(await this.performance.evaluateDue()) }); }
    catch (error) { this.logger.error({ event: 'performance_evaluation_failed', message: error instanceof Error ? error.message : 'Unknown error' }); }
  }
}
