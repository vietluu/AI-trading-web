# AI Multi-Agent Cryptocurrency Futures Platform

A production-oriented research and trading platform that combines real-time
market data, specialized AI agents, deterministic risk controls, paper trading,
and optional live execution. AI remains advisory: it never sends exchange
orders, and every future order must pass the deterministic Risk Engine.

## Phase 3 scope

The current foundation includes:

- a pnpm monorepo with strict TypeScript;
- a Next.js App Router dashboard shell in `apps/web`;
- a NestJS REST API in `apps/api`;
- shared Zod contracts in `packages/shared`;
- Prisma with an initial migration history;
- PostgreSQL, Redis, and Adminer through Docker Compose;
- BullMQ-safe Redis configuration using the `noeviction` policy;
- validated frontend and backend environment configuration;
- structured JSON logs, global request validation, and exception handling;
- Swagger documentation and a dependency-aware health endpoint;
- unit and component tests plus GitHub Actions CI.
- multi-user registration, login, logout, session refresh, password recovery,
  and password changes using Argon2id;
- server-side sessions backed by Redis and an opaque HttpOnly cookie, with
  active-session management and logout-all-devices support;
- per-user AES-256-GCM encrypted provider credentials, settings, and audit
  history;
- account, security, settings, and API-key management pages.
- a normalized exchange adapter contract with Binance USD-M Futures and OKX
  perpetual-swap REST implementations;
- user-owned exchange connections backed by the existing encrypted credential
  store, with provider-aware management pages;
- normalized public market reads and private account, balance, position,
  open-order, order lookup, and configuration reads;
- request signing, clock synchronization, timeouts, bounded retries, Redis
  throttles, safe public caching, and normalized provider errors.

Realtime market ingestion, AI agents, risk evaluation, paper/live trading,
WebSockets, and analytics are intentionally reserved for later roadmap phases.
There are no roles, organizations, teams, subscriptions, or payments. Phase 3
contains no provider trading mutation, and production connections are disabled
by default.

## Prerequisites

- Node.js 22.13 or newer
- pnpm 11 or newer
- Docker Desktop with Docker Compose

The verified local toolchain is Node.js 22, pnpm 11, Docker Engine 29, and
Docker Compose 5.

## Local setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create local environment files from the safe example:

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   Copy-Item .env.example apps/api/.env
   Copy-Item .env.example apps/web/.env.local
   ```

   macOS or Linux:

   ```bash
   cp .env.example .env
   cp .env.example apps/api/.env
   cp .env.example apps/web/.env.local
   ```

   The root `.env` is used by Docker Compose, Prisma reads `apps/api/.env`, and
   Next.js reads `apps/web/.env.local`. All three files are ignored by Git.

3. Start local infrastructure:

   ```bash
   docker compose up -d postgres redis adminer
   docker compose ps
   ```

   To run the complete containerized stack instead, use `docker compose up -d
