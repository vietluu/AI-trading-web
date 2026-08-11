import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PerformanceService } from './performance.service';
import { SelfLearningService } from './self-learning.service';
import { DistributedTaskLockService } from '../../../redis/distributed-task-lock.service';

@Injectable()
export class ReflectionSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReflectionSchedulerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly performance: PerformanceService,
    private readonly selfLearning: SelfLearningService,
    private readonly config: ConfigService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    if (!this.config.get<boolean>('REFLECTION_ENABLED', true)) return;
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async sweep() {
    if (this.taskLock) {
      await this.taskLock.run('reflection-sweep', 300, () => this.sweepOnce());
      return;
    }
    await this.sweepOnce();
  }

  private async sweepOnce() {
    try {
      const result = await this.performance.evaluateDue();
      this.logger.log({ event: 'performance_evaluation_sweep', ...result });

      // Active shadow/canary/rollback lifecycles must continue even when no
      // new live performance row was created in this particular sweep. This
      // also guarantees expiry-based rejection and rollback are evaluated.
      const activeUserIds = await this.selfLearning.activeLifecycleUserIds();
      const evaluatedUserIds = new Set(result.evaluatedUserIds);
      const lifecycleUserIds = [...new Set([...result.evaluatedUserIds, ...activeUserIds])];
      if (lifecycleUserIds.length > 0) {
        for (const userId of lifecycleUserIds) {
          try {
            // Phase C: Evaluate shadow mode performance & promote if qualified
            await this.selfLearning.evaluateShadowSignals(userId);
            await this.selfLearning.evaluateCanary(userId);
            const rolledBack = await this.selfLearning.evaluateLiveRollback(userId);
            if (rolledBack) continue;
            if (evaluatedUserIds.has(userId)) {
              // Phase A: Auto-tune decision thresholds
              await this.selfLearning.tuneParameters(userId);
              // Phase B: Auto-tune agent weights (creates shadow candidate config)
              await this.selfLearning.optimizeAgentWeights(userId);
            }
          } catch (userError) {
            this.logger.warn({
              event: 'user_self_learning_failed',
              userId,
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
