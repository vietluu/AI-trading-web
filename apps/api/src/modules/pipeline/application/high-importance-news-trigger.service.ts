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
  type HighImportanceNewsEvent,
} from "../../external-data/application/services/external-data-event-bus.service";
import { PipelineService } from "./pipeline.service";

const NEWS_TRIGGER_DEDUPE_SECONDS = 60 * 60;

@Injectable()
export class HighImportanceNewsTriggerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(HighImportanceNewsTriggerService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly events: ExternalDataEventBus,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly pipeline: PipelineService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onHighImportanceNews((event) => {
      void this.triggerAffectedSchedules(event).catch((error: unknown) => {
        this.logger.error({
          event: "high_importance_news_trigger_failed",
          articleId: event.id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  private async triggerAffectedSchedules(
    news: HighImportanceNewsEvent,
  ): Promise<void> {
    if (news.importanceScore < 80 || news.symbols.length === 0) return;
    const assets = new Set(news.symbols.map(normalizeAsset).filter(Boolean));
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
      if (!schedule.user.exchangeConnections.some(
        (connection) => connection.provider === schedule.provider,
      )) continue;
      const affectedSymbols = schedule.symbols.filter((symbol) =>
        assets.has(normalizeAsset(symbol)),
      );
      await Promise.all(
        affectedSymbols.map(async (symbol) => {
          const dedupeKey = `pipeline:news-event:${schedule.id}:${news.id}:${symbol}`;
          const reserved = await this.redis.setNx(
            dedupeKey,
            news.publishedAt,
            NEWS_TRIGGER_DEDUPE_SECONDS,
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
                  newsEvent: {
                    id: news.id,
                    importanceScore: news.importanceScore,
                    publishedAt: news.publishedAt,
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

function normalizeAsset(symbol: string): string {
  return symbol.trim().toUpperCase().split(/[-_/]/, 1)[0] ?? "";
}
