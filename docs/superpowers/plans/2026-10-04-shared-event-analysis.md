# Shared Event Analysis Implementation Plan

**Goal:** Replace periodic AI analysis with shared event-triggered research and platform-owned AI configuration.

**Architecture:** Public market/news events enter a durable queue. Active strategies and selected symbols define subscribers independently of schedules. Research is shared by event, exchange, symbol, timeframe and pinned snapshot; account risk and execution remain separate. A five-minute heartbeat checks stream health without calling AI.

**Constraints:** Preserve existing orchestrator edits. No production deployment or orders during development. Never share user memories or account data. Fail closed when shared-analysis coordination is unavailable. Existing execution gates remain authoritative. No promise of trading profitability.

**Release status after production audit:** implementation checklist below is not release approval. Event-driven opportunity discovery is now wired directly into the shared dispatcher: only `WATCHING` opportunities enter `proactive-thesis`, and the legacy decision path is not dispatched in parallel. Deployment validation and the remaining operational/PnL evidence are still required. See [production audit and remediation](../../../reports/2026-10-04-prod-ai-remediation.md) for evidence, additional fixes and remaining blockers.

- [x] Platform AI: hide provider/settings UI, deny public configuration mutations, use deployment defaults and a reserved system research identity.
- [x] Event delivery: durable queue, timestamp validation, subscriber lookup without schedules, global symbol scanning and per-recipient delivery deduplication.
- [x] Shared research: strict cross-replica lease, event/snapshot cache, system context, no per-user AI fallback on coordination failure.
- [x] Replace scheduled analysis with health heartbeat; wire market/news/macro events and dynamic symbol subscriptions.
- [x] Update automation UI to explain selected-symbol event monitoring and preserve run history.
- [x] Verify event eligibility, duplicate delivery, shared research isolation, API denial, type checks and relevant regression tests.

Acceptance: adding a subscriber to an existing event/symbol/snapshot does not add AI research calls. Different snapshots are not conflated. Stale events cannot authorize orders. No periodic analysis runs are created by the heartbeat. Failed delivery is retried; private risk/portfolio data stays account-scoped.

## Local verification — 2026-10-04

- API and web TypeScript checks passed after rebuilding the shared package.
- Relevant regression suite: 105 files passed, one skipped; 772 tests passed, two skipped.
- Shared-research tests cover 100 concurrent consumers across two service instances, isolation, distinct snapshots, Redis outage, lease loss and retry after failure.
- Subscription endpoint tests verify current-user filtering and omission of account identifiers.
- No deployment, live provider/exchange validation, production latency measurement or PnL validation performed.

## Operational limits

- Market scans are throttled to three seconds and require confirmation; this is not a guaranteed entry-latency SLA.
- Public research is shared per event/exchange/symbol/snapshot. Private risk evaluation and execution still scale with subscriber count.
- Queued events are durable. Recent persisted news is replayed; macro emission does not yet have a transactional outbox, so end-to-end exactly-once delivery is not claimed.
- Removed market subscriptions may stay connected until reconnect, but eligibility filtering prevents new AI work for unsubscribed scopes.
- Stale events and unavailable shared coordination fail closed. This can skip trades and is intentional.
