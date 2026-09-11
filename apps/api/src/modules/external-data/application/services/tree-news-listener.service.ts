import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../database/prisma.service";
import { RedisService } from "../../../../redis/redis.service";
import { ExternalDataEventBus } from "./external-data-event-bus.service";
import {
  TreeNewsItem,
  TreeNewsMacroAdapter,
} from "../../infrastructure/providers/macro/tree-news-macro.adapter";
import { parseMacroReleaseFromText } from "../../infrastructure/providers/macro/macro-news-parser";
import { scoreMacroTrend } from "../../../agents/domain/definitions/macro-analyst.definition";

const DEDUPE_TTL_SECONDS = 86_400; // 24 hours

@Injectable()
export class TreeNewsListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TreeNewsListenerService.name);
  private unsubscribeStream?: () => void;
  private pollInterval?: NodeJS.Timeout;

  constructor(
    private readonly adapter: TreeNewsMacroAdapter,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventBus: ExternalDataEventBus,
    @Optional() private readonly config?: ConfigService,
  ) {}

  onModuleInit(): void {
    const isEnabled = this.config?.get<string>("ENABLE_TREE_NEWS_FEED", "true") !== "false";
    if (!isEnabled) {
      this.logger.log("Tree News real-time listener is disabled via configuration");
      return;
    }

    this.logger.log("Starting real-time Tree News macro stream listener...");
    this.unsubscribeStream = this.adapter.connectStream((item) => {
      void this.handleIncomingNews(item).catch((err: unknown) => {
        this.logger.error({
          event: "handle_tree_news_failed",
          newsId: item._id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    });

    // Safety fallback: poll every 15s in background to ensure zero missed events
    this.pollInterval = setInterval(() => {
      void this.pollFallback().catch(() => undefined);
    }, 15_000);
  }

  onModuleDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.unsubscribeStream?.();
  }

  private async pollFallback(): Promise<void> {
    const items = await this.adapter.fetchLatestNews(10);
    for (const item of items) {
      await this.handleIncomingNews(item).catch(() => undefined);
    }
  }

  async handleIncomingNews(item: TreeNewsItem): Promise<boolean> {
    if (!item || !item.title) return false;

    const parsed = parseMacroReleaseFromText(item.title);
    if (!parsed) return false;

    const dedupeKey = `macro:treenews:${item._id}`;
    const isNew = await this.redis.setNx(dedupeKey, String(item.time), DEDUPE_TTL_SECONDS);
    if (!isNew) return false;

    this.logger.log({
      event: "macro_news_detected",
      newsId: item._id,
      title: item.title,
      parsed,
    });

    const publishedAt = new Date(item.time || Date.now());

    // Match existing scheduled event around this time (+- 12h)
    const existing = await this.prisma.macroEconomicEvent.findFirst({
      where: {
        category: parsed.category,
        importance: parsed.importance,
        scheduledAt: {
          gte: new Date(publishedAt.getTime() - 12 * 60 * 60_000),
          lte: new Date(publishedAt.getTime() + 12 * 60 * 60_000),
        },
      },
      orderBy: { scheduledAt: "asc" },
    });

    let savedEvent;
    if (existing) {
      savedEvent = await this.prisma.macroEconomicEvent.update({
        where: { id: existing.id },
        data: {
          actual: parsed.actual,
          ...(parsed.forecast ? { forecast: parsed.forecast } : {}),
          ...(parsed.previous ? { previous: parsed.previous } : {}),
          status: "RELEASED",
          sourceUrl: item.url ?? existing.sourceUrl,
          updatedAt: new Date(),
        },
      });
    } else {
      savedEvent = await this.prisma.macroEconomicEvent.create({
        data: {
          provider: "TREE_NEWS",
          name: parsed.name,
          category: parsed.category,
          importance: parsed.importance,
          country: "US",
          currency: "USD",
          scheduledAt: publishedAt,
          actual: parsed.actual,
          forecast: parsed.forecast,
          previous: parsed.previous,
          status: "RELEASED",
          sourceUrl: item.url ?? null,
        },
      });
    }

    const macroTrend = scoreMacroTrend([
      {
        name: savedEvent.name,
        importance: savedEvent.importance,
        actual: savedEvent.actual,
        forecast: savedEvent.forecast,
      },
    ]);

    const actualNum = parseFloat(parsed.actual);
    const forecastNum = parsed.forecast ? parseFloat(parsed.forecast) : NaN;
    const surprise =
      Number.isFinite(actualNum) && Number.isFinite(forecastNum)
        ? actualNum - forecastNum
        : null;

    this.eventBus.emitMacroRelease({
      id: savedEvent.id,
      name: savedEvent.name,
      category: savedEvent.category,
      importance: savedEvent.importance,
      actual: savedEvent.actual!,
      forecast: savedEvent.forecast,
      previous: savedEvent.previous,
      unit: savedEvent.unit,
      country: savedEvent.country,
      currency: savedEvent.currency,
      scheduledAt: savedEvent.scheduledAt.toISOString(),
      releasedAt: new Date().toISOString(),
      macroTrend,
      surprise,
    });

    this.logger.log({
      event: "macro_release_dispatched",
      eventId: savedEvent.id,
      name: savedEvent.name,
      actual: savedEvent.actual,
      forecast: savedEvent.forecast,
      macroTrend,
      surprise,
    });

    return true;
  }
}
