import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { PipelineScheduleInputSchema } from "@platform/shared";
import { PrismaService } from "../../../database/prisma.service";
import { cronMatches, validateCron } from "../domain/cron";
import { PipelineService } from "./pipeline.service";
import { PipelineConfigService } from "./pipeline-config.service";
import { DistributedTaskLockService } from "../../../redis/distributed-task-lock.service";

@Injectable()
export class PipelineSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastTickAt?: Date;
  private destroyed = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly config: PipelineConfigService,
    @Optional() private readonly taskLock?: DistributedTaskLockService,
  ) {}
  onModuleInit() {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true') return;
    if (this.config.enabled) this.scheduleNextTick();
  }
  onModuleDestroy() {
    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextTick() {
    if (this.destroyed || !this.config.enabled) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => {
        if (!this.destroyed && this.config.enabled) this.scheduleNextTick();
      });
    }, 5_000);
  }

  async create(userId: string, raw: unknown) {
    const input = PipelineScheduleInputSchema.parse(raw);
    if (input.cron) validateCron(input.cron);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw new ConflictException("Invalid schedule timezone");
    }
    const duplicate = await this.prisma.pipelineSchedule.findFirst({
      where: {
        userId,
        pipelineId: input.pipelineId,
        provider: input.provider,
        mode: input.mode,
        cron: input.cron ?? null,
        intervalMs: input.intervalMs ?? null,
        symbols: { equals: input.symbols },
        strategyIds: { equals: input.strategyIds },
      },
    });
    if (duplicate)
      throw new ConflictException("An equivalent schedule already exists");
    return this.prisma.pipelineSchedule.create({
      data: {
        ...input,
        userId,
        cron: input.cron,
        intervalMs: input.intervalMs,
      },
    });
  }
  list(userId: string) {
    return this.prisma.pipelineSchedule.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
  async setEnabled(userId: string, id: string, enabled: boolean) {
    const schedule = await this.prisma.pipelineSchedule.findFirst({
      where: { id, userId },
    });
    if (!schedule) throw new ConflictException("Schedule not found");
    return this.prisma.pipelineSchedule.update({
      where: { id },
      data: { enabled },
    });
  }
  async cancel(userId: string, id: string) {
    const result = await this.prisma.pipelineSchedule.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) throw new ConflictException("Schedule not found");
    return { cancelled: true, id };
  }
  status() {
    return {
      enabled: this.config.enabled,
      running: this.running,
      lastTickAt: this.lastTickAt,
    };
  }

  private readonly activeSchedules = new Set<string>();

  async tick(now = new Date()) {
    if (this.taskLock) {
      await this.taskLock.run('pipeline-scheduler-tick', 30, () => this.tickOnce(now));
      return;
    }
    await this.tickOnce(now);
  }

  private async tickOnce(now: Date) {
    if (this.running || !this.config.enabled) return;
    this.running = true;
    this.lastTickAt = now;
    try {
      const schedules = await this.prisma.pipelineSchedule.findMany({
        where: { enabled: true },
      });
      for (const schedule of schedules) {
        if (this.activeSchedules.has(schedule.id)) continue;
        const due =
          schedule.mode === "INTERVAL"
            ? !schedule.lastTriggeredAt ||
              now.getTime() - schedule.lastTriggeredAt.getTime() >=
                (schedule.intervalMs ?? Number.MAX_SAFE_INTEGER)
            : !!schedule.cron &&
              cronMatches(schedule.cron, now, schedule.timezone) &&
              (!schedule.lastTriggeredAt ||
                now.getTime() - schedule.lastTriggeredAt.getTime() >= 60_000);
        if (!due) continue;

        this.activeSchedules.add(schedule.id);
        try {
          const triggerPromises: Promise<boolean>[] = [];
          for (const symbol of schedule.symbols) {
            triggerPromises.push(
              this.pipeline
                .trigger(
                  schedule.userId,
                  {
                    pipelineId: schedule.pipelineId,
                    symbol,
                    provider: schedule.provider,
                    // One shared agent/fusion snapshot per symbol. Strategy
                    // arbitration happens inside the runner before the gates.
                    params: { strategyIds: schedule.strategyIds },
                  },
                  "SCHEDULE",
                  {
                    scheduleId: schedule.id,
                    maxRunsPerHour: schedule.maxRunsPerHour,
                  },
                )
                .then(() => true)
                .catch((error: unknown) => {
                  this.logger.error({
                    event: "pipeline_schedule_trigger_failed",
                    scheduleId: schedule.id,
                    symbol,
                    strategyIds: schedule.strategyIds,
                    message:
                      error instanceof Error
                        ? error.message
                        : "Unknown scheduler error",
                  });
                  return false;
                }),
            );
          }

          const results = await Promise.all(triggerPromises);
          if (results.some(Boolean)) {
            try {
              await this.prisma.pipelineSchedule.update({
                where: { id: schedule.id },
                data: { lastTriggeredAt: now },
              });
            } catch (error) {
              this.logger.error({
                event: "pipeline_schedule_stamp_failed",
                scheduleId: schedule.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } finally {
          this.activeSchedules.delete(schedule.id);
        }
      }
    } finally {
      this.running = false;
    }
  }

}
