import { Injectable, Logger } from '@nestjs/common';
import { ExchangeAnnouncementCategory, ExchangeProvider, ExternalDataProvider } from '@prisma/client';
import { ExternalHttpClient } from '../../http/external-http-client';
import { GenericRssAdapter } from '../rss/generic-rss.adapter';

export interface NormalizedExchangeAnnouncementPayload {
  externalId?: string;
  provider: ExchangeProvider;
  category: ExchangeAnnouncementCategory;
  title: string;
  summary?: string;
  canonicalUrl: string;
  publishedAt: Date;
  relatedSymbols: string[];
  importanceScore: number;
  sourceReliabilityScore: number;
  rawLanguage?: string;
}

@Injectable()
export class BinanceAnnouncementAdapter {
  readonly provider: ExternalDataProvider = ExternalDataProvider.BINANCE_ANNOUNCEMENTS;
  private readonly logger = new Logger(BinanceAnnouncementAdapter.name);

  // Official Binance announcement feed URL or fallback RSS
  private readonly feedUrl = process.env.BINANCE_ANNOUNCEMENTS_URL || 'https://www.binance.com/en/support/announcement/rss';

  constructor(
    private readonly httpClient: ExternalHttpClient,
    private readonly rssParser: GenericRssAdapter,
  ) {}

  async fetchLatest(): Promise<NormalizedExchangeAnnouncementPayload[]> {
    try {
      const response = await this.httpClient.fetch({ url: this.feedUrl });
      const rawItems = this.rssParser.parseFeedXml(response.body);

      return rawItems.map((item) => {
        const category = this.categorizeAnnouncement(item.title);
        const relatedSymbols = this.extractSymbols(item.title);
        const importanceScore = this.calculateImportance(category);

        return {
          externalId: item.externalId,
          provider: ExchangeProvider.BINANCE_FUTURES,
          category,
          title: item.title,
          summary: item.excerpt,
          canonicalUrl: item.url,
          publishedAt: item.publishedAt,
          relatedSymbols,
          importanceScore,
          sourceReliabilityScore: 100, // Official source
          rawLanguage: item.rawLanguage || 'en',
        };
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to fetch Binance announcements: ${msg}`);
      return [];
    }
  }

  categorizeAnnouncement(title: string): ExchangeAnnouncementCategory {
    const lower = title.toLowerCase();
    if (lower.includes('will list') || lower.includes('new listing') || lower.includes('lists')) {
      return ExchangeAnnouncementCategory.LISTING;
    }
    if (lower.includes('delist') || lower.includes('removal') || lower.includes('cease trading')) {
      return ExchangeAnnouncementCategory.DELISTING;
    }
    if (lower.includes('futures launch') || lower.includes('usd-m perpetual') || lower.includes('coin-m perpetual')) {
      return ExchangeAnnouncementCategory.FUTURES_LAUNCH;
    }
    if (lower.includes('maintenance') || lower.includes('system upgrade')) {
      return ExchangeAnnouncementCategory.MAINTENANCE;
    }
    if (lower.includes('suspend') || lower.includes('halt')) {
      return ExchangeAnnouncementCategory.TRADING_SUSPENSION;
    }
    if (lower.includes('leverage') || lower.includes('margin') || lower.includes('tick size')) {
      return ExchangeAnnouncementCategory.MARGIN_RULES;
    }
    if (lower.includes('api')) {
      return ExchangeAnnouncementCategory.API_CHANGE;
    }
    if (lower.includes('security') || lower.includes('incident') || lower.includes('vulnerability')) {
      return ExchangeAnnouncementCategory.SECURITY_NOTICE;
    }
    if (lower.includes('proof of reserves') || lower.includes('por')) {
      return ExchangeAnnouncementCategory.PROOF_OF_RESERVES;
    }
    return ExchangeAnnouncementCategory.PROMOTION;
  }

  calculateImportance(category: ExchangeAnnouncementCategory): number {
    switch (category) {
      case ExchangeAnnouncementCategory.LISTING:
      case ExchangeAnnouncementCategory.DELISTING:
      case ExchangeAnnouncementCategory.FUTURES_LAUNCH:
      case ExchangeAnnouncementCategory.FUTURES_DELISTING:
      case ExchangeAnnouncementCategory.SECURITY_NOTICE:
        return 90;
      case ExchangeAnnouncementCategory.TRADING_SUSPENSION:
      case ExchangeAnnouncementCategory.MARGIN_RULES:
      case ExchangeAnnouncementCategory.MAINTENANCE:
        return 80;
      case ExchangeAnnouncementCategory.API_CHANGE:
      case ExchangeAnnouncementCategory.PROOF_OF_RESERVES:
        return 70;
      default:
        return 40;
    }
  }

  private extractSymbols(title: string): string[] {
    const symbols = new Set<string>();
    const matches = title.match(/\b([A-Z0-9]{2,10})(USDT|BUSD|PERP)?\b/g);
    if (matches) {
      matches.forEach((m) => {
        if (!['BINANCE', 'ANNOUNCEMENT', 'NOTICE', 'SUPPORT', 'FUTURES', 'UPDATE', 'USDT'].includes(m)) {
          symbols.add(m.endsWith('USDT') ? m.replace('USDT', '-USDT') : `${m}-USDT`);
        }
      });
    }
    return Array.from(symbols);
  }
}
