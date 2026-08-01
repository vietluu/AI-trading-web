-- CreateEnum
CREATE TYPE "NewsSourceType" AS ENUM ('RSS', 'ATOM', 'EXCHANGE_ANNOUNCEMENT', 'CRYPTO_NEWS_API', 'SECURITY_FEED', 'SENTIMENT_INDEX', 'REDDIT', 'MACRO_API', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "NewsArticleStatus" AS ENUM ('ACTIVE', 'DUPLICATE', 'RETRACTED', 'UNAVAILABLE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExchangeAnnouncementCategory" AS ENUM ('LISTING', 'DELISTING', 'FUTURES_LAUNCH', 'FUTURES_DELISTING', 'MAINTENANCE', 'TRADING_SUSPENSION', 'MARGIN_RULES', 'API_CHANGE', 'SECURITY_NOTICE', 'PROOF_OF_RESERVES', 'PROMOTION');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('ACTIVE', 'INVESTIGATING', 'RESOLVED', 'FALSE_ALARM');

-- CreateEnum
CREATE TYPE "SecurityIncidentType" AS ENUM ('EXPLOIT', 'HACK', 'BRIDGE_INCIDENT', 'PROTOCOL_VULNERABILITY', 'WALLET_COMPROMISE', 'EXCHANGE_OUTAGE', 'WITHDRAWAL_SUSPENSION', 'STABLECOIN_DEPEG', 'NETWORK_HALT', 'CHAIN_REORG', 'ORACLE_INCIDENT', 'GOVERNANCE_ATTACK', 'RUG_PULL', 'REGULATORY_ENFORCEMENT', 'PHISHING');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'SINGLE_SOURCE', 'MULTI_SOURCE', 'OFFICIAL_SOURCE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MarketSentimentIndexType" AS ENUM ('FEAR_AND_GREED', 'COMMUNITY_SENTIMENT', 'CUSTOM_INDEX');

-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('REDDIT', 'TWITTER', 'TELEGRAM', 'DISCORD');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('ACTIVE', 'REMOVED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "MacroEventCategory" AS ENUM ('CPI', 'PPI', 'GDP', 'UNEMPLOYMENT', 'NONFARM_PAYROLLS', 'INTEREST_RATE_DECISION', 'CENTRAL_BANK_SPEECH', 'FOMC', 'RETAIL_SALES', 'PMI', 'DOLLAR_INDEX', 'TREASURY_AUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "MacroImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MacroEventStatus" AS ENUM ('SCHEDULED', 'RELEASED', 'REVISED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExternalDataProvider" AS ENUM ('GENERIC_RSS', 'BINANCE_ANNOUNCEMENTS', 'OKX_ANNOUNCEMENTS', 'ALTERNATIVE_ME_FEAR_GREED', 'REDDIT', 'MANUAL_MACRO', 'X', 'TELEGRAM', 'DISCORD');

-- CreateEnum
CREATE TYPE "ExternalDataHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'STALE', 'RATE_LIMITED', 'AUTHENTICATION_FAILED', 'DISABLED', 'NOT_CONFIGURED', 'FAILED');

-- AlterEnum
ALTER TYPE "CredentialProvider" ADD VALUE 'REDDIT';

-- CreateTable
CREATE TABLE "external_data_sources" (
    "id" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" "ExternalDataProvider" NOT NULL DEFAULT 'GENERIC_RSS',
    "sourceType" "NewsSourceType" NOT NULL DEFAULT 'RSS',
    "baseDomain" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reliabilityScore" INTEGER NOT NULL DEFAULT 70,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_duplicate_groups" (
    "id" UUID NOT NULL,
    "primaryArticleId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_duplicate_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_articles" (
    "id" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceType" "NewsSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "summary" TEXT,
    "excerpt" TEXT,
    "canonicalUrl" TEXT NOT NULL,
    "originalUrl" TEXT,
    "author" TEXT,
    "language" TEXT DEFAULT 'en',
    "imageUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reliabilityScore" INTEGER NOT NULL,
    "importanceScore" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "duplicateGroupId" UUID,
    "status" "NewsArticleStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_source_references" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "canonicalUrl" TEXT NOT NULL,

    CONSTRAINT "news_source_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_symbols" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "article_symbols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_topics" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "article_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_entities" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "article_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_announcements" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "provider" "ExchangeProvider" NOT NULL,
    "category" "ExchangeAnnouncementCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "canonicalUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relatedSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importanceScore" INTEGER NOT NULL,
    "sourceReliabilityScore" INTEGER NOT NULL DEFAULT 100,
    "rawLanguage" TEXT,

    CONSTRAINT "exchange_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_incidents" (
    "id" UUID NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "incidentType" "SecurityIncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "verificationState" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "relatedSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedProtocols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstReportedAt" TIMESTAMP(3) NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "canonicalUrl" TEXT,
    "importanceScore" INTEGER NOT NULL DEFAULT 90,

    CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_source_references" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_source_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_sentiment_observations" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "indexType" "MarketSentimentIndexType" NOT NULL DEFAULT 'FEAR_AND_GREED',
    "value" INTEGER NOT NULL,
    "classification" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "market_sentiment_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "community" TEXT,
    "title" TEXT,
    "textExcerpt" TEXT,
    "authorHash" TEXT,
    "canonicalUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engagementScore" INTEGER,
    "commentsCount" INTEGER,
    "upvoteRatio" DOUBLE PRECISION,
    "relatedSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SocialPostStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macro_economic_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "currency" TEXT,
    "category" "MacroEventCategory" NOT NULL,
    "importance" "MacroImportance" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "actual" TEXT,
    "forecast" TEXT,
    "previous" TEXT,
    "unit" TEXT,
    "status" "MacroEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sourceUrl" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "macro_economic_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macro_import_runs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "acceptedRows" INTEGER NOT NULL,
    "rejectedRows" INTEGER NOT NULL,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "macro_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_data_ingestion_runs" (
    "id" UUID NOT NULL,
    "provider" "ExternalDataProvider" NOT NULL,
    "sourceId" TEXT,
    "itemsReceived" INTEGER NOT NULL DEFAULT 0,
    "itemsAccepted" INTEGER NOT NULL DEFAULT 0,
    "duplicatesDetected" INTEGER NOT NULL DEFAULT 0,
    "itemsRejected" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_data_ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_data_provider_health" (
    "id" UUID NOT NULL,
    "provider" "ExternalDataProvider" NOT NULL,
    "status" "ExternalDataHealthStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastItemAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "averageLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "rateLimitResetAt" TIMESTAMP(3),
    "itemsFetchedTotal" INTEGER NOT NULL DEFAULT 0,
    "itemsAcceptedTotal" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_data_provider_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_external_data_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "followedSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followedTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hiddenSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minImportanceScore" INTEGER NOT NULL DEFAULT 0,
    "highImportanceAlertThreshold" INTEGER NOT NULL DEFAULT 70,
    "macroCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minMacroImportance" "MacroImportance" NOT NULL DEFAULT 'LOW',
    "redditCommunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "realtimeNewsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoMarkRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_external_data_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_news_states" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isSaved" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_news_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_data_sources_sourceId_key" ON "external_data_sources"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "news_duplicate_groups_primaryArticleId_key" ON "news_duplicate_groups"("primaryArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "news_articles_canonicalUrl_key" ON "news_articles"("canonicalUrl");

-- CreateIndex
CREATE INDEX "news_articles_publishedAt_idx" ON "news_articles"("publishedAt");

-- CreateIndex
CREATE INDEX "news_articles_importanceScore_idx" ON "news_articles"("importanceScore");

-- CreateIndex
CREATE INDEX "news_articles_sourceId_idx" ON "news_articles"("sourceId");

-- CreateIndex
CREATE INDEX "news_articles_status_idx" ON "news_articles"("status");

-- CreateIndex
CREATE INDEX "news_articles_duplicateGroupId_idx" ON "news_articles"("duplicateGroupId");

-- CreateIndex
CREATE INDEX "news_source_references_articleId_idx" ON "news_source_references"("articleId");

-- CreateIndex
CREATE INDEX "news_source_references_sourceId_idx" ON "news_source_references"("sourceId");

-- CreateIndex
CREATE INDEX "article_symbols_symbol_idx" ON "article_symbols"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "article_symbols_articleId_symbol_key" ON "article_symbols"("articleId", "symbol");

-- CreateIndex
CREATE INDEX "article_topics_topic_idx" ON "article_topics"("topic");

-- CreateIndex
CREATE UNIQUE INDEX "article_topics_articleId_topic_key" ON "article_topics"("articleId", "topic");

-- CreateIndex
CREATE INDEX "article_entities_entity_idx" ON "article_entities"("entity");

-- CreateIndex
CREATE UNIQUE INDEX "article_entities_articleId_entity_key" ON "article_entities"("articleId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_announcements_canonicalUrl_key" ON "exchange_announcements"("canonicalUrl");

-- CreateIndex
CREATE INDEX "exchange_announcements_provider_publishedAt_idx" ON "exchange_announcements"("provider", "publishedAt");

-- CreateIndex
CREATE INDEX "exchange_announcements_category_idx" ON "exchange_announcements"("category");

-- CreateIndex
CREATE INDEX "exchange_announcements_importanceScore_idx" ON "exchange_announcements"("importanceScore");

-- CreateIndex
CREATE INDEX "security_incidents_severity_idx" ON "security_incidents"("severity");

-- CreateIndex
CREATE INDEX "security_incidents_status_idx" ON "security_incidents"("status");

-- CreateIndex
CREATE INDEX "security_incidents_firstReportedAt_idx" ON "security_incidents"("firstReportedAt");

-- CreateIndex
CREATE INDEX "incident_source_references_incidentId_idx" ON "incident_source_references"("incidentId");

-- CreateIndex
CREATE INDEX "market_sentiment_observations_provider_observedAt_idx" ON "market_sentiment_observations"("provider", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "market_sentiment_observations_provider_indexType_observedAt_key" ON "market_sentiment_observations"("provider", "indexType", "observedAt");

-- CreateIndex
CREATE INDEX "social_posts_provider_publishedAt_idx" ON "social_posts"("provider", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_provider_externalId_key" ON "social_posts"("provider", "externalId");

-- CreateIndex
CREATE INDEX "macro_economic_events_scheduledAt_idx" ON "macro_economic_events"("scheduledAt");

-- CreateIndex
CREATE INDEX "macro_economic_events_importance_idx" ON "macro_economic_events"("importance");

-- CreateIndex
CREATE INDEX "macro_economic_events_category_idx" ON "macro_economic_events"("category");

-- CreateIndex
CREATE UNIQUE INDEX "macro_economic_events_provider_name_scheduledAt_key" ON "macro_economic_events"("provider", "name", "scheduledAt");

-- CreateIndex
CREATE INDEX "macro_import_runs_userId_createdAt_idx" ON "macro_import_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "external_data_ingestion_runs_provider_startedAt_idx" ON "external_data_ingestion_runs"("provider", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_data_provider_health_provider_key" ON "external_data_provider_health"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_external_data_preferences_userId_key" ON "user_external_data_preferences"("userId");

-- CreateIndex
CREATE INDEX "user_news_states_userId_isSaved_idx" ON "user_news_states"("userId", "isSaved");

-- CreateIndex
CREATE INDEX "user_news_states_userId_isRead_idx" ON "user_news_states"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "user_news_states_userId_articleId_key" ON "user_news_states"("userId", "articleId");

-- AddForeignKey
ALTER TABLE "news_duplicate_groups" ADD CONSTRAINT "news_duplicate_groups_primaryArticleId_fkey" FOREIGN KEY ("primaryArticleId") REFERENCES "news_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_duplicateGroupId_fkey" FOREIGN KEY ("duplicateGroupId") REFERENCES "news_duplicate_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_source_references" ADD CONSTRAINT "news_source_references_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "external_data_sources"("sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_source_references" ADD CONSTRAINT "news_source_references_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_symbols" ADD CONSTRAINT "article_symbols_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_entities" ADD CONSTRAINT "article_entities_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_source_references" ADD CONSTRAINT "incident_source_references_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "security_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macro_import_runs" ADD CONSTRAINT "macro_import_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_external_data_preferences" ADD CONSTRAINT "user_external_data_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_news_states" ADD CONSTRAINT "user_news_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_news_states" ADD CONSTRAINT "user_news_states_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "indicator_snapshots_provider_symbol_interval_candleOpenTime_sta" RENAME TO "indicator_snapshots_provider_symbol_interval_candleOpenTime_key";
