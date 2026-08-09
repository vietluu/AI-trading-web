# Definition of done

A change is complete only when the checks proportional to its risk have passed.

## Common gates

- TypeScript compiles without errors.
- ESLint and formatting checks pass.
- Relevant unit, contract, integration, and end-to-end tests pass.
- Prisma schema changes include a committed migration and generated client.
- API and Web build successfully.
- PostgreSQL, Redis, workers, and required WebSocket namespaces start cleanly.
- APIs, environment settings, logs, and Markdown documentation match behavior.
- No secrets, credential material, or sensitive exchange payloads appear in
  responses or logs.

## Trading and risk gates

- AI cannot bypass Decision/Judge/Risk and cannot directly mutate an exchange.
- User, connection, environment, enablement, recent-auth, risk-approval,
  leverage, exposure, cooldown, and kill-switch rules are enforced.
- Adaptive trade plans cover trend, range, breakout, high volatility, and safe
  fallback behavior with deterministic tests.
- Structurally invalid stops, poor range entries, and insufficient net R:R are
  rejected.
- Exchange placement/cancel/amend behavior is normalized for Binance/OKX and
  uses idempotent client order identifiers.
- Position synchronization, TP/SL protection, break-even, ATR trailing, partial
  take-profit, time exits, and orphan cleanup are tested.
- Live Trading history returns no more than 20 recent orders without truncating
  position/risk calculations.
- DEMO observation completes before production enablement; production remains
  disabled by default.

## Learning and research gates

- Decisions, transitions, outputs, performance records, and recommendations are
  persisted and attributable.
- Backtest/validation avoids look-ahead leakage and exposes assumptions.
- Shadow/canary promotion follows configured sample, profit factor, Sharpe,
  accuracy-lift, drawdown, and duration thresholds.
- A model or strategy is never described as profitable solely from confidence
  scores or a small demo sample.

Paper Trading remains partial until an independently testable execution API and
position/order lifecycle are delivered.
