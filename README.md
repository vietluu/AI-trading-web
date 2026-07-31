# AI Multi-Agent Cryptocurrency Futures Platform

A production-oriented research and trading platform that combines real-time
market data, specialized AI agents, deterministic risk controls, paper trading,
and optional live execution. AI remains advisory: it never sends exchange
orders, and every future order must pass the deterministic Risk Engine.

## Phase 2 scope

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

Exchange connectivity, market ingestion, AI agents, risk evaluation,
paper/live trading, WebSockets, and analytics are intentionally reserved for
their roadmap phases. There are no roles, organizations, teams, subscriptions,
or payments. Live trading is not implemented and remains disabled.

## Prerequisites

- Node.js 22 or newer
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

| Variable                   | Used by        | Purpose                                           |
| -------------------------- | -------------- | ------------------------------------------------- |
| `NODE_ENV`                 | API            | `development`, `test`, or `production`            |
| `API_PORT`                 | API            | HTTP listen port; defaults to `3001`              |
| `DATABASE_URL`             | API / Prisma   | PostgreSQL connection URL                         |
| `REDIS_URL`                | API            | Redis connection URL                              |
| `CORS_ORIGINS`             | API            | Comma-separated allowed browser origins           |
| `SESSION_SECRET`           | API            | HMAC secret for persisted session identifiers     |
| `SESSION_TTL`              | API            | Session and cookie lifetime in seconds            |
| `COOKIE_SECURE`            | API            | Require HTTPS for the session cookie              |
| `COOKIE_DOMAIN`            | API            | Optional session-cookie domain                    |
| `ENCRYPTION_MASTER_KEY`    | API            | Base64-encoded 32-byte AES credential key         |
| `NEXT_PUBLIC_API_BASE_URL` | Web            | Browser-visible API origin                        |
| `POSTGRES_DB`              | Docker Compose | Local PostgreSQL database                         |
| `POSTGRES_USER`            | Docker Compose | Local PostgreSQL user                             |
| `POSTGRES_PASSWORD`        | Docker Compose | Local-only PostgreSQL password; never use in prod |

Backend startup fails fast on missing or invalid configuration. Frontend build
and startup likewise validate `NEXT_PUBLIC_API_BASE_URL`. Never place exchange,
AI provider, or other private credentials in a `NEXT_PUBLIC_` variable.

Generate `SESSION_SECRET` with at least 32 random characters and create the
credential key with `openssl rand -base64 32`. Never commit production values.
Set `COOKIE_SECURE=true` in production.

## Authentication and credential security

The API stores only an HMAC digest of each random session token. Redis holds
active sessions with the configured TTL; PostgreSQL stores session and device
metadata. Cookies are HttpOnly, SameSite=Lax, and secure in production. Five
failed login attempts trigger a 15-minute account lock, with an additional
source-and-identifier throttle.

Provider keys, secrets, and passphrases are encrypted with AES-256-GCM using a
fresh nonce per write. APIs return only provider metadata and the last four key
characters. Credential tests currently verify decryptability and integrity of
stored ciphertext; provider network verification is intentionally deferred to
the exchange and AI integration phases.

Password-reset tokens are short-lived, single-use Redis values. Phase 2 defines
secure issuance and consumption, but a mail delivery adapter is not configured
because no email provider is part of this phase.

## Workspace commands

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm dev`          | Build shared contracts, then run API and web |
| `pnpm build`        | Create production builds for all packages    |
| `pnpm lint`         | Run ESLint across the workspace              |
| `pnpm typecheck`    | Run strict TypeScript checks                 |
| `pnpm test`         | Run all Vitest suites                        |
| `pnpm format`       | Format supported files with Prettier         |
| `pnpm format:check` | Check formatting without changing files      |
| `pnpm db:generate`  | Generate Prisma Client                       |
| `pnpm db:migrate`   | Apply committed migrations                   |
| `pnpm db:studio`    | Open Prisma Studio                           |

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

## Project structure

See [DIRECTORY_STRUCTURE.md](DIRECTORY_STRUCTURE.md) for the current monorepo
layout and [ROADMAP.md](ROADMAP.md) for the phased delivery plan.
