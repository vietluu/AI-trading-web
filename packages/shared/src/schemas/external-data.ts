import { z } from "zod";

export const newsSourceTypeSchema = z.enum([
  "RSS",
  "ATOM",
  "EXCHANGE_ANNOUNCEMENT",
  "CRYPTO_NEWS_API",
  "SECURITY_FEED",
  "SENTIMENT_INDEX",
  "REDDIT",
  "MACRO_API",
  "MANUAL_IMPORT",
]);

export const newsArticleStatusSchema = z.enum([
  "ACTIVE",
  "DUPLICATE",
  "RETRACTED",
  "UNAVAILABLE",
  "ARCHIVED",
]);

export const exchangeAnnouncementCategorySchema = z.enum([
  "LISTING",
  "DELISTING",
  "FUTURES_LAUNCH",
  "FUTURES_DELISTING",
  "MAINTENANCE",
  "TRADING_SUSPENSION",
  "MARGIN_RULES",
  "API_CHANGE",
  "SECURITY_NOTICE",
  "PROOF_OF_RESERVES",
  "PROMOTION",
]);

export const incidentSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const incidentStatusSchema = z.enum([
  "ACTIVE",
  "INVESTIGATING",
  "RESOLVED",
  "FALSE_ALARM",
]);

export const securityIncidentTypeSchema = z.enum([
  "EXPLOIT",
  "HACK",
  "BRIDGE_INCIDENT",
  "PROTOCOL_VULNERABILITY",
  "WALLET_COMPROMISE",
  "EXCHANGE_OUTAGE",
  "WITHDRAWAL_SUSPENSION",
  "STABLECOIN_DEPEG",
  "NETWORK_HALT",
  "CHAIN_REORG",
  "ORACLE_INCIDENT",
  "GOVERNANCE_ATTACK",
  "RUG_PULL",
  "REGULATORY_ENFORCEMENT",
  "PHISHING",
]);

export const verificationStatusSchema = z.enum([
  "UNVERIFIED",
  "SINGLE_SOURCE",
  "MULTI_SOURCE",
  "OFFICIAL_SOURCE",
  "RESOLVED",
]);

export const marketSentimentIndexTypeSchema = z.enum([
  "FEAR_AND_GREED",
  "COMMUNITY_SENTIMENT",
  "CUSTOM_INDEX",
]);

export const socialProviderSchema = z.enum([
  "REDDIT",
  "TWITTER",
  "TELEGRAM",
  "DISCORD",
]);

export const socialPostStatusSchema = z.enum([
  "ACTIVE",
  "REMOVED",
  "FLAGGED",
]);

export const macroEventCategorySchema = z.enum([
  "CPI",
  "PPI",
  "GDP",
  "UNEMPLOYMENT",
  "NONFARM_PAYROLLS",
  "INTEREST_RATE_DECISION",
  "CENTRAL_BANK_SPEECH",
  "FOMC",
  "RETAIL_SALES",
  "PMI",
  "DOLLAR_INDEX",
  "TREASURY_AUCTION",
  "OTHER",
]);

export const macroImportanceSchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const macroEventStatusSchema = z.enum([
  "SCHEDULED",
  "RELEASED",
  "REVISED",
  "CANCELLED",
  "UNKNOWN",
]);

export const externalDataProviderSchema = z.enum([
  "GENERIC_RSS",
  "BINANCE_ANNOUNCEMENTS",
  "OKX_ANNOUNCEMENTS",
  "ALTERNATIVE_ME_FEAR_GREED",
  "REDDIT",
  "MANUAL_MACRO",
  "X",
  "TELEGRAM",
  "DISCORD",
]);

export const externalDataHealthStatusSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "STALE",
  "RATE_LIMITED",
  "AUTHENTICATION_FAILED",
  "DISABLED",
  "NOT_CONFIGURED",
  "FAILED",
]);

export const articleSymbolSchema = z.object({
  symbol: z.string(),
  confidence: z.number(),
});

