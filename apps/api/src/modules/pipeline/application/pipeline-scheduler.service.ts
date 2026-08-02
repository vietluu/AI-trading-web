import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PipelineScheduleInputSchema } from "@platform/shared";
import { PrismaService } from "../../../database/prisma.service";
import { cronMatches, validateCron } from "../domain/cron";
import { PipelineService } from "./pipeline.service";
import { PipelineConfigService } from "./pipeline-config.service";

@Injectable()
export class PipelineSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastTickAt?: Date;
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly config: PipelineConfigService,
  ) {}
  onModuleInit() {
    if (this.config.enabled)
      this.timer = setInterval(() => void this.tick(), 5_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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
  status() {
    return {
      enabled: this.config.enabled,
      running: this.running,
      lastTickAt: this.lastTickAt,
    };
  }

  async tick(now = new Date()) {
    if (this.running || !this.config.enabled) return;
    this.running = true;
    this.lastTickAt = now;
    try {
      const schedules = await this.prisma.pipelineSchedule.findMany({
        where: { enabled: true },
      });
      for (const schedule of schedules) {
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
        try {
          await this.prisma.pipelineSchedule.update({
            where: { id: schedule.id },
            data: { lastTriggeredAt: now },
          });
          await Promise.all(
            schedule.symbols.flatMap((symbol) =>
              schedule.strategyIds.map((strategyId) =>
                this.pipeline.trigger(
                  schedule.userId,
                  {
                    pipelineId: schedule.pipelineId,
                    symbol,
                    provider: schedule.provider,
                    params: { strategyId },
                  },
                  "SCHEDULE",
                  {
                    scheduleId: schedule.id,
                    maxRunsPerHour: schedule.maxRunsPerHour,
                  },
                ),
              ),
            ),
          );
        } catch (error) {
          this.logger.error({
            event: "pipeline_schedule_trigger_failed",
            scheduleId: schedule.id,
            message:
              error instanceof Error
                ? error.message
                : "Unknown scheduler error",
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
