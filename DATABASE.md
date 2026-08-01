# Database

PostgreSQL is managed through Prisma. The `foundation` migration establishes
the migration history, and `authentication` adds the Phase 2 identity domain.
Redis stores active sessions, login throttles, and short-lived password-reset
tokens; it is not a source of long-term user data.

## Current tables

- `users`: normalized email, unique username, Argon2id password hash, and
  temporary login-lock state.
- `sessions`: user-owned session metadata, an HMAC-derived identifier, device
  information, expiration, and last activity. Raw tokens are never stored.
- `encrypted_credentials`: user-owned provider metadata and AES-256-GCM
  ciphertext. Decrypted secrets are never returned.
- `user_settings`: one settings record per user for display, market, AI-budget,
  paper-balance, leverage, and risk preferences.
- `audit_logs`: security-relevant actions and sanitized request metadata.
- `exchange_connections`: one user-owned provider/environment connection linked
  one-to-one to an existing encrypted credential. It stores safe enablement,
  verification, permission, and last normalized error metadata only.

## Phase 5 external data tables

- `external_data_sources`: Configured external RSS feeds, exchange announcement endpoints, and API providers with reliability score and poll interval settings.
- `news_duplicate_groups`: Clusters of near-duplicate news articles identified by title and content hash similarity.
- `news_articles`: Shared normalized cryptocurrency news articles with deterministic importance scores, title hashes, canonical URLs, and duplicate counts.
- `news_source_references`: Secondary source attributions associated with duplicate news groups.
- `article_symbols`: Explicit symbol tags linked to news articles (e.g. `BTC-USDT`) with extraction confidence scores.
- `article_topics`: Topic classifications linked to news articles (e.g. `regulation`, `layer_1`, `oracle`).
- `article_entities`: Named entity extractions (e.g. `SEC`, `Binance`, `Fed`) linked to news articles.
- `exchange_announcements`: Normalized exchange announcements (delisting, listing, maintenance, leverage change) for Binance and OKX.
- `security_incidents`: Security incident, exploit, and hack tracking with verification status and severity levels.
- `incident_source_references`: Source citations for security incidents.
- `market_sentiment_observations`: Crypto Fear & Greed index history and observations.
- `social_posts`: Normalized social media community posts (e.g. Reddit) with SHA256 author privacy hashing.
- `macro_economic_events`: Scheduled macroeconomic calendar events (CPI, FOMC, GDP, Interest Rates) with actual/forecast/previous metrics.
- `macro_import_runs`: Audit trail for dry-run preview and confirmed manual CSV/JSON macro imports.
- `external_data_ingestion_runs`: Execution logs for BullMQ scheduled ingestion workers.
- `external_data_provider_health`: Provider telemetry tracking average latency, rate limit usage, error codes, and health statuses.
- `user_external_data_preferences`: Per-user source preferences, minimum importance filters, and notification settings.
- `user_news_states`: Per-user article state tracking (`isRead`, `isSaved`, `isHidden`, `notes`) with strict cross-user isolation.

`ExchangeProvider` contains explicit `BINANCE_FUTURES` and `OKX_FUTURES`
values. `ExchangeEnvironment` contains `TESTNET`, `DEMO`, and `PRODUCTION`.

Migration `20260801051515_external_data_ingestion` creates the Phase 5 schema, unique indexes, and FK cascades. Companion `rollback.sql` safely drops Phase 5 tables, indexes, and enums.

## Reserved domain tables

The following tables remain reserved for the roadmap phase that owns them:

- market_symbols
- candles
- funding_rates
- order_books
- liquidations
- open_interest
- fear_greed
- news
- social_posts
- onchain_events
- agent_results
- signals
- paper_trades
- live_trades
- trade_logs
- positions
- portfolios
- performance_reports
- ai_requests
- ai_responses
