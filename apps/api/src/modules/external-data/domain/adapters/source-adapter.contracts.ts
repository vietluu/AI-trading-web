import {
  type ExternalDataHealthStatus,
  type ExternalDataProvider,
  type NewsSourceType,
  SocialProvider,
} from '@prisma/client';

export interface ProviderHealth {
  provider: ExternalDataProvider;
  status: ExternalDataHealthStatus;
  latencyMs: number;
  lastAttemptAt: Date;
  lastSuccessAt?: Date;
  lastItemAt?: Date;
  consecutiveFailures: number;
  lastErrorCode?: string;
  rateLimitResetAt?: Date;
}

export interface NewsFetchContext {
  sourceId: string;
  feedUrl: string;
  etag?: string;
  lastModified?: string;
  since?: Date;
  limit?: number;
}

export interface RawNewsItem {
  externalId?: string;
  title: string;
  summary?: string;
  excerpt?: string;
  url: string;
  author?: string;
  language?: string;
  imageUrl?: string;
  publishedAt: Date;
  categories?: string[];
  rawLanguage?: string;
}

export interface NewsSourceAdapter {
  readonly sourceId: string;
  readonly sourceType: NewsSourceType;
  readonly provider: ExternalDataProvider;

  fetchLatest(context: NewsFetchContext): Promise<{
    items: RawNewsItem[];
    etag?: string;
    lastModified?: string;
  }>;

  getHealth(): Promise<ProviderHealth>;
  supportsPagination(): boolean;
  supportsSinceFiltering(): boolean;
}

export interface SentimentFetchContext {
  limit?: number;
}

export interface SentimentObservation {
  provider: string;
  indexType: 'FEAR_AND_GREED' | 'COMMUNITY_SENTIMENT' | 'CUSTOM_INDEX';
  value: number;
  classification: string;
  observedAt: Date;
  metadata?: Record<string, any>;
}

export interface SentimentSourceAdapter {
  readonly sourceId: string;
  readonly provider: ExternalDataProvider;

  fetchLatest(context: SentimentFetchContext): Promise<SentimentObservation[]>;
  getHealth(): Promise<ProviderHealth>;
}

export interface MacroFetchContext {
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}

export interface RawMacroEvent {
  externalId?: string;
  name: string;
  country?: string;
  currency?: string;
  category: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  scheduledAt: Date;
  actual?: string;
  forecast?: string;
  previous?: string;
  unit?: string;
  status?: string;
  sourceUrl?: string;
}

export interface MacroEventSourceAdapter {
  readonly sourceId: string;
  readonly provider: ExternalDataProvider;

  fetchEvents(context: MacroFetchContext): Promise<RawMacroEvent[]>;
  getHealth(): Promise<ProviderHealth>;
}

export interface SocialFetchContext {
  userId?: string;
  community?: string;
  limit?: number;
}

export interface RawSocialPost {
  externalId: string;
  community?: string;
  title?: string;
  textExcerpt?: string;
  authorHash?: string;
  canonicalUrl?: string;
  publishedAt: Date;
  engagement: {
    score?: number;
    comments?: number;
    upvoteRatio?: number;
  };
  relatedSymbols?: string[];
  topics?: string[];
}

export interface SocialSourceAdapter {
  readonly sourceId: string;
  readonly sourceType: NewsSourceType;
  readonly provider: ExternalDataProvider;

  fetchPosts(context: SocialFetchContext): Promise<RawSocialPost[]>;
  getHealth(): Promise<ProviderHealth>;
}
