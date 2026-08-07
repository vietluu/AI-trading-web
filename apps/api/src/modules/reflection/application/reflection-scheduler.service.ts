import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceService } from './performance.service';
import { SelfLearningService } from './self-learning.service';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ReflectionSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReflectionSchedulerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly performance: PerformanceService,
    private readonly selfLearning: SelfLearningService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get<boolean>('REFLECTION_ENABLED', true)) return;
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async sweep() {
    try {
      const result = await this.performance.evaluateDue();
      this.logger.log({ event: 'performance_evaluation_sweep', ...result });

      // Run self-learning feedback loops if new evaluations were recorded
      if (result.evaluated > 0) {
        const users = await this.prisma.user.findMany({ select: { id: true } });
        for (const user of users) {
          try {
            // Phase C: Evaluate shadow mode performance & promote if qualified
            await this.selfLearning.evaluateShadowSignals(user.id);
            // Phase A: Auto-tune decision thresholds
            await this.selfLearning.tuneParameters(user.id);
            // Phase B: Auto-tune agent weights (creates shadow candidate config)
            await this.selfLearning.optimizeAgentWeights(user.id);
          } catch (userError) {
            this.logger.warn({
              event: 'user_self_learning_failed',
              userId: user.id,
              error: userError instanceof Error ? userError.message : String(userError),
            });
          }
        }
      }
    } catch (error) {
      this.logger.error({
        event: 'performance_evaluation_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
