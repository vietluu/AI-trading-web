-- Rollback Migration for 20260801051515_external_data_ingestion

DROP TABLE IF EXISTS "user_news_states" CASCADE;
DROP TABLE IF EXISTS "user_external_data_preferences" CASCADE;
DROP TABLE IF EXISTS "external_data_provider_health" CASCADE;
DROP TABLE IF EXISTS "external_data_ingestion_runs" CASCADE;
DROP TABLE IF EXISTS "macro_import_runs" CASCADE;
DROP TABLE IF EXISTS "macro_economic_events" CASCADE;
DROP TABLE IF EXISTS "social_posts" CASCADE;
DROP TABLE IF EXISTS "market_sentiment_observations" CASCADE;
DROP TABLE IF EXISTS "incident_source_references" CASCADE;
DROP TABLE IF EXISTS "security_incidents" CASCADE;
DROP TABLE IF EXISTS "exchange_announcements" CASCADE;
DROP TABLE IF EXISTS "article_entities" CASCADE;
DROP TABLE IF EXISTS "article_topics" CASCADE;
DROP TABLE IF EXISTS "article_symbols" CASCADE;
DROP TABLE IF EXISTS "news_source_references" CASCADE;
DROP TABLE IF EXISTS "news_articles" CASCADE;
DROP TABLE IF EXISTS "news_duplicate_groups" CASCADE;
DROP TABLE IF EXISTS "external_data_sources" CASCADE;

DROP TYPE IF EXISTS "ExternalDataHealthStatus";
DROP TYPE IF EXISTS "ExternalDataProvider";
DROP TYPE IF EXISTS "MacroEventStatus";
DROP TYPE IF EXISTS "MacroImportance";
DROP TYPE IF EXISTS "MacroEventCategory";
DROP TYPE IF EXISTS "SocialPostStatus";
DROP TYPE IF EXISTS "SocialProvider";
DROP TYPE IF EXISTS "MarketSentimentIndexType";
DROP TYPE IF EXISTS "VerificationStatus";
DROP TYPE IF EXISTS "SecurityIncidentType";
DROP TYPE IF EXISTS "IncidentStatus";
DROP TYPE IF EXISTS "IncidentSeverity";
DROP TYPE IF EXISTS "ExchangeAnnouncementCategory";
DROP TYPE IF EXISTS "NewsArticleStatus";
DROP TYPE IF EXISTS "NewsSourceType";
