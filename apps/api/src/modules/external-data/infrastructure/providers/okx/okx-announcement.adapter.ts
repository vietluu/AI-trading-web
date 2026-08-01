import { Injectable, Logger } from '@nestjs/common';
import { ExchangeAnnouncementCategory, ExchangeProvider, ExternalDataProvider } from '@prisma/client';
import { ExternalHttpClient } from '../../http/external-http-client';
import { GenericRssAdapter } from '../rss/generic-rss.adapter';
import { NormalizedExchangeAnnouncementPayload } from '../binance/binance-announcement.adapter';

@Injectable()
export class OkxAnnouncementAdapter {
  readonly provider: ExternalDataProvider = ExternalDataProvider.OKX_ANNOUNCEMENTS;
  private readonly logger = new Logger(OkxAnnouncementAdapter.name);

  private readonly feedUrl = process.env.OKX_ANNOUNCEMENTS_URL || 'https://www.okx.com/support/hc/en-us/rss';

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
          provider: ExchangeProvider.OKX_FUTURES,
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
    } catch (err: any) {
      this.logger.warn(`Failed to fetch OKX announcements: ${err.message}`);
      return [];
    }
  }

  categorizeAnnouncement(title: string): ExchangeAnnouncementCategory {
    const lower = title.toLowerCase();
    if (lower.includes('list') || lower.includes('new perpetual')) {
      return ExchangeAnnouncementCategory.LISTING;
    }
    if (lower.includes('delist') || lower.includes('remove')) {
      return ExchangeAnnouncementCategory.DELISTING;
    }
    if (lower.includes('perpetual swap') || lower.includes('futures')) {
      return ExchangeAnnouncementCategory.FUTURES_LAUNCH;
    }
    if (lower.includes('maintenance') || lower.includes('system upgrade')) {
      return ExchangeAnnouncementCategory.MAINTENANCE;
    }
    if (lower.includes('suspend') || lower.includes('halt')) {
      return ExchangeAnnouncementCategory.TRADING_SUSPENSION;
    }
    if (lower.includes('position limit') || lower.includes('margin') || lower.includes('leverage')) {
      return ExchangeAnnouncementCategory.MARGIN_RULES;
    }
    if (lower.includes('api')) {
      return ExchangeAnnouncementCategory.API_CHANGE;
    }
    if (lower.includes('security') || lower.includes('notice')) {
      return ExchangeAnnouncementCategory.SECURITY_NOTICE;
    }
    return ExchangeAnnouncementCategory.PROMOTION;
  }

  calculateImportance(category: ExchangeAnnouncementCategory): number {
    switch (category) {
      case ExchangeAnnouncementCategory.LISTING:
      case ExchangeAnnouncementCategory.DELISTING:
      case ExchangeAnnouncementCategory.FUTURES_LAUNCH:
      case ExchangeAnnouncementCategory.SECURITY_NOTICE:
        return 90;
      case ExchangeAnnouncementCategory.TRADING_SUSPENSION:
      case ExchangeAnnouncementCategory.MARGIN_RULES:
      case ExchangeAnnouncementCategory.MAINTENANCE:
        return 80;
      default:
        return 40;
    }
  }

  private extractSymbols(title: string): string[] {
    const symbols = new Set<string>();
    const matches = title.match(/\b([A-Z0-9]{2,10})[-_]?(USDT|USD|SWAP)?\b/g);
    if (matches) {
      matches.forEach((m) => {
        if (!['OKX', 'ANNOUNCEMENT', 'NOTICE', 'SUPPORT', 'FUTURES', 'UPDATE', 'USDT'].includes(m)) {
          symbols.add(m.includes('-') ? m : `${m.replace('USDT', '')}-USDT`);
        }
      });
    }
    return Array.from(symbols);
  }
}