--build`; the API container deploys committed Prisma migrations before it
   starts.

4. Generate Prisma Client and apply migrations:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

5. Start the API and web application:

   ```bash
   pnpm dev
   ```

6. Open the local services:
   - Dashboard: <http://localhost:3000>
   - API health: <http://localhost:3001/api/health>
   - Swagger UI: <http://localhost:3001/docs>
   - Swagger JSON: <http://localhost:3001/docs/json>
   - Adminer: <http://localhost:8080>

   For Adminer, use system `PostgreSQL`, server `postgres`, database
   `crypto_platform`, and the local username/password configured in `.env`.

7. Stop infrastructure when finished:

   ```bash
   docker compose down
   ```

   Add `--volumes` only when you intentionally want to remove local database
   and Redis data.

## Environment variables

| Variable                                  | Used by        | Purpose                                           |
| ----------------------------------------- | -------------- | ------------------------------------------------- |
| `NODE_ENV`                                | API            | `development`, `test`, or `production`            |
| `API_PORT`                                | API            | HTTP listen port; defaults to `3001`              |
| `DATABASE_URL`                            | API / Prisma   | PostgreSQL connection URL                         |
| `REDIS_URL`                               | API            | Redis connection URL                              |
| `CORS_ORIGINS`                            | API            | Comma-separated allowed browser origins           |
| `SESSION_SECRET`                          | API            | HMAC secret for persisted session identifiers     |
| `SESSION_TTL`                             | API            | Session and cookie lifetime in seconds            |
| `REMEMBER_ME_TTL`                         | API            | Persistent remembered-device lifetime             |
| `SESSION_FINGERPRINT_ENABLED`             | API            | Bind sessions to a device fingerprint             |
| `SESSION_FINGERPRINT_BIND_IP`             | API            | Also bind fingerprints to an IP prefix            |
| `EMAIL_VERIFICATION_ENABLED`              | API            | Require verified email before login               |
| `AUTH_EMAIL_WEBHOOK_URL`                  | API            | Auth-email delivery webhook                       |
| `AUTH_EMAIL_WEBHOOK_SECRET`               | API            | Bearer secret for the email webhook               |
| `PASSWORD_BREACH_CHECK_ENABLED`           | API            | Enable k-anonymous breached-password lookup       |
| `TOTP_REQUIRED_FOR_SENSITIVE_ACTIONS`     | API            | Require 2FA enrollment for sensitive changes      |
| `BINANCE_FUTURES_BASE_URL`                | API            | Binance USD-M production REST origin              |
| `BINANCE_FUTURES_TESTNET_BASE_URL`        | API            | Binance USD-M testnet REST origin                 |
| `OKX_BASE_URL`                            | API            | OKX v5 REST origin                                |
| `OKX_DEMO_TRADING_ENABLED`                | API            | Allow simulated OKX connections                   |
| `EXCHANGE_HTTP_TIMEOUT_MS`                | API            | Exchange HTTP deadline                            |
| `EXCHANGE_MAX_RETRIES`                    | API            | Safe transient retry count                        |
| `EXCHANGE_RETRY_BASE_DELAY_MS`            | API            | Exponential retry base delay                      |
| `EXCHANGE_PUBLIC_RATE_LIMIT_ENABLED`      | API            | Enable global public throttles                    |
| `EXCHANGE_PRIVATE_RATE_LIMIT_ENABLED`     | API            | Enable user/connection private throttles          |
| `EXCHANGE_PUBLIC_RATE_LIMIT_PER_MINUTE`   | API            | Local public request budget                       |
| `EXCHANGE_PRIVATE_RATE_LIMIT_PER_MINUTE`  | API            | Local private request budget                      |
| `EXCHANGE_INSTRUMENT_CACHE_TTL_SECONDS`   | API            | Public instrument cache lifetime                  |
| `EXCHANGE_TICKER_CACHE_TTL_SECONDS`       | API            | Short public snapshot cache lifetime              |
| `EXCHANGE_TIME_OFFSET_CACHE_TTL_SECONDS`  | API            | Provider clock-offset cache lifetime              |
| `EXCHANGE_PRODUCTION_CONNECTIONS_ENABLED` | API            | Explicit production connection gate               |
| `EXCHANGE_REQUIRE_RECENT_AUTH`            | API            | Require recent password proof                     |
| `EXCHANGE_RECENT_AUTH_TTL_SECONDS`        | API            | Recent password proof lifetime                    |
| `COOKIE_SECURE`                           | API            | Require HTTPS for the session cookie              |
| `COOKIE_DOMAIN`                           | API            | Optional session-cookie domain                    |
| `ENCRYPTION_MASTER_KEY`                   | API            | Base64-encoded 32-byte AES credential key         |
| `NEXT_PUBLIC_API_BASE_URL`                | Web            | Browser-visible API origin                        |
| `POSTGRES_DB`                             | Docker Compose | Local PostgreSQL database                         |
| `POSTGRES_USER`                           | Docker Compose | Local PostgreSQL user                             |
| `POSTGRES_PASSWORD`                       | Docker Compose | Local-only PostgreSQL password; never use in prod |

Backend startup fails fast on missing or invalid configuration. Frontend build
and startup likewise validate `NEXT_PUBLIC_API_BASE_URL`. Never place exchange,
AI provider, or other private credentials in a `NEXT_PUBLIC_` variable.

Generate `SESSION_SECRET` with at least 32 random characters and create the
credential key with `openssl rand -base64 32`. Never commit production values.
Set `COOKIE_SECURE=true` in production.

## Authentication and credential security

The API stores only HMAC digests of random session and CSRF tokens. Redis holds
active sessions with the configured TTL; PostgreSQL stores session families,
rotation history, fingerprints, and device metadata. Reuse of a rotated token
revokes its full family. Session cookies are HttpOnly, SameSite=Lax, and secure
in production; unsafe requests use double-submit CSRF validation. Five
failed login attempts trigger a 15-minute account lock, with an additional
source-and-identifier throttle.

Provider keys, secrets, and passphrases are encrypted with AES-256-GCM using a
fresh nonce per write. APIs return only provider metadata and the last four key
characters. Generic credential tests verify ciphertext integrity. Exchange
connection tests additionally authenticate through read-only account endpoints
in the selected testnet, demo, or explicitly enabled production environment.

Password-reset and email-verification tokens are short-lived, single-use Redis
values delivered through the configured authenticated webhook. Email
verification and k-anonymous breached-password checks are disabled by default
for local development. TOTP secrets are encrypted with AES-256-GCM and used as
step-up authentication for API-key changes and future live-trading controls.

## Exchange integration

Application code sees `BASE-QUOTE` symbols and decimal strings. Adapters
translate to Binance concatenated symbols or OKX `BASE-QUOTE-SWAP` instrument
IDs; vendor response DTOs stay inside infrastructure modules. Public cache
values are shareable. Private account responses are fetched on demand, never
persisted, and every lookup uses both the session-derived user ID and connection
ID.

Retries apply only to idempotent GET requests and transient network, timeout,
429, or 5xx failures, with bounded exponential delay and jitter. A timestamp
rejection invalidates the clock offset and retries the signed request once.
Structured logs omit signed URLs, headers, credentials, and secret payloads.

To add another exchange, implement `ExchangeAdapter`, keep its client, signer,
schemas, and mappers in a provider infrastructure folder, add explicit
provider/environment validation and factory registration, then extend the
normalization and security contract tests.

## Workspace commands

| Command                 | Description                                  |
| ----------------------- | -------------------------------------------- |
| `pnpm dev`              | Build shared contracts, then run API and web |
| `pnpm build`            | Create production builds for all packages    |
| `pnpm lint`             | Run ESLint across the workspace              |
| `pnpm typecheck`        | Run strict TypeScript checks                 |
| `pnpm test`             | Run all Vitest suites                        |
| `pnpm test:integration` | Run HTTP/database integration flows          |
| `pnpm test:e2e`         | Run connection-management end-to-end flow    |
| `pnpm format`           | Format supported files with Prettier         |
| `pnpm format:check`     | Check formatting without changing files      |
| `pnpm db:generate`      | Generate Prisma Client                       |
| `pnpm db:migrate`       | Apply committed migrations                   |
| `pnpm db:studio`        | Open Prisma Studio                           |

## Health contract

`GET /api/health` checks PostgreSQL with Prisma and Redis with `PING`. A healthy
response uses the shared runtime-validated contract:

```json
{
  "status": "ok",
  "timestamp": "2026-07-31T09:09:58.403Z",
  "services": {
    "database": { "status": "up", "latencyMs": 5 },
    "redis": { "status": "up", "latencyMs": 3 }
  }
}
```

The endpoint returns HTTP 503 through the global structured error contract if a
dependency is unavailable.

## Quality checks

Run the same gates as CI:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI also starts PostgreSQL and Redis, generates Prisma Client, and applies the
committed migrations before running those gates.

The HTTP integration suite is opt-in because it creates isolated test users in
the configured database. Start the stack and point `DATABASE_URL` at the same
database. In PowerShell run `$env:RUN_INTEGRATION_TESTS='true'; pnpm --filter
@platform/api test`; in Bash prefix the command with
`RUN_INTEGRATION_TESTS=true`. It covers registration, current user, refresh
rotation, settings, credential CRUD, logout/login, and database-driven session
expiry.

Optional provider checks are excluded from CI. Set
`RUN_EXCHANGE_SANDBOX_TESTS=true` only with dedicated Binance testnet or OKX demo
read-only credentials supplied through uncommitted environment values. The
default suite uses mocks/fixtures, needs no exchange network, and never places
orders.

## Known limitations

- Phase 3 is REST-only; Phase 4 owns realtime WebSocket collection.
- OKX does not expose all key capabilities through the read endpoints used, so
  trade and withdrawal permission remain unknown rather than guessed.
- Private account snapshots and derived portfolio/PnL analytics are not stored.
- Order placement/cancellation, leverage, margin mode, transfers, closing
  positions, automation, and AI execution are intentionally absent.

## Project structure

See [DIRECTORY_STRUCTURE.md](DIRECTORY_STRUCTURE.md) for the current monorepo
layout and [ROADMAP.md](ROADMAP.md) for the phased delivery plan.