export const articleTopicSchema = z.object({
  topic: z.string(),
  confidence: z.number(),
});

export const articleEntitySchema = z.object({
  entity: z.string(),
  entityType: z.string(),
  confidence: z.number(),
});

export const newsSourceReferenceSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string(),
  externalId: z.string().nullable().optional(),
  publishedAt: z.string(),
  canonicalUrl: z.string(),
});

export const userNewsStateSchema = z.object({
  articleId: z.string().uuid(),
  isRead: z.boolean(),
  isSaved: z.boolean(),
  isHidden: z.boolean(),
  readAt: z.string().nullable().optional(),
  savedAt: z.string().nullable().optional(),
});

export const newsArticleSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string(),
  externalId: z.string().nullable().optional(),
  sourceType: newsSourceTypeSchema,
  title: z.string(),
  normalizedTitle: z.string(),
  summary: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  canonicalUrl: z.string(),
  originalUrl: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  publishedAt: z.string(),
  receivedAt: z.string(),
  updatedAt: z.string(),
  reliabilityScore: z.number().int(),
  importanceScore: z.number().int(),
  duplicateGroupId: z.string().uuid().nullable().optional(),
  duplicateCount: z.number().int().default(1),
  status: newsArticleStatusSchema,
  symbols: z.array(z.string()),
  topics: z.array(z.string()),
  entities: z.array(z.string()),
  userState: userNewsStateSchema.optional(),
});

export const newsArticleDetailSchema = newsArticleSchema.extend({
  sourceReferences: z.array(newsSourceReferenceSchema),
  importanceReasons: z.array(z.string()),
});

export const exchangeAnnouncementSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().nullable().optional(),
  provider: z.enum(["BINANCE_FUTURES", "OKX_FUTURES"]),
  category: exchangeAnnouncementCategorySchema,
  title: z.string(),
  summary: z.string().nullable().optional(),
  canonicalUrl: z.string(),
  publishedAt: z.string(),
  receivedAt: z.string(),
  relatedSymbols: z.array(z.string()),
  importanceScore: z.number().int(),
  sourceReliabilityScore: z.number().int(),
  rawLanguage: z.string().nullable().optional(),
});

export const securityIncidentSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().nullable().optional(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  incidentType: securityIncidentTypeSchema,
  severity: incidentSeveritySchema,
  status: incidentStatusSchema,
  verificationState: verificationStatusSchema,
  relatedSymbols: z.array(z.string()),
  relatedProtocols: z.array(z.string()),
  firstReportedAt: z.string(),
  lastUpdatedAt: z.string(),
  canonicalUrl: z.string().nullable().optional(),
  importanceScore: z.number().int(),
  sourcesCount: z.number().int().default(1),
});

export const marketSentimentObservationSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  indexType: marketSentimentIndexTypeSchema,
  value: z.number().int(),
  classification: z.string(),
  observedAt: z.string(),
  receivedAt: z.string(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

export const socialPostSchema = z.object({
  id: z.string().uuid(),
  provider: socialProviderSchema,
  externalId: z.string(),
  community: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  textExcerpt: z.string().nullable().optional(),
  authorHash: z.string().nullable().optional(),
  canonicalUrl: z.string().nullable().optional(),
  publishedAt: z.string(),
  receivedAt: z.string(),
  engagementScore: z.number().int().nullable().optional(),
  commentsCount: z.number().int().nullable().optional(),
  upvoteRatio: z.number().nullable().optional(),
  relatedSymbols: z.array(z.string()),
  topics: z.array(z.string()),
  status: socialPostStatusSchema,
});

export const macroEconomicEventSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  externalId: z.string().nullable().optional(),
  name: z.string(),
  country: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  category: macroEventCategorySchema,
  importance: macroImportanceSchema,
  scheduledAt: z.string(),
  actual: z.string().nullable().optional(),
  forecast: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  status: macroEventStatusSchema,
  sourceUrl: z.string().nullable().optional(),
  receivedAt: z.string(),
  updatedAt: z.string(),
});

