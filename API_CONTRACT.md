# API contract

All REST routes use the `/api` prefix. Swagger is available at `/docs` and its
OpenAPI JSON document at `/docs/json`. Request DTOs are validated globally;
unknown properties are rejected.

Authenticated routes use the opaque `sid` HttpOnly cookie. The cookie is
SameSite=Lax, secure in production, and never read by frontend code.
Unsafe authenticated requests also require the non-HttpOnly `csrf_token`
cookie value in the `X-CSRF-Token` header. Credential mutations require
`X-TOTP-Code` when 2FA is enabled (or globally required).

## Health

- `GET /api/health` checks PostgreSQL and Redis.

## Authentication

- `POST /api/auth/register` creates a user and, when verification is disabled, a session.
- `POST /api/auth/login` creates a normal or Remember Me session after credential and lock checks.
- `POST /api/auth/reauthenticate` records a session-scoped recent-password proof for sensitive exchange changes.
- `POST /api/auth/logout` destroys the current session.
- `POST /api/auth/refresh` rotates the current session.
- `POST /api/auth/verify-email` consumes a single-use verification token.
- `POST /api/auth/resend-verification` requests another verification email.
- `POST /api/auth/forgot-password` issues a generic accepted response.
- `POST /api/auth/reset-password` consumes a short-lived, single-use token.
- `POST /api/auth/change-password` changes the password, revokes all sessions,
  and creates a replacement session for the current device.
- `GET /api/auth/me` returns only public user fields.
- `GET /api/auth/session` returns the current session expiry and persistence mode.
- `GET /api/auth/sessions` lists active device sessions.
- `POST /api/auth/totp/setup` begins authenticator enrollment.
- `POST /api/auth/totp/confirm` confirms enrollment with a six-digit code.
- `POST /api/auth/totp/disable` disables 2FA after password and code verification.
- `DELETE /api/auth/sessions/:id` revokes one user-owned session.
- `DELETE /api/auth/sessions` logs out all devices.

## Credentials

- `GET /api/credentials` returns user-owned provider metadata.
- `POST /api/credentials` encrypts and stores credential material.
- `PUT /api/credentials/:id` updates a user-owned credential.
- `DELETE /api/credentials/:id` removes a user-owned credential.
- `POST /api/credentials/:id/test` verifies stored ciphertext integrity.

Credential responses contain `provider`, `status`, `maskedKey`, and
`lastVerified` metadata; they never contain plaintext keys, secrets,
passphrases, or ciphertext.

## Settings

- `GET /api/settings` returns settings owned by the current user.
- `PUT /api/settings` validates and updates those settings.

## Exchange providers and public data

- `GET /api/exchanges/providers`
- `GET /api/exchanges/:provider/time`
- `GET /api/exchanges/:provider/instruments`
- `GET /api/exchanges/:provider/instruments/:symbol`
- `GET /api/exchanges/:provider/ticker/:symbol`
- `GET /api/exchanges/:provider/order-book/:symbol?depth=`
- `GET /api/exchanges/:provider/trades/:symbol?limit=`
- `GET /api/exchanges/:provider/klines/:symbol?interval=&limit=&startTime=&endTime=`
- `GET /api/exchanges/:provider/funding-rate/:symbol`
- `GET /api/exchanges/:provider/open-interest/:symbol`

Providers are `BINANCE_FUTURES` and `OKX_FUTURES`. Symbols use normalized
uppercase `BASE-QUOTE` form such as `BTC-USDT`. Decimal prices, quantities,
balances, PnL, rates, margin, and leverage are strings. Public instrument data
is cached globally for the configured TTL; ticker, funding, and open-interest
snapshots use the short ticker TTL. Local throttling returns HTTP 429.

Intervals are `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`,
`12h`, `1d`, `1w`, and `1M`; OKX rejects `8h`, which its mapping does not
support. Date query values use ISO 8601.

## User exchange connections

All routes below require the session cookie; unsafe requests also require CSRF
and pass the sensitive-action TOTP guard. The ID is always combined with the
session user ID, and a foreign ID returns 404.

- `GET /api/exchange-connections`
- `POST /api/exchange-connections`
- `GET /api/exchange-connections/:id`
- `PATCH /api/exchange-connections/:id`
- `DELETE /api/exchange-connections/:id`
- `POST /api/exchange-connections/:id/test`
- `POST /api/exchange-connections/:id/enable`
- `POST /api/exchange-connections/:id/disable`
- `GET /api/exchange-connections/:id/account`
- `GET /api/exchange-connections/:id/balances`
- `GET /api/exchange-connections/:id/positions`
- `GET /api/exchange-connections/:id/orders/open?symbol=`
- `GET /api/exchange-connections/:id/orders/:orderId?symbol=`
- `GET /api/exchange-connections/:id/configuration`

