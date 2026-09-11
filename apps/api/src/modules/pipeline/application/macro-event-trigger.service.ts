import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { RedisService } from "../../../redis/redis.service";
import {
  ExternalDataEventBus,
  type MacroReleaseEvent,
} from "../../external-data/application/services/external-data-event-bus.service";
import { PipelineService } from "./pipeline.service";

const MACRO_TRIGGER_DEDUPE_SECONDS = 60 * 60;

@Injectable()
export class MacroEventTriggerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MacroEventTriggerService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly events: ExternalDataEventBus,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly pipeline: PipelineService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onMacroRelease((event) => {
      void this.triggerMacroSchedules(event).catch((error: unknown) => {
        this.logger.error({
          event: "macro_release_trigger_failed",
          macroEventId: event.id,
          name: event.name,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  private async triggerMacroSchedules(
    macro: MacroReleaseEvent,
  ): Promise<void> {
    if (macro.importance !== "HIGH") return;

    const schedules = await this.prisma.pipelineSchedule.findMany({
      where: { enabled: true },
      include: {
        user: {
          select: {
            exchangeConnections: {
              where: { isEnabled: true, isVerified: true },
              select: { provider: true },
            },
          },
        },
      },
    });

    for (const schedule of schedules) {
      if (
        !schedule.user.exchangeConnections.some(
          (connection) => connection.provider === schedule.provider,
        )
      ) {
        continue;
      }

      await Promise.all(
        schedule.symbols.map(async (symbol) => {
          const dedupeKey = `pipeline:macro-release:${schedule.id}:${macro.id}:${symbol}`;
          const reserved = await this.redis.setNx(
            dedupeKey,
            macro.releasedAt,
            MACRO_TRIGGER_DEDUPE_SECONDS,
          );
          if (!reserved) return;

          try {
            await this.pipeline.trigger(
              schedule.userId,
              {
                pipelineId: schedule.pipelineId,
                symbol,
                provider: schedule.provider,
                params: {
                  strategyIds: schedule.strategyIds,
                  macroRelease: {
                    id: macro.id,
                    name: macro.name,
                    category: macro.category,
                    importance: macro.importance,
                    actual: macro.actual,
                    forecast: macro.forecast,
                    previous: macro.previous,
                    surprise: macro.surprise,
                    macroTrend: macro.macroTrend,
                    releasedAt: macro.releasedAt,
                  },
                },
              },
              "EVENT",
              {
                scheduleId: schedule.id,
                maxRunsPerHour: schedule.maxRunsPerHour,
                bypassCooldown: true,
              },
            );
          } catch (error) {
            await this.redis.delete(dedupeKey).catch(() => undefined);
            throw error;
          }
        }),
      );
    }
  }
}