export const macroImportItemSchema = z.object({
  name: z.string().min(1),
  country: z.string().optional(),
  currency: z.string().optional(),
  category: macroEventCategorySchema.default("OTHER"),
  importance: macroImportanceSchema.default("MEDIUM"),
  scheduledAt: z.string(),
  actual: z.string().optional(),
  forecast: z.string().optional(),
  previous: z.string().optional(),
  unit: z.string().optional(),
  status: macroEventStatusSchema.default("SCHEDULED"),
  sourceUrl: z.string().url().optional(),
});

export const macroImportPreviewResponseSchema = z.object({
  totalRows: z.number().int(),
  validRows: z.number().int(),
  invalidRows: z.number().int(),
  previewItems: z.array(macroImportItemSchema),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
});

export const macroImportConfirmRequestSchema = z.object({
  fileName: z.string(),
  fileFormat: z.enum(["csv", "json"]),
  items: z.array(macroImportItemSchema),
});

export const macroImportResultSchema = z.object({
  importRunId: z.string().uuid(),
  totalRows: z.number().int(),
  acceptedRows: z.number().int(),
  rejectedRows: z.number().int(),
  createdAt: z.string(),
});

export const externalDataProviderHealthSchema = z.object({
  id: z.string().uuid(),
  provider: externalDataProviderSchema,
  status: externalDataHealthStatusSchema,
  lastAttemptAt: z.string().nullable().optional(),
  lastSuccessAt: z.string().nullable().optional(),
  lastItemAt: z.string().nullable().optional(),
  consecutiveFailures: z.number().int(),
  averageLatencyMs: z.number().int(),
  lastErrorCode: z.string().nullable().optional(),
  rateLimitResetAt: z.string().nullable().optional(),
  itemsFetchedTotal: z.number().int(),
  itemsAcceptedTotal: z.number().int(),
  updatedAt: z.string(),
});

export const externalDataSourceSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string(),
  displayName: z.string(),
  provider: externalDataProviderSchema,
  sourceType: newsSourceTypeSchema,
  baseDomain: z.string(),
  feedUrl: z.string().url(),
  language: z.string(),
  categories: z.array(z.string()),
  reliabilityScore: z.number().int(),
  isEnabled: z.boolean(),
  isCustom: z.boolean(),
  pollIntervalSeconds: z.number().int(),
  lastFetchedAt: z.string().nullable().optional(),
  lastSuccessAt: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createExternalDataSourceSchema = z.object({
  sourceId: z.string().min(3).max(64).regex(/^[a-z0-9_-]+$/i),
  displayName: z.string().min(2).max(100),
  feedUrl: z.string().url(),
  language: z.string().default("en"),
  categories: z.array(z.string()).default([]),
  reliabilityScore: z.number().int().min(0).max(100).default(70),
  pollIntervalSeconds: z.number().int().min(60).max(86400).default(300),
});

export const updateExternalDataSourceSchema = createExternalDataSourceSchema.partial().extend({
  isEnabled: z.boolean().optional(),
});

export const userExternalDataPreferenceSchema = z.object({
  preferredLanguage: z.string(),
  followedSymbols: z.array(z.string()),
  followedTopics: z.array(z.string()),
  hiddenSourceIds: z.array(z.string()),
  minImportanceScore: z.number().int(),
  highImportanceAlertThreshold: z.number().int(),
  macroCountries: z.array(z.string()),
  minMacroImportance: macroImportanceSchema,
  redditCommunities: z.array(z.string()),
  realtimeNewsEnabled: z.boolean(),
  autoMarkRead: z.boolean(),
  updatedAt: z.string(),
});

export const updateUserExternalDataPreferenceSchema = userExternalDataPreferenceSchema.partial();