Binance accepts `TESTNET` or `PRODUCTION` and requires `apiKey`/`apiSecret`.
OKX accepts `DEMO` or `PRODUCTION` and additionally requires `passphrase`.
Responses expose only `maskedApiKey` and safe metadata. Production creation,
switching, and enabling require both the production feature flag and a recent
password proof. Credential replacement and deletion require a recent proof in
all environments. Private account reads require an enabled, verified
connection and are never placed in the global cache.

The connection test performs read-only account, balance, position, open-order,
and server-time calls. No endpoint places/cancels orders, changes leverage or
margin mode, transfers funds, or closes positions. GET semantics plus provider
timestamps/`recvWindow` provide the Phase 3 replay/idempotency boundary; no
idempotency key is invented because there are no provider mutations.

## External Data Ingestion & Feeds (Phase 5)

### News & Market Events
- `GET /api/external-data/news`: Search and filter normalized news articles (`symbol`, `topic`, `minImportance`, `saved`, `unread`, `limit`, `cursor`).
- `GET /api/external-data/news/:id`: Retrieve detailed news article with excerpt, source references, and deterministic importance scoring factors.
- `PATCH /api/external-data/news/:id/read`: Toggle or set per-user read state (`isRead`).
- `PATCH /api/external-data/news/:id/save`: Toggle or set per-user bookmark state (`isSaved`).

### Exchange Announcements & Incidents
- `GET /api/external-data/announcements`: List normalized Binance/OKX exchange announcements (`exchange`, `category`, `limit`).
- `GET /api/external-data/announcements/:id`: Announcement detail view.
- `GET /api/external-data/incidents`: List security incidents and hacks (`severity`, `status`, `limit`).

### Market Sentiment & Social
- `GET /api/external-data/sentiment`: Fetch current Fear & Greed index observation.
- `GET /api/external-data/sentiment/history`: Fetch historical sentiment observations (`limit`).
- `GET /api/external-data/social/providers`: List community providers and user credential statuses.

### Macroeconomic Calendar
- `GET /api/external-data/macro/events`: List economic events (`importance`, `category`, `startDate`, `endDate`).
- `POST /api/external-data/macro/import/preview`: Dry-run validation of manual CSV/JSON macro import content.
- `POST /api/external-data/macro/import`: Confirm and insert validated macroeconomic events.

### Data Sources & Provider Telemetry
- `GET /api/external-data/sources`: List configured external RSS feeds and providers.
- `POST /api/external-data/sources`: Create or add custom RSS/Atom feed source.
- `PATCH /api/external-data/sources/:id`: Toggle source enablement or edit settings.
- `POST /api/external-data/sources/:id/test`: Test feed URL fetching and parsing.
- `GET /api/external-data/providers/health`: List health status, latency, error rates, and failure tracking.
- `POST /api/external-data/providers/:provider/run`: Trigger manual ingestion job.

### WebSocket Realtime Stream
- **Namespace:** `/external-data`
- **Client Subscription:** `socket.emit("subscribe", { channels: [{ type: "high-importance-news", minimumImportance: 70 }, { type: "news" }] })`
- **Events Emitted:**
  - `NEWS_ARTICLE_CREATED`
  - `HIGH_IMPORTANCE_NEWS_DETECTED`
  - `EXCHANGE_ANNOUNCEMENT_CREATED`
  - `SECURITY_INCIDENT_CREATED`
  - `SENTIMENT_INDEX_UPDATED`
  - `MACRO_EVENT_CREATED`

## Error response

HTTP failures use the global shape below. Unexpected server exceptions return
a generic message and error name; detailed exceptions remain only in server
logs.

```json
{
  "statusCode": 401,
  "timestamp": "2026-07-31T09:10:00.000Z",
  "path": "/api/auth/me",
  "message": "Authentication required",
  "error": "UnauthorizedException"
}
```

Exchange failures may add `code`, `provider`, `retryable`, and `correlationId`.
Normalized codes distinguish timeout, unavailable, throttled, credentials,
signature, timestamp, permission, symbol, request, and resource failures.

## Reserved for later roadmap phases

Realtime collection/WebSockets, news, signal, analysis, paper trading, live
trading, and performance routes are not implemented in Phase 3.
