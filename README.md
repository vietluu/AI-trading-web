# AI Multi-Agent Cryptocurrency Futures Platform

A production-oriented research and trading platform that combines real-time
market data, specialized AI agents, deterministic risk controls, paper trading,
and optional live execution. AI remains advisory: it never sends exchange
orders, and every future order must pass the deterministic Risk Engine.

## Phase 1 scope

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

Authentication, exchanges, market ingestion, AI agents, risk evaluation,
paper/live trading, WebSockets, and analytics are intentionally reserved for
their roadmap phases. Live trading is not implemented and remains disabled.

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
   Copy-Item .env.example apps/web/.env.local
   ```

   macOS or Linux:

   ```bash
   cp .env.example .env
   cp .env.example apps/web/.env.local
   ```

   The root `.env` is used by Docker Compose and the API. Next.js reads
   `apps/web/.env.local`. Both files are ignored by Git.

3. Start local infrastructure:

   ```bash
   docker compose up -d postgres redis adminer
   docker compose ps
   ```

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
| `NEXT_PUBLIC_API_BASE_URL` | Web            | Browser-visible API origin                        |
| `POSTGRES_DB`              | Docker Compose | Local PostgreSQL database                         |
| `POSTGRES_USER`            | Docker Compose | Local PostgreSQL user                             |
| `POSTGRES_PASSWORD`        | Docker Compose | Local-only PostgreSQL password; never use in prod |

Backend startup fails fast on missing or invalid configuration. Frontend build
and startup likewise validate `NEXT_PUBLIC_API_BASE_URL`. Never place exchange,
AI provider, or other private credentials in a `NEXT_PUBLIC_` variable.

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

## Project structure

See [DIRECTORY_STRUCTURE.md](DIRECTORY_STRUCTURE.md) for the current monorepo
layout and [ROADMAP.md](ROADMAP.md) for the phased delivery plan.