export const queryNewsFilterSchema = z.object({
  sourceId: z.string().optional(),
  symbol: z.string().optional(),
  topic: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  minImportance: z.coerce.number().int().min(0).max(100).optional(),
  minReliability: z.coerce.number().int().min(0).max(100).optional(),
  publishedFrom: z.string().optional(),
  publishedTo: z.string().optional(),
  status: newsArticleStatusSchema.optional(),
  saved: z.coerce.boolean().optional(),
  unread: z.coerce.boolean().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["importance_desc", "published_desc", "published_asc"]).default("published_desc"),
});

export const queryMacroFilterSchema = z.object({
  country: z.string().optional(),
  category: macroEventCategorySchema.optional(),
  importance: macroImportanceSchema.optional(),
  status: macroEventStatusSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const externalDataWebSocketMessageSchema = z.object({
  channel: z.enum([
    "news",
    "high-importance-news",
    "announcements",
    "security-incidents",
    "sentiment",
    "social",
    "macro",
    "provider-health",
  ]),
  event: z.string(),
  timestamp: z.string(),
  data: z.record(z.string(), z.any()),
});

export type NewsSourceType = z.infer<typeof newsSourceTypeSchema>;
export type NewsArticleStatus = z.infer<typeof newsArticleStatusSchema>;
export type ExchangeAnnouncementCategory = z.infer<typeof exchangeAnnouncementCategorySchema>;
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export type SecurityIncidentType = z.infer<typeof securityIncidentTypeSchema>;
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type MarketSentimentIndexType = z.infer<typeof marketSentimentIndexTypeSchema>;
export type SocialProvider = z.infer<typeof socialProviderSchema>;
export type SocialPostStatus = z.infer<typeof socialPostStatusSchema>;
export type MacroEventCategory = z.infer<typeof macroEventCategorySchema>;
export type MacroImportance = z.infer<typeof macroImportanceSchema>;
export type MacroEventStatus = z.infer<typeof macroEventStatusSchema>;
export type ExternalDataProvider = z.infer<typeof externalDataProviderSchema>;
export type ExternalDataHealthStatus = z.infer<typeof externalDataHealthStatusSchema>;

export type NewsArticle = z.infer<typeof newsArticleSchema>;
export type NewsArticleDetail = z.infer<typeof newsArticleDetailSchema>;
export type UserNewsState = z.infer<typeof userNewsStateSchema>;
export type ExchangeAnnouncement = z.infer<typeof exchangeAnnouncementSchema>;
export type SecurityIncident = z.infer<typeof securityIncidentSchema>;
export type MarketSentimentObservation = z.infer<typeof marketSentimentObservationSchema>;
export type SocialPost = z.infer<typeof socialPostSchema>;
export type MacroEconomicEvent = z.infer<typeof macroEconomicEventSchema>;
export type MacroImportItem = z.infer<typeof macroImportItemSchema>;
export type MacroImportPreviewResponse = z.infer<typeof macroImportPreviewResponseSchema>;
export type MacroImportConfirmRequest = z.infer<typeof macroImportConfirmRequestSchema>;
export type MacroImportResult = z.infer<typeof macroImportResultSchema>;
export type ExternalDataProviderHealth = z.infer<typeof externalDataProviderHealthSchema>;
export type ExternalDataSource = z.infer<typeof externalDataSourceSchema>;
export type CreateExternalDataSource = z.infer<typeof createExternalDataSourceSchema>;
export type UpdateExternalDataSource = z.infer<typeof updateExternalDataSourceSchema>;
export type UserExternalDataPreference = z.infer<typeof userExternalDataPreferenceSchema>;
export type UpdateUserExternalDataPreference = z.infer<typeof updateUserExternalDataPreferenceSchema>;
export type QueryNewsFilter = z.infer<typeof queryNewsFilterSchema>;
export type QueryMacroFilter = z.infer<typeof queryMacroFilterSchema>;
export type ExternalDataWebSocketMessage = z.infer<typeof externalDataWebSocketMessageSchema>;
