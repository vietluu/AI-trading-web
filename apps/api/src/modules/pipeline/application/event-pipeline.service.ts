import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { createHash } from 'node:crypto';
import type { Queue } from 'bullmq';
import { MarketEventBus } from '../../../market-data/infrastructure/event-bus/market-event-bus';
import { MarketEventType } from '../../../market-data/domain/market-data.enums';
import { ExchangeInterval, type ExchangeProvider } from '../../../exchange/domain/exchange.types';
import { ExternalDataEventBus, HighImportanceNewsEvent } from '../../external-data/application/services/external-data-event-bus.service';
import { MarketEventScannerService } from './market-event-scanner.service';
import { EventSubscribersService } from './event-subscribers.service';
import { PipelineService } from './pipeline.service';
import { PipelineConfigService } from './pipeline-config.service';
import { PrismaService } from '../../../database/prisma.service';
import { OpportunityWatcherService } from './opportunity-watcher.service';

export const SHARED_EVENT_QUEUE = 'shared-market-events';
export interface SharedMarketEvent {
  id: string;
  kind: 'MARKET' | 'NEWS' | 'MACRO';
  occurredAt: string;
  symbols: string[];
  provider?: string;
  marketWide?: boolean;
  evidence: Record<string, unknown>;
}

export function freshEvent(event: SharedMarketEvent, now = Date.now()): boolean {
  const age = now - Date.parse(event.occurredAt);
  return Number.isFinite(age) && age >= -5_000 && age <= (event.kind === 'MARKET' ? 120_000 : 300_000);
}

export function affectsSymbol(event: SharedMarketEvent, symbol: string): boolean {
  if (event.kind === 'MACRO' || event.marketWide) return true;
  const asset = (value: string) => value.toUpperCase().replace(/[-_/]?(USDT|USDC|USD)$/, '').split(/[-_/]/)[0];
  return event.symbols.some((value) => asset(value) === asset(symbol));
}

