# AI Multi-Agent Cryptocurrency Futures Platform

Production-oriented cryptocurrency futures research and execution platform for
Binance USD-M Futures and OKX perpetual swaps. The system combines realtime
market data, specialized AI agents, deterministic decision/risk controls,
portfolio governance, exchange-backed demo/live execution, research,
performance evaluation, and self-learning experiments.

AI is advisory. It cannot call an exchange adapter directly. Automated orders
must flow through the Decision/Judge pipeline and deterministic Risk Engine
before the Trading Engine can execute them.

## Current implementation

- Multi-user authentication, Redis-backed sessions, CSRF, TOTP, audit logs,
  Argon2id passwords, and AES-256-GCM encrypted provider credentials.
- Binance Futures and OKX adapters for public data, private account state,
  positions, open orders, order history, placement, cancellation, and
  protective-order amendment where supported.
- Realtime market streams, normalized candles, indicators, gap detection,
  backfill, Redis snapshots, and Socket.IO namespace `/market`.
- News, exchange announcements, incidents, sentiment, Reddit, macro calendar,
  ingestion queues, deduplication, importance scoring, and `/external-data`
  realtime events.
- Provider-independent AI infrastructure, bounded tool calling, agent
  lifecycle, Decision Agent, Judge controls, BullMQ pipeline scheduling,
  replay, cancellation, health, and metrics.
- Deterministic risk assessment, portfolio exposure controls, strategy
  allocation/rebalancing, performance/reflection, shadow/canary self-learning,
  backtesting, validation, benchmarking, simulation, factor discovery, and
  quantitative recommendations.
- Exchange-backed DEMO/LIVE trading with kill switch, idempotent client order
  IDs, synchronization, TP/SL protection, Position Manager, and realtime
  dashboard namespace `/live-trading`.

## Adaptive TP/SL and Position Manager

TP/SL is no longer always hard-coded from environment percentages. When the
pipeline has a complete market snapshot, the deterministic Trade Plan Engine
uses ATR, support/resistance, EMA20/EMA50, ADX, efficiency ratio, breakout state,
market structure, fees, and configured risk/reward requirements to classify:

- `TREND_UP` / `TREND_DOWN` → trend pullback plan;
- `RANGING` → range-boundary entry and target before the opposite boundary;
- `BREAKOUT` → breakout/retest plan;
- `HIGH_VOLATILITY` → volatility-controlled plan.

The engine rejects poor entry location, structurally excessive stops, and
targets whose net reward/risk is below policy. Environment values such as
`STOP_LOSS_PCT` and `RISK_REWARD_RATIO` remain policy defaults and a safe
fallback when ATR/structure data is unavailable.

After entry, the Position Manager synchronizes exchange state and can:

- move the stop to break-even plus a fee buffer;
- trail by ATR after sufficient favorable movement;
- take one partial profit at 1R;
- keep stagnant positions open until an explicit protective, manual, exchange, or strategy-authorized close occurs;
- amend or cancel/recreate protective orders through the exchange adapter;
- clean orphan protection after the position closes.

`LIVE_POSITION_SYNC_INTERVAL_MS` defaults to 30 seconds. Exchange order-history
imports and the Live Trading dashboard are capped at the 20 most recent orders;
positions and safety/protection checks are not truncated.

## Safety gates

- `TRADING_MODE=DEMO` is the safe default.
- `GLOBAL_TRADING_ENABLED`, `LIVE_TRADING_ENABLED`, verified connection state,
  production connection permission, recent authentication, risk approval TTL,
  exposure limits, leverage limits, cooldown, and kill-switch state are checked
  before execution.
- `TRADING_MODE=LIVE` requires `LIVE_TRADING_ENABLED=true`; production exchange
  connections remain disabled unless explicitly enabled.
- Use dedicated demo/testnet credentials while validating behavior. Never use
  withdrawal-capable API keys.

## Prerequisites

- Node.js 22.13 or newer (required by pnpm 11)
- pnpm 11 or newer
- Docker Desktop with Docker Compose

## Local setup

```bash
cp .env.example .env
cp .env.example apps/api/.env
cp .env.example apps/web/.env.local
pnpm install
docker compose up -d postgres redis adminer
pnpm db:generate
pnpm db:migrate
pnpm dev
```

For the full containerized stack:

```bash
docker compose up -d --build
```

Services:

- Web: <http://localhost:3000>
- API: <http://localhost:3001/api>
- Swagger: <http://localhost:3001/docs>
- Health: <http://localhost:3001/api/health>
- Adminer: <http://localhost:8080>

The API reads the root `.env` and `apps/api/.env`; Next.js reads
`apps/web/.env.local`. Use `.env.example` as the authoritative list of runtime
settings. Do not expose secrets through a `NEXT_PUBLIC_` variable.

## Commands

| Command                 | Purpose                             |
| ----------------------- | ----------------------------------- |
| `pnpm dev`              | Run API and web development servers |
| `pnpm build`            | Build all workspace packages        |
| `pnpm lint`             | Run ESLint                          |
| `pnpm typecheck`        | Run strict TypeScript checks        |
| `pnpm test`             | Run Vitest suites                   |
| `pnpm test:integration` | Run API integration tests           |
| `pnpm test:e2e`         | Run end-to-end tests                |
| `pnpm format:check`     | Verify formatting                   |
| `pnpm db:generate`      | Generate Prisma Client              |
| `pnpm db:migrate`       | Apply committed migrations          |
| `pnpm db:studio`        | Open Prisma Studio                  |

## Documentation

- [Architecture](ARCHITECTURE.md)
- [API contract](API_CONTRACT.md)
- [Database](DATABASE.md)
- [Directory structure](DIRECTORY_STRUCTURE.md)
- [Roadmap](ROADMAP.md)
- [Project context](PROJECT_CONTEXT.md)
- [Definition of done](DEFINITION_OF_DONE.md)
- [Project rules](PROJECT_RULES.md)

## Known boundaries

- Paper/shadow records exist and support evaluation/self-learning, but there is
  not yet a standalone paper-trading execution API comparable to Live Trading.
- Production profitability is not guaranteed by backtests, demo runs, or model
  confidence. Promotion requires adequate samples and drawdown review.
- A code update does not affect running containers until API/web services are
  rebuilt or restarted.
