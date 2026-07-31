# Database

## Phase 1 state

PostgreSQL is managed through Prisma. The initial `foundation` migration
establishes migration history without creating domain tables. This keeps Phase
1 limited to infrastructure and prevents later domains from inheriting
premature schemas.

The API health check uses Prisma to execute a read-only connectivity probe.
Adminer is available locally for database inspection.

## Planned domain tables

Each table below is reserved for the roadmap phase that owns its domain:

- users
- settings
- api_keys
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
- audit_logs
