# Database

PostgreSQL is managed through Prisma. The `foundation` migration establishes
the migration history, and `authentication` adds the Phase 2 identity domain.
Redis stores active sessions, login throttles, and short-lived password-reset
tokens; it is not a source of long-term user data.

## Phase 2 tables

- `users`: normalized email, unique username, Argon2id password hash, and
  temporary login-lock state.
- `sessions`: user-owned session metadata, an HMAC-derived identifier, device
  information, expiration, and last activity. Raw tokens are never stored.
- `encrypted_credentials`: user-owned provider metadata and AES-256-GCM
  ciphertext. Decrypted secrets are never returned.
- `user_settings`: one settings record per user for display, market, AI-budget,
  paper-balance, leverage, and risk preferences.
- `audit_logs`: security-relevant actions and sanitized request metadata.

Foreign keys cascade user-owned sessions, credentials, and settings when a
user is removed. Audit records retain the action and set `userId` to null.
The authentication migration includes a reviewed `rollback.sql` companion.

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
