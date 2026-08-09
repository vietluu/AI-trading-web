# API contract

All REST routes use the `/api` prefix. Swagger UI is served at `/docs` and the
OpenAPI document at `/docs/json`. DTO validation rejects unknown properties.

Authenticated routes use the opaque HttpOnly `sid` cookie. Unsafe requests use
the double-submit `csrf_token` cookie in `X-CSRF-Token`. Sensitive mutations may
also require `X-TOTP-Code` and a recent-password proof.

## Core and identity

- `GET /api/health`
- `/api/auth`: register, login, logout, refresh, email verification, password
  recovery/change, current user/session, session revocation, TOTP, and
  reauthentication.
- `/api/credentials`: list/create/update/delete/test encrypted credentials.
- `GET|PUT /api/settings`

Credential responses expose masked metadata only, never secrets, passphrases,
ciphertext, session tokens, or signed provider requests.

## Exchange and market data

- `/api/exchanges`: provider catalog, symbols/recommendations, server time,
  instruments, ticker, order book, recent public trades, klines, funding, and
  open interest.
- `/api/exchange-connections`: user-owned connection CRUD, test/enable/disable,
  account, balances, positions, open orders, order lookup, and account
  configuration.
- `/api/market`: normalized providers/instruments, tickers, candles, indicators,
  funding, open interest, order books, stream status, gaps, backfill, and repair.

Providers are `BINANCE_FUTURES` and `OKX_FUTURES`. Core symbols use uppercase
`BASE-QUOTE` form such as `BTC-USDT`; adapters translate vendor formats.
Prices, quantities, balances, PnL, and rates use decimal strings at the exchange
boundary to avoid floating-point loss.

Exchange connection mutation/production rules remain feature-gated. Private
calls require an enabled, verified, user-owned connection. The connection CRUD
controller remains primarily an account/credential boundary; exchange order
mutations are exposed only through the approved Live Trading controller.

## External data

- `/api/external-data/news`: filtered list, high importance, sources, topics,
  symbol view, detail, and user read/save/hide state.
- `/api/external-data/announcements` and `/api/external-data/incidents`.
- `/api/external-data/sentiment` and `/history`.
- `/api/external-data/social` and `/providers`.
- `/api/external-data/macro/events`, detail, import preview, and import.
- `/api/external-data/sources`: CRUD and test.
- `/api/external-data/providers`: list/health/run/enable/disable.

## AI, agents, and pipeline

- `/api/ai`: providers, models, history, config, provider test, usage, and
  streaming chat.
- `/api/ai/tools`: catalog, health, categories, capabilities, invocation
  history, detail, and gated manual test.
- `/api/agents`: definitions, health, fusion run, typed runs, and system
  diagnostic.
- `/api/agent-runs`: list/detail/cancel/replay/transitions/context; SSE is
  available under `/api/agent-runs-sse`.
- `POST /api/ai/decision`: run the Decision Agent contract.
- `/api/pipeline`: manual run and schedules.
- `/api/pipeline-runs`: list/detail/replay/cancel.
- `/api/system/pipeline`: health, metrics, pause, and resume.

## Risk, portfolio, performance, and research

- `GET /api/ai/risk`: current exchange-backed risk dashboard and assessments.
- `/api/ai/portfolio`: dashboard, rebalance, strategy status, and result input.
- `/api/ai/performance`: summaries, metrics, alerts, calibration, and evaluation.
- `/api/ai/reflection`: dashboard, run, insights, proposals, and proposal review.
- `GET /api/ai/self-learning/experiments`
- `/api/ai/research`: backtest, validation/full validation, sensitivity,
  benchmark, and health.
- `/api/quant-intelligence`: scorecard, hypotheses, strategies, factors,
  benchmarks, weights, thresholds, portfolio/application, self-learning,
  regime, recommendations/review, simulation, synthetic simulation, reports,
  and knowledge.

## Live Trading

All routes are authenticated. Order execution and position close additionally
pass the sensitive-action guard.

- `GET /api/ai/live-trading?connectionId=`: account/position snapshot and at
  most 20 recent orders, newest first.
- `POST /api/ai/live-trading/orders`: execute a fresh Risk-approved order.
- `POST /api/ai/live-trading/positions/close`: close an approved position.
- `POST /api/ai/live-trading/orders/:id/cancel`: cancel a user-owned order.
- `POST /api/ai/live-trading/sync`: reconcile one exchange connection.
- `POST /api/ai/live-trading/kill-switch`: disable execution and initiate safe
  shutdown behavior.
- `POST /api/ai/live-trading/kill-switch/enable`: re-enable execution subject to
  configured gates.

The system also performs internal protective-order placement/amendment,
partial-profit close, time exit, and orphan cleanup. These are Position Manager
operations, not public bypass endpoints.

## WebSocket contract

Socket.IO uses the configured application path and these namespaces:

- `/market`: `ticker`, `candle`, `orderbook`, `trade`.
- `/external-data`: subscribe to news/announcement/incident/sentiment/macro
  channels and receive normalized domain events.
- `/live-trading`: emit `subscribe` with an optional `connectionId`; receive
  `snapshot` or `exception`. A snapshot contains connections, accounts,
  positions, and no more than 20 recent orders.

## Error response

Unexpected errors keep details in structured server logs and return a safe
shape:

```json
{
  "statusCode": 401,
  "timestamp": "2026-08-09T00:00:00.000Z",
  "path": "/api/auth/me",
  "message": "Authentication required",
  "error": "UnauthorizedException"
}
```

Normalized exchange failures may add `code`, `provider`, `retryable`, and
`correlationId`.