@Injectable()
export class EventPipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventPipelineService.name);
  private readonly unsubscribe: Array<() => void> = [];
  private readonly scanning = new Set<string>();
  private readonly lastScan = new Map<string, number>();

  constructor(
    @InjectQueue(SHARED_EVENT_QUEUE) private readonly queue: Queue<SharedMarketEvent>,
    private readonly marketEvents: MarketEventBus,
    private readonly externalEvents: ExternalDataEventBus,
    private readonly scanner: MarketEventScannerService,
    private readonly subscribers: EventSubscribersService,
    private readonly pipeline: PipelineService,
    private readonly config: PipelineConfigService,
    private readonly prisma: PrismaService,
    @Optional() private readonly opportunityWatcher?: OpportunityWatcherService,
  ) {}

  onModuleInit() {
    if (process.env.CLI_DISABLE_SCHEDULERS === 'true' || !this.config.enabled) return;
    this.unsubscribe.push(this.marketEvents.on(MarketEventType.TICKER_UPDATED, (event) => {
      const { provider, symbol } = event.metadata;
      void this.scan(provider, symbol).catch((error) => this.logFailure(error));
    }));
    this.unsubscribe.push(this.externalEvents.onHighImportanceNews((news) => {
      void this.acceptNews(news).catch((error) => this.logFailure(error));
    }));
    this.unsubscribe.push(this.externalEvents.onMacroRelease((macro) => {
      if (macro.importance !== 'HIGH') return;
      void this.enqueue({ id: `macro-${macro.id}-${macro.releasedAt}`, kind: 'MACRO',
        occurredAt: macro.releasedAt, symbols: [], evidence: { macroRelease: macro } })
        .catch((error) => this.logFailure(error));
    }));
    void this.recoverRecentNews().catch((error) => this.logFailure(error));
  }

  onModuleDestroy() { this.unsubscribe.forEach((stop) => stop()); }

  /** The persisted article is the replay source when ingestion/queue delivery is interrupted. */
  async recoverRecentNews() {
    if (!this.config.enabled) return;
    const articles = await this.prisma.newsArticle.findMany({
      where: { status: 'ACTIVE', importanceScore: { gte: 80 }, reliabilityScore: { gte: 70 },
        publishedAt: { gte: new Date(Date.now() - 300_000) } },
      include: { symbols: true, topics: true }, orderBy: { publishedAt: 'desc' }, take: 200,
    });
    for (const article of articles) await this.acceptNews({
      id: article.id, title: article.title, importanceScore: article.importanceScore,
      publishedAt: article.publishedAt.toISOString(), sourceId: article.sourceId,
      canonicalUrl: article.canonicalUrl, reliabilityScore: article.reliabilityScore,
      symbols: article.symbols.map((item) => item.symbol), topics: article.topics.map((item) => item.topic),
    });
  }

  async acceptNews(news: HighImportanceNewsEvent) {
    if (news.importanceScore < 80 || !news.sourceId || !news.canonicalUrl ||
        (news.reliabilityScore ?? 0) < 70) return;
    const source = await this.prisma.externalDataSource.findUnique({ where: { sourceId: news.sourceId } });
    if (!source?.isEnabled || source.isCustom || source.reliabilityScore < 70) return;
    let hostname: string;
    try { hostname = new URL(news.canonicalUrl).hostname.toLowerCase(); } catch { return; }
    const domain = source.baseDomain.toLowerCase().replace(/^www\./, '');
    if (!domain || !(hostname === domain || hostname.endsWith(`.${domain}`))) return;
    const marketWide = !news.symbols.length && (news.topics ?? [])
      .some((topic) => ['macro', 'regulation', 'stablecoin'].includes(topic.toLowerCase()));
    if (!marketWide && !news.symbols.length) return;
    await this.enqueue({ id: `news-${news.id}`, kind: 'NEWS', occurredAt: news.publishedAt,
      symbols: news.symbols, marketWide, evidence: { newsEvent: news } });
  }

  async enqueue(event: SharedMarketEvent) {
    if (!this.config.enabled || !freshEvent(event)) return;
    const id = createHash('sha256').update(event.id).digest('hex');
    await this.queue.add('event', event, { jobId: id, attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } });
  }

  private async scan(provider: ExchangeProvider, symbol: string) {
    const key = `${provider}:${symbol}`;
    if (this.scanning.has(key) || Date.now() - (this.lastScan.get(key) ?? 0) < 3_000) return;
    this.scanning.add(key);
    this.lastScan.set(key, Date.now());
    try {
      const subscribers = await this.subscribers.list();
      if (!subscribers.some((s) => String(s.provider) === String(provider) && s.symbol === symbol)) return;
      const scan = await this.scanner.scan({ userId: 'platform', provider, symbol,
        strategyIds: [], scanIntervalSeconds: 3 });
      if (!scan.triggered || !scan.evidence || !scan.fingerprint) return;
      try {
        await this.enqueue({ id: `market-${scan.fingerprint}`, kind: 'MARKET',
          occurredAt: new Date().toISOString(), symbols: [symbol], provider,
          evidence: { eventScan: { fingerprint: scan.fingerprint, ...scan.evidence } } });
      } catch (error) {
        await this.scanner.releaseEvent({ userId: 'platform', provider, symbol });
        throw error;
      }
    } finally { this.scanning.delete(key); }
  }

  async dispatch(event: SharedMarketEvent) {
    if (!this.config.enabled || !freshEvent(event) || !this.opportunityWatcher) return;
    const subscribers = await this.subscribers.list();
    for (const subscriber of subscribers) {
      if (event.provider && event.provider !== subscriber.provider) continue;
      if (!affectsSymbol(event, subscriber.symbol)) continue;
      // Recheck between recipients: a backlogged event must not become a late entry.
      if (!freshEvent(event)) return;
      const sourceDataCutoff = await this.resolveSourceDataCutoff(event, subscriber);
      if (!sourceDataCutoff) continue;
      const provider = subscriber.provider as unknown as ExchangeProvider;
      const timeframe = event.kind === 'MARKET'
        ? ExchangeInterval.FIVE_MINUTES
        : ExchangeInterval.FIFTEEN_MINUTES;
      const observation = await this.opportunityWatcher.observe({
        userId: subscriber.userId,
        provider,
        symbol: subscriber.symbol,
        timeframe,
        sourceDataCutoff,
      });
      if (observation.state !== 'WATCHING' || !observation.opportunityId) continue;
      // Observation and snapshot persistence can outlive a short-lived event.
      // Do not create queue work that is already unauthorized at dispatch time.
      if (!freshEvent(event)) return;
      await this.pipeline.scheduleProactiveThesis({
        userId: subscriber.userId,
        request: {
          pipelineId: 'proactive-thesis',
          symbol: subscriber.symbol,
          provider: subscriber.provider,
          params: {
            interval: timeframe,
            strategyIds: subscriber.strategyIds,
            opportunityId: observation.opportunityId,
            snapshotId: observation.snapshotId,
            sourceDataCutoff: sourceDataCutoff.toISOString(),
            systemEventId: event.id,
            systemEventExpiresAt: new Date(Date.parse(event.occurredAt) +
              (event.kind === 'MARKET' ? 120_000 : 300_000)).toISOString(),
            ...event.evidence,
          },
        },
      });
    }
  }

  private async resolveSourceDataCutoff(
    event: SharedMarketEvent,
    subscriber: { userId: string; provider: string; symbol: string; strategyIds: string[] },
  ): Promise<Date | undefined> {
    const marketCutoff = event.kind === 'MARKET'
      ? (event.evidence.eventScan as { indicatorCloseTime?: unknown } | undefined)?.indicatorCloseTime
      : undefined;
    if (typeof marketCutoff === 'string') {
      const parsed = new Date(marketCutoff);
      if (Number.isFinite(parsed.getTime())) return parsed;
    }
    const anchor = await this.scanner.reserveAnchor({
      userId: subscriber.userId,
      provider: subscriber.provider as ExchangeProvider,
      symbol: subscriber.symbol,
      strategyIds: subscriber.strategyIds,
    });
    return anchor.sourceDataCutoff;
  }

  private logFailure(error: unknown) {
    this.logger.error({ event: 'shared_event_delivery_failed',
      message: error instanceof Error ? error.message : String(error) });
  }
}
