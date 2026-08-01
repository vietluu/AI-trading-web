import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { ExternalDataProvider, NewsSourceType } from '@prisma/client';
import {
  NewsFetchContext,
  NewsSourceAdapter,
  ProviderHealth,
  RawNewsItem,
} from '../../../domain/adapters/source-adapter.contracts';
import { ExternalDataError, ExternalDataErrorCode } from '../../../domain/errors/external-data.error';
import { ExternalHttpClient } from '../../http/external-http-client';

@Injectable()
export class GenericRssAdapter implements NewsSourceAdapter {
  readonly sourceId: string = 'generic-rss-adapter';
  readonly sourceType: NewsSourceType = NewsSourceType.RSS;
  readonly provider: ExternalDataProvider = ExternalDataProvider.GENERIC_RSS;

  private readonly logger = new Logger(GenericRssAdapter.name);
  private readonly xmlParser: XMLParser;

  constructor(private readonly httpClient: ExternalHttpClient) {
    // XXE Safety: processEntities: false, allowBooleanAttributes: true, no DTD resolution
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      processEntities: false,
      allowBooleanAttributes: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    });
  }

  async fetchLatest(context: NewsFetchContext): Promise<{
    items: RawNewsItem[];
    etag?: string;
    lastModified?: string;
  }> {
    const response = await this.httpClient.fetch({
      url: context.feedUrl,
      etag: context.etag,
      lastModified: context.lastModified,
    });

    if (response.notModified) {
      return { items: [], etag: response.etag, lastModified: response.lastModified };
    }

    const items = this.parseFeedXml(response.body);
    return {
      items,
      etag: response.etag,
      lastModified: response.lastModified,
    };
  }

  parseFeedXml(xmlContent: string): RawNewsItem[] {
    let parsed: Record<string, unknown>;
    try {
      parsed = this.xmlParser.parse(xmlContent) as Record<string, unknown>;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new ExternalDataError({
        message: `Failed to parse RSS/Atom XML feed: ${errorMsg}`,
        code: ExternalDataErrorCode.SOURCE_PARSE_FAILED,
        provider: this.provider,
        retryable: false,
        statusCode: 422,
      });
    }

    if (!parsed) return [];

    const rss = parsed.rss as Record<string, unknown> | undefined;
    const feed = parsed.feed as Record<string, unknown> | undefined;
    const rdf = parsed['rdf:RDF'] as Record<string, unknown> | undefined;

    // Check RSS 2.0
    if (rss?.channel) {
      const channel = rss.channel as Record<string, unknown>;
      return this.parseRssItems(channel.item);
    }

    // Check Atom
    if (feed) {
      return this.parseAtomEntries(feed.entry);
    }

    // Check RDF/RSS 1.0
    if (rdf?.item) {
      return this.parseRssItems(rdf.item);
    }

    return [];
  }

  private parseRssItems(itemsRaw: unknown): RawNewsItem[] {
    if (!itemsRaw) return [];
    const itemsArray = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

    const results: RawNewsItem[] = [];
    for (const itemRaw of itemsArray) {
      if (!itemRaw || typeof itemRaw !== 'object') continue;
      const item = itemRaw as Record<string, unknown>;

      const title = this.extractString(item.title);
      const url = this.extractString(item.link) || this.extractString(item.guid);
      if (!title || !url) continue;

      const pubDateStr = this.extractString(item.pubDate) || this.extractString(item['dc:date']);
      const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date();

      const description =
        this.extractString(item['content:encoded']) ||
        this.extractString(item.description) ||
        '';

      const excerpt = this.sanitizeText(description).slice(0, 500);
      const author = this.extractString(item.author) || this.extractString(item['dc:creator']);
      const externalId = this.extractString(item.guid) || url;

      const categories: string[] = [];
      if (item.category) {
        if (Array.isArray(item.category)) {
          item.category.forEach((c: unknown) => {
            const val = this.extractString(c);
            if (val) categories.push(val);
          });
        } else {
          const val = this.extractString(item.category);
          if (val) categories.push(val);
        }
      }

      results.push({
        externalId,
        title: this.sanitizeText(title),
        summary: excerpt,
        excerpt,
        url,
        author: author ? this.sanitizeText(author) : undefined,
        publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
        categories,
      });
    }

    return results;
  }

  private parseAtomEntries(entriesRaw: unknown): RawNewsItem[] {
    if (!entriesRaw) return [];
    const entriesArray = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw];

    const results: RawNewsItem[] = [];
    for (const entryRaw of entriesArray) {
      if (!entryRaw || typeof entryRaw !== 'object') continue;
      const entry = entryRaw as Record<string, unknown>;

      const title = this.extractString(entry.title);
      let url = '';
      if (typeof entry.link === 'string') {
        url = entry.link;
      } else if (Array.isArray(entry.link)) {
        const links = entry.link as Record<string, unknown>[];
        const altLink = links.find((l) => l['@_rel'] === 'alternate') || links[0];
        url = typeof altLink?.['@_href'] === 'string' ? altLink['@_href'] : '';
      } else if (typeof entry.link === 'object' && entry.link !== null) {
        const linkObj = entry.link as Record<string, unknown>;
        url = typeof linkObj['@_href'] === 'string' ? linkObj['@_href'] : '';
      }

      if (!title || !url) continue;

      const pubDateStr =
        this.extractString(entry.published) ||
        this.extractString(entry.updated);
      const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date();

      const content =
        this.extractString(entry.content) ||
        this.extractString(entry.summary) ||
        '';
      const excerpt = this.sanitizeText(content).slice(0, 500);

      const authorObj = entry.author as Record<string, unknown> | undefined;
      const author = this.extractString(authorObj?.name) || this.extractString(entry.author);
      const externalId = this.extractString(entry.id) || url;

      results.push({
        externalId,
        title: this.sanitizeText(title),
        summary: excerpt,
        excerpt,
        url,
        author: author ? this.sanitizeText(author) : undefined,
        publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
      });
    }

    return results;
  }

  private extractString(val: unknown): string {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      const textValue = obj['#text'];
      if (typeof textValue === 'string' || typeof textValue === 'number') {
        return String(textValue);
      }
    }
    return '';
  }

  private sanitizeText(rawHtml: string): string {
    if (!rawHtml) return '';
    // Strip HTML tags and normalize whitespace
    return rawHtml
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  async getHealth(): Promise<ProviderHealth> {
    return Promise.resolve({
      provider: this.provider,
      status: 'HEALTHY',
      latencyMs: 0,
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
    });
  }

  supportsPagination(): boolean {
    return false;
  }

  supportsSinceFiltering(): boolean {
    return true;
  }
}
