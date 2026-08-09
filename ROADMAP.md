# Roadmap

Status reflects code currently present in the repository, not a profitability
claim or production certification.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Project foundation: monorepo, Docker, PostgreSQL, Redis, Prisma, CI | Complete |
| 2 | Authentication, sessions, TOTP, encrypted credentials, audit | Complete |
| 3 | Binance/OKX normalized exchange integration | Complete |
| 4 | Realtime market streams, indicators, persistence, gaps/backfill, dashboard | Complete |
| 5 | News, announcements, incidents, sentiment, social, macro ingestion | Complete |
| 6 | AI providers, tool framework, agents, Decision/Judge, pipeline runtime | Complete |
| 7 | Deterministic risk, portfolio limits, adaptive regime-aware TP/SL | Complete |
| 8 | Paper/shadow trading records and evaluation | Partial: no standalone execution API |
| 9 | Web dashboards and operational views | Complete |
| 10 | Backtest, validation, sensitivity, benchmarks, simulations | Complete |
| 11 | DEMO/LIVE exchange execution, kill switch, sync, Position Manager | Implemented; production gated |
| 12 | Reflection, performance, quantitative intelligence, shadow/canary learning | Implemented; ongoing validation |

## Current hardening priorities

1. Continue long-running DEMO observation of order lifecycle, reconnects,
   exchange errors, TP/SL amendments, partial exits, and orphan cleanup.
2. Separate complete open-order monitoring from the capped 20-item historical
   trade view if accounts can maintain more than 20 concurrent open orders.
3. Complete a standalone Paper Trading execution service/API and reconcile its
   behavior with the exchange-backed DEMO path.
4. Expand adapter contract/integration coverage for protection amendment and
   cancellation edge cases.
5. Require statistically adequate shadow/canary samples before promoting
   learned policies or enabling production trading.
