import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { PipelineScheduleInputSchema } from "@platform/shared";
import type { PipelineSchedule } from "@prisma/client";
import type { ExchangeProvider } from "../../../exchange/domain/exchange.types";
import { PrismaService } from "../../../database/prisma.service";
import { cronMatches, validateCron } from "../domain/cron";
import { PipelineService } from "./pipeline.service";
import { PipelineConfigService } from "./pipeline-config.service";
import { DistributedTaskLockService } from "../../../redis/distributed-task-lock.service";
import { MarketEventScannerService } from "./market-event-scanner.service";

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
    @Optional() private readonly eventScanner?: MarketEventScannerService,
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
      void this.tick().catch((error) => {
        this.logger.error({ event: 'pipeline_scheduler_tick_failed', message: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
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
        if (!due) {
          await this.triggerConfirmedMarketEvents(schedule);
          continue;
        }

        this.activeSchedules.add(schedule.id);
        try {
          const triggerPromises: Promise<boolean>[] = [];
          for (const symbol of schedule.symbols) {
            if (this.eventScanner) {
              try {
                const anchor = await this.eventScanner.reserveAnchor({
                  userId: schedule.userId,
                  provider: schedule.provider as ExchangeProvider,
                  symbol,
                  strategyIds: schedule.strategyIds,
                });
                if (!anchor.run) {
                  this.logger.debug({
                    event: "pipeline_anchor_duplicate_skipped",
                    scheduleId: schedule.id,
                    symbol,
                    fingerprint: anchor.fingerprint,
                  });
                  // Count this as a healthy scheduler cycle so a duplicate
                  // candle is not reconsidered every five seconds.
                  triggerPromises.push(Promise.resolve(true));
                  continue;
                }
              } catch (error) {
                // Fingerprinting is an optimization. The pipeline freshness
                // and risk gates remain authoritative if Redis/data lookup fails.
                this.logger.warn({
                  event: "pipeline_anchor_fingerprint_failed",
                  scheduleId: schedule.id,
                  symbol,
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            }
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

  private async triggerConfirmedMarketEvents(schedule: PipelineSchedule): Promise<void> {
    if (
      !this.eventScanner ||
      schedule.mode !== "INTERVAL" ||
      (schedule.intervalMs ?? 0) < 15 * 60_000
    ) return;

    await Promise.all(schedule.symbols.map(async (symbol) => {
      try {
        const scan = await this.eventScanner!.scan({
          userId: schedule.userId,
          provider: schedule.provider as ExchangeProvider,
          symbol,
          strategyIds: schedule.strategyIds,
        });
        if (!scan.triggered || !scan.evidence) return;
        await this.pipeline.trigger(
          schedule.userId,
          {
            pipelineId: schedule.pipelineId,
            symbol,
            provider: schedule.provider,
            params: {
              interval: "15m",
              strategyIds: schedule.strategyIds,
              eventScan: {
                fingerprint: scan.fingerprint,
                ...scan.evidence,
              },
            },
          },
          "EVENT",
          {
            scheduleId: schedule.id,
            maxRunsPerHour: schedule.maxRunsPerHour,
          },
        );
        this.logger.log({
          event: "pipeline_market_event_triggered",
          scheduleId: schedule.id,
          symbol,
          direction: scan.evidence.direction,
          fingerprint: scan.fingerprint,
          reasons: scan.evidence.reasons,
        });
      } catch (error) {
        this.logger.warn({
          event: "pipeline_market_event_scan_failed",
          scheduleId: schedule.id,
          symbol,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  }

}
